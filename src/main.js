// CommandWave – Hauptprozess: Fenster, Tray-Icon, Tastenkombination, Mods, Mod-Updater, Einstellungen.
// Spracherkennung (Vosk) und Sprachausgabe (Windows-Stimmen) laufen im Fenster – komplett offline.
const { app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, nativeImage, Notification, shell, protocol, net, session, screen, clipboard } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { Assistant, WORDS } = require("./core/assistant");
const { createActions } = require("./core/actions");
const { seedDefaults } = require("./core/mods");
const updater = require("./core/updater");
const { START_APPS_CMD, toSlots } = require("./core/apps");
const { execFile, spawn } = require("node:child_process");
const selfUpdate = require("./core/selfupdate");

/* Unerwartete Fehler: ins Protokoll (…\CommandWave\fehler.log) statt Absturz-Fenster; im Test auch ausgeben */
const FULLTEST = process.argv.includes("--fulltest");
function logCrash(kind, err) {
  const text = `[${new Date().toISOString()}] ${kind}: ${err && err.stack ? err.stack : String(err)}\n`;
  try {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.appendFileSync(path.join(app.getPath("userData"), "fehler.log"), text);
  } catch {
    // Protokoll nicht schreibbar
  }
  console.error("FEHLER " + text);
}
process.on("uncaughtException", (e) => logCrash("uncaughtException", e));
process.on("unhandledRejection", (e) => logCrash("unhandledRejection", e));

if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}
app.setAppUserModelId("de.xnikyox.commandwave");
// kleines Fenster ohne 3D: ohne Grafikkarten-Prozess spart CommandWave Speicher und Energie
app.disableHardwareAcceleration();
// Netzwerkdienst nicht abschotten: manche Sicherheitsprogramme sperren ihn sonst (net::ERR_NETWORK_ACCESS_DENIED bei Updates)
app.commandLine.appendSwitch("disable-features", "NetworkServiceSandbox");

// Eigenes Protokoll cw:// für Oberfläche, Erkennung und Sprachmodell (fetch/Worker brauchen eine echte Herkunft)
protocol.registerSchemesAsPrivileged([{ scheme: "cw", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

const ROOT = path.join(__dirname, "..");
const RES = app.isPackaged ? process.resourcesPath : ROOT;
const DATA = app.getPath("userData");
const MODS_DIR = path.join(DATA, "mods");
const DEFAULT_MODS = path.join(RES, app.isPackaged ? "mods-default" : "mods");
const SETTINGS_FILE = path.join(DATA, "einstellungen.json");
const ALIASES_FILE = path.join(DATA, "aussprache.json"); // gelernte Aussprache (Einstellungen → Aussprache lernen)
// Testmodus (GitHub Actions): Fenster unsichtbar laden, Erkennung prüfen, Ergebnis ausgeben, beenden
const SMOKE = process.argv.includes("--smoke");
/** Offizielle Mod-Quelle: hier liegen die mitgelieferten Mods und neue Mods von CommandWave */
const OFFICIAL = { type: "github", repo: "xNikYox/commandwave-mods", branch: "main", dir: "" };

const DEFAULTS = {
  hotkey: "Control+Space",
  hotkeyLabel: "Strg + Leertaste", // Anzeige so, wie die Taste auf der Tastatur heißt (z. B. „Strg + #“)
  language: "de", // "de" | "en" | "both" (beide gleichzeitig – braucht mehr Speicher)
  voice: "", // leer = erste deutsche Stimme
  voiceEn: "", // leer = erste englische Stimme
  rate: 1,
  volume: 1,
  micId: "",
  maxSeconds: 7,
  unloadMinutes: 0, // Sparmodus: Spracherkennung nach x Minuten ohne Benutzung entladen (0 = aus)
  beep: true,
  wake: false, // Aktivierungswort: ohne Taste zuhören, sobald man es sagt
  wakeWord: "hey wave",
  overlay: true, // kleine Anzeige am Bildschirmrand, wenn das Fenster nicht vorne ist
  whisper: true, // genaue Erkennung (Whisper) für Namen und nicht sicher verstandene Sätze
  showOnHotkey: false,
  autostart: false,
  startHidden: false,
  closeToTray: true,
  checkOnStart: true,
  autoUpdate: true, // Mods automatisch aktualisieren; neue Mods aus vertrauenswürdigen Quellen auch automatisch installieren
  appAutoUpdate: true, // CommandWave selbst automatisch aktualisieren (GitHub-Releases)
  sources: [OFFICIAL], // Mod-Quellen (siehe core/updater.js)
  trusted: [updater.sourceId(OFFICIAL)], // aus diesen Quellen kommen auch neue Mods ohne Nachfrage
  disabled: [], // abgeschaltete Mods
};

let settings = loadSettings();
let win = null;
let tray = null;
let quitting = false;
let updates = { list: [], errors: [], checkedAt: null, busy: false, installed: [] };
const log = (...a) => console.log("[CommandWave]", ...a);

/* ---------------- Einstellungen ---------------- */
function loadSettings() {
  try {
    const s = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")) };
    if (!Array.isArray(s.trusted)) s.trusted = [...DEFAULTS.trusted];
    return s;
  } catch {
    return { ...DEFAULTS };
  }
}
function saveSettings(patch) {
  settings = { ...settings, ...patch };
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

/* ---------------- Gelernte Aussprache ---------------- */
function loadAliases() {
  try {
    const a = JSON.parse(fs.readFileSync(ALIASES_FILE, "utf8"));
    return a && typeof a === "object" && !Array.isArray(a) ? a : {};
  } catch {
    return {};
  }
}
function saveAliases(a) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(ALIASES_FILE, JSON.stringify(a, null, 2));
}

/* ---------------- Rückfragen („Was soll ich suchen?“) ----------------
 * Ein Befehl fragt nach, das Fenster liest die Frage vor, hört frei (ohne Befehlsliste) zu und schickt die Antwort. */
const asks = new Map();
let askId = 0;
function ask(question, lang) {
  if (!alive()) return Promise.resolve(null);
  const id = ++askId;
  return new Promise((resolve) => {
    const t = setTimeout(() => asks.delete(id) && resolve(null), 30000);
    asks.set(id, (text) => (clearTimeout(t), asks.delete(id), resolve(text)));
    send("ask", { id, say: question, lang });
  });
}

/* ---------------- Assistent ---------------- */
const actions = createActions({
  openExternal: (u) => shell.openExternal(u),
  openPath: (p) => shell.openPath(p),
  diagDir: DATA,
  screenshotDir: path.join(app.getPath("pictures"), "Screenshots"),
  // Overlay nicht mit aufs Bildschirmfoto
  beforeScreenshot: async () => {
    if (overlay && !overlay.isDestroyed() && overlay.isVisible()) {
      overlay.hide();
      overlayShown = false;
      await new Promise((r) => setTimeout(r, 250));
    }
  },
});
const assistant = new Assistant({
  modsDir: MODS_DIR,
  dataDir: DATA,
  actions,
  say: (text) => send("speak", text),
  notify: (title, body) => notify(title, body),
  ask,
  log,
  disabled: settings.disabled,
  // Töne im Fenster (Weckton): das Fenster muss dafür geladen sein, auch versteckt
  sound: (name, on) => {
    if (!alive()) createWindow(false);
    const go = () => send("sound", { name, on });
    win.webContents.isLoading() ? win.webContents.once("did-finish-load", () => setTimeout(go, 1500)) : go();
  },
  reveal: (file) => shell.showItemInFolder(String(file)),
});
assistant.aliases = loadAliases();

function reloadMods() {
  const r = assistant.reload(settings.disabled);
  send("mods", modsState());
  return r;
}

function modsState() {
  return {
    mods: assistant.mods.map(({ dir, ...m }) => m),
    errors: assistant.errors,
    grammar: assistant.grammar,
    grammars: assistant.grammars,
    models: modelUrls(),
    commands: assistant.compiled.map((c) => ({ id: c.id, mod: c.mod, phrases: c.phrases })),
    slots: Object.fromEntries(Object.entries(assistant.slots).map(([k, v]) => [k, Object.entries(v).map(([key, val]) => (val && typeof val === "object" && val.label) || key)])),
    updates: { ...updates, list: updates.list.map(({ entry, source, ...u }) => u) },
    foundApps,
    // Werte, deren Aussprache man lernen kann: { app: [[gesprochen, Anzeige], …], … }
    learn: Object.fromEntries(LEARNABLE.filter((k) => assistant.slots[k]).map((k) => [k, Object.entries(assistant.slots[k]).filter(([key, v]) => !isAlias(k, key) && !(v && v.lang === "en" && settings.language === "de"))
      .map(([key, v]) => [key, (v && typeof v === "object" && v.label) || key])])),
    aliases: assistant.aliases,
  };
}
const LEARNABLE = ["app", "seite", "ordner", "player", "suchseite", "einstellung"];
const isAlias = (slot, key) => !!assistant.aliases[slot]?.[key];

/** Welche Sprachmodelle das Fenster laden soll (je nach Einstellung) */
function modelUrls() {
  const langs = SMOKE || settings.language === "both" ? ["de", "en"] : [settings.language === "en" ? "en" : "de"];
  return Object.fromEntries(langs.filter((l) => fs.existsSync(path.join(RES, "models", `vosk-model-${l}.tar.gz`))).map((l) => [l, `cw://app/model/vosk-model-${l}.tar.gz`]));
}

/* ---------------- Mod-Updater ---------------- */
async function checkUpdates({ install = settings.autoUpdate } = {}) {
  if (updates.busy) return modsState();
  updates.busy = true;
  send("mods", modsState());
  try {
    const installed = assistant.mods.map((m) => ({ id: m.id, version: m.version }));
    const r = await updater.check(settings.sources, installed);
    updates.list = r.updates;
    updates.errors = r.errors;
    updates.checkedAt = Date.now();
    // installierte Mods automatisch aktualisieren; neue Mods nur aus vertrauenswürdigen Quellen, sonst „Installieren“
    if (install) {
      const trusted = new Set(settings.trusted || []);
      for (const u of r.updates.filter((x) => !x.isNew || trusted.has(updater.sourceId(x.source)))) {
        try {
          await installUpdate(u.id, false);
          if (u.isNew) notify("Neue Mod installiert", `${u.name} ${u.to}`);
        } catch (e) {
          updates.errors.push({ source: u.sourceLabel, error: `${u.id}: ${e.message}` });
        }
      }
    }
  } catch (e) {
    updates.errors = [{ source: "Updater", error: e.message }];
  } finally {
    updates.busy = false;
  }
  reloadMods();
  return modsState();
}

async function installUpdate(id, reload = true) {
  const u = updates.list.find((x) => x.id === id);
  if (!u) throw new Error("Kein Update für " + id);
  const r = await updater.install(u, MODS_DIR);
  updates.list = updates.list.filter((x) => x.id !== id);
  updates.installed = [...updates.installed.filter((x) => x.id !== id), { id, version: r.version, at: Date.now() }];
  log("Mod installiert:", id, r.version);
  if (reload) reloadMods();
  return r;
}

function notify(title, body) {
  if (Notification.isSupported()) new Notification({ title, body, icon: asset("icon.png") }).show();
}

/* ---------------- App-Updates (GitHub-Releases, electron-updater) ----------------
 * Sicher installieren: NICHT beim Beenden (fährt Windows dabei herunter oder bremst der Virenscanner den Installer,
 * ist die alte Version schon weg und die neue noch nicht da). Stattdessen, wenn CommandWave ein paar Minuten nicht
 * benutzt wurde: Installer still starten, danach startet die App von selbst wieder. Nie während Windows herunterfährt. */
const appUpdate = { status: "idle", version: null, percent: 0, error: null, readyAt: null, errorSince: null };
let autoUpdater = null;
let lastActivity = Date.now();
let sessionEnding = false;
const IDLE_BEFORE_INSTALL = 3 * 60 * 1000;
const touch = () => (lastActivity = Date.now());

/** Protokoll für Updates: …\CommandWave\update.log */
const updateLog = (level) => (...a) => {
  try {
    fs.appendFileSync(path.join(DATA, "update.log"), `[${new Date().toISOString()}] ${level}: ${a.map((x) => (x && x.stack) || String(x)).join(" ")}\n`);
  } catch {
    // nicht schreibbar
  }
};

function installUpdateNow() {
  if (!autoUpdater || appUpdate.status !== "ready" || sessionEnding) return false;
  updateLog("info")("Installiere Version", appUpdate.version, appUpdate.file ? "(Ersatzweg)" : "");
  quitting = true;
  if (appUpdate.file) {
    // selbst geladener Installer: still installieren, danach CommandWave wieder starten
    spawn(appUpdate.file, ["/S", "--updated", "--force-run"], { detached: true, stdio: "ignore" }).unref();
    setTimeout(() => app.exit(0), 300);
    return true;
  }
  autoUpdater.quitAndInstall(true, true); // still installieren, danach wieder starten
  return true;
}

function setAppUpdate(p) {
  // für den Hinweis im Fenster: seit wann ist das Update bereit / klappt die Prüfung nicht
  if (p.status === "ready" && appUpdate.status !== "ready") p.readyAt = Date.now();
  if (p.status === "error") p.errorSince = appUpdate.errorSince || Date.now();
  else if (["current", "ready", "downloading"].includes(p.status)) p.errorSince = null; // „checking“ zählt nicht als Erfolg
  Object.assign(appUpdate, p);
  send("appUpdate", appUpdate);
}
const isNetError = (e) => /net::ERR_|ENOTFOUND|ECONN|ETIMEDOUT|EAI_AGAIN/.test(String(e?.message || e));

/** Ersatzweg, wenn electron-updater nicht ins Netz darf: über Node prüfen und laden */
let fallbackBusy = false;
async function fallbackUpdate(set) {
  if (fallbackBusy || appUpdate.status === "ready") return;
  fallbackBusy = true;
  try {
    updateLog("info")("Prüfe über den Ersatzweg (Node)");
    const info = await selfUpdate.check(app.getVersion());
    if (!info) return set({ status: "current", error: null });
    set({ status: "downloading", version: info.version, percent: 0, error: null });
    const file = await selfUpdate.download(info, path.join(app.getPath("temp"), "commandwave-update"), { onProgress: (p) => p % 5 === 0 && set({ percent: p }) });
    set({ status: "ready", version: info.version, file });
    notify("CommandWave-Update bereit", `Version ${info.version} wird installiert, sobald du CommandWave ein paar Minuten nicht benutzt.`);
    buildTray();
  } catch (e) {
    updateLog("error")("Ersatzweg:", e);
    set({ status: "error", error: String(e?.message || e).slice(0, 200) });
  } finally {
    fallbackBusy = false;
  }
}

function setupAppUpdates() {
  if (!app.isPackaged || SMOKE) return;
  ({ autoUpdater } = require("electron-updater"));
  autoUpdater.logger = { info: updateLog("info"), warn: updateLog("warn"), error: updateLog("error"), debug: () => {} };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  const set = setAppUpdate;
  autoUpdater.on("checking-for-update", () => set({ status: "checking", error: null }));
  autoUpdater.on("update-available", (i) => set({ status: "downloading", version: i.version, percent: 0 }));
  autoUpdater.on("update-not-available", () => set({ status: "current" }));
  autoUpdater.on("download-progress", (p) => set({ status: "downloading", percent: Math.round(p.percent) }));
  autoUpdater.on("update-downloaded", (i) => {
    set({ status: "ready", version: i.version });
    notify("CommandWave-Update bereit", `Version ${i.version} wird installiert, sobald du CommandWave ein paar Minuten nicht benutzt.`);
    buildTray();
  });
  autoUpdater.on("error", (e) => {
    updateLog("error")(e);
    if (appUpdate.file) return; // Ersatzweg hat schon geladen
    // Netzwerk-Fehler von Chromium (z. B. ERR_NETWORK_ACCESS_DENIED): selbst über Node versuchen
    if (isNetError(e)) return fallbackUpdate(set);
    set({ status: "error", error: String(e?.message || e).slice(0, 200) });
  });
  const check = () => settings.appAutoUpdate && autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 10000);
  setInterval(check, 4 * 3600 * 1000);
  // jede Minute: ist ein Update bereit und CommandWave seit ein paar Minuten unbenutzt? → jetzt installieren
  setInterval(() => {
    if (appUpdate.status === "ready" && settings.appAutoUpdate && Date.now() - lastActivity > IDLE_BEFORE_INSTALL && !(alive() && win.isFocused())) installUpdateNow();
  }, 60 * 1000);
}

/* ---------------- Fehlerbericht ----------------
 * Alles, was man zur Fehlersuche braucht, in einem Text: Version, Windows, Einstellungen, Mods, Update-Stand und die
 * letzten Zeilen der Protokolle. Keine gelernten Wörter, keine Erinnerungs-Texte. */
function tail(file, lines = 150) {
  try {
    const t = fs.readFileSync(path.join(DATA, file), "utf8").split(/\r?\n/);
    return t.slice(-lines).join("\n").trim() || "(leer)";
  } catch {
    return "(keine Datei)";
  }
}
function buildReport() {
  const os = require("node:os");
  const { sources, trusted, ...s } = settings;
  const m = app.getAppMetrics();
  return [
    `CommandWave-Fehlerbericht · ${new Date().toISOString()}`,
    `Version ${app.getVersion()} · Electron ${process.versions.electron} · Windows ${os.release()} (${os.arch()}) · ${Math.round(os.totalmem() / 1e9)} GB RAM · ${os.cpus().length} Kerne`,
    `Speicher CommandWave: ${Math.round(m.reduce((a, p) => a + (p.memory?.workingSetSize || 0), 0) / 1024)} MB in ${m.length} Prozessen`,
    `App-Update: ${JSON.stringify(appUpdate)}`,
    `Mods: ${assistant.mods.map((x) => `${x.id}@${x.version}${x.enabled ? "" : " (aus)"}${x.error ? " FEHLER " + x.error : ""}`).join(", ")}`,
    `Mod-Fehler: ${JSON.stringify(assistant.errors)} · Mod-Updates: ${JSON.stringify({ errors: updates.errors, checkedAt: updates.checkedAt })}`,
    `Quellen: ${(sources || []).map((x) => x.repo || x.path || x.url).join(", ")} · Apps gefunden: ${foundApps} · Befehle: ${assistant.compiled.length}`,
    `Einstellungen: ${JSON.stringify(s)}`,
    "",
    "===== fehler.log =====",
    tail("fehler.log"),
    "",
    "===== update.log =====",
    tail("update.log"),
    "",
    "===== amazon-music.log =====",
    tail("amazon-music.log", 200),
  ].join("\n");
}

/* ---------------- Fenster & Tray ---------------- */
const asset = (f) => path.join(ROOT, "build", f);

function createWindow(show = true) {
  // eigene Variable je Fenster: Ereignisse eines alten Fensters dürfen nie ein neues treffen
  const w = new BrowserWindow({
    width: 460,
    height: 680,
    minWidth: 400,
    minHeight: 520,
    show: false,
    title: "CommandWave",
    icon: asset("icon.png"),
    backgroundColor: "#12141a",
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#12141a", symbolColor: "#c8d0e0", height: 36 },
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  win = w;
  w.removeMenu();
  if (SMOKE) {
    // Testmodus: Meldungen aus dem Fenster mit ausgeben
    w.webContents.on("console-message", (e) => console.log("[fenster]", e.message));
    w.webContents.on("did-fail-load", (_e, code, desc, url) => console.log("[laden fehlgeschlagen]", code, desc, url));
    w.webContents.on("render-process-gone", (_e, d) => console.log("[fenster abgestürzt]", JSON.stringify(d)));
  }
  w.loadURL("cw://app/index.html");
  w.once("ready-to-show", () => show && !w.isDestroyed() && w.show());
  w.on("close", (e) => {
    if (!quitting && settings.closeToTray) {
      e.preventDefault();
      w.hide();
    }
  });
  // Fenster wurde wirklich geschlossen (Beenden, Update, „Schließen ins Tray“ aus) → vergessen,
  // sonst greift „Fenster zeigen“ später auf ein zerstörtes Fenster zu („Object has been destroyed“)
  w.on("closed", () => {
    if (win === w) win = null;
  });
  // Windows meldet sich ab / fährt herunter: jetzt kein Update installieren
  w.on("query-session-end", () => (sessionEnding = true));
  w.on("session-end", () => (sessionEnding = true));
  // Fenster (oder Spracherkennung darin) abgestürzt: protokollieren und neu öffnen statt stehen zu bleiben
  w.webContents.on("render-process-gone", (_e, d) => {
    logCrash("Fenster abgestürzt", new Error(JSON.stringify(d)));
    if (quitting || d.reason === "clean-exit") return;
    if (win === w) win = null;
    if (!w.isDestroyed()) w.destroy();
    setTimeout(() => createWindow(false), 1000);
  });
  w.webContents.on("unresponsive", () => logCrash("Fenster reagiert nicht", new Error("unresponsive")));
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  return w;
}

const alive = () => win && !win.isDestroyed();

/* ---------------- Overlay: kleine Anzeige am Bildschirmrand beim Zuhören ----------------
 * Zeigt sich nur, wenn das Hauptfenster nicht vorne ist; nimmt nie den Fokus und lässt Mausklicks durch. */
const OV = { w: 380, h: 96 };
let overlay = null;
let overlayHide = null;
let overlayShown = false;
function ensureOverlay() {
  if (overlay && !overlay.isDestroyed()) return overlay;
  overlay = new BrowserWindow({
    width: OV.w, height: OV.h, show: false, frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
    focusable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, title: "CommandWave",
    webPreferences: { preload: path.join(__dirname, "overlay-preload.js"), contextIsolation: true, sandbox: true },
  });
  overlay.setAlwaysOnTop(true, "screen-saver");
  overlay.setIgnoreMouseEvents(true);
  overlay.loadURL("cw://app/overlay.html");
  overlay.on("closed", () => (overlay = null));
  return overlay;
}
function hideOverlay(ms = 2500) {
  clearTimeout(overlayHide);
  overlayHide = setTimeout(() => {
    overlayShown = false;
    if (overlay && !overlay.isDestroyed()) overlay.hide();
  }, ms);
}
function overlayUpdate(d) {
  if (!settings.overlay || !d) return;
  const busy = ["listening", "thinking", "speaking"].includes(d.mode);
  const mainVisible = alive() && win.isVisible() && !win.isMinimized() && win.isFocused();
  if (busy && !mainVisible) {
    clearTimeout(overlayHide);
    const o = ensureOverlay();
    if (!overlayShown) {
      // unten mittig auf dem Bildschirm, auf dem gerade die Maus ist
      const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
      o.setBounds({ x: Math.round(wa.x + (wa.width - OV.w) / 2), y: wa.y + wa.height - OV.h - 28, width: OV.w, height: OV.h });
      o.showInactive();
      overlayShown = true;
    }
  }
  if (overlay && !overlay.isDestroyed()) overlay.webContents.send("update", d);
  if (!busy && overlayShown) hideOverlay(d.mode === "error" ? 4000 : 2500);
}
ipcMain.on("overlay", (_e, d) => overlayUpdate(d));

function showWindow() {
  if (!alive()) return createWindow(true);
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function send(ch, data) {
  if (alive() && !win.webContents.isDestroyed()) win.webContents.send(ch, data);
}

function buildTray() {
  tray = new Tray(nativeImage.createFromPath(asset("tray.png")).resize({ width: 16, height: 16 }));
  tray.setToolTip("CommandWave – " + prettyKey(settings.hotkey) + " zum Sprechen");
  tray.on("click", showWindow);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Zuhören (${prettyKey(settings.hotkey)})`, click: () => listen() },
    { label: "Fenster öffnen", click: showWindow },
    { type: "separator" },
    { label: "Mods neu laden", click: reloadMods },
    { label: "Nach Mod-Updates suchen", click: () => checkUpdates() },
    { label: "Mods-Ordner öffnen", click: () => shell.openPath(MODS_DIR) },
    ...(appUpdate.status === "ready" ? [{ label: `Update ${appUpdate.version} jetzt installieren`, click: installUpdateNow }] : []),
    { label: "Fehlerbericht kopieren", click: () => (clipboard.writeText(buildReport()), notify("Fehlerbericht kopiert", "Jetzt einfach einfügen (Strg + V) und schicken.")) },
    { type: "separator" },
    { label: "Beenden", click: () => app.quit() },
  ]));
}

const prettyKey = (k) => (k === settings.hotkey && settings.hotkeyLabel ? settings.hotkeyLabel : String(k || "").replace("Control", "Strg").replace("Space", "Leertaste").replace(/\+/g, " + "));

/**
 * Gedrückt gehaltene Tasten wiederholt Windows ständig – das würde das Zuhören sofort wieder beenden.
 * Nur ein neuer Druck (Pause > 400 ms seit dem letzten Signal) zählt.
 */
let lastHotkey = 0;
function hotkeyPressed() {
  const now = Date.now();
  const fresh = now - lastHotkey > 400;
  lastHotkey = now;
  if (fresh) listen();
}

/** Installierte Apps aus dem Startmenü (auch Store-Apps) für „Öffne …“ */
function discoverApps() {
  if (process.platform !== "win32") return Promise.resolve(0);
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", START_APPS_CMD], { windowsHide: true, maxBuffer: 20 * 1024 * 1024, timeout: 30000 }, (err, stdout) => {
      if (err) {
        log("Apps aus dem Startmenü nicht lesbar:", err.message);
        return resolve(0);
      }
      try {
        const slots = toSlots(JSON.parse(stdout || "[]"));
        foundApps = Object.keys(slots).length;
        // nur neu aufbauen, wenn sich die Apps geändert haben (spart den Neuaufbau der Erkennung)
        const sig = JSON.stringify(Object.keys(slots).sort());
        if (sig !== lastAppsSig) {
          lastAppsSig = sig;
          assistant.setExtraSlots({ app: slots });
          send("mods", modsState());
        }
        resolve(foundApps);
      } catch (e) {
        log("Apps-Liste kaputt:", e.message);
        resolve(0);
      }
    });
  });
}
let foundApps = 0;
let lastAppsSig = "";

/** Zuhören starten (Tastenkombination, Tray oder Knopf) */
function listen() {
  touch();
  if (!alive()) createWindow(false);
  if (settings.showOnHotkey) showWindow();
  send("listen");
}

/** Tastenkombination bei Windows anmelden → Fehlertext oder null */
function tryRegister(acc) {
  globalShortcut.unregisterAll();
  if (!acc) return null;
  try {
    return globalShortcut.register(acc, hotkeyPressed) ? null : "belegt";
  } catch {
    return "ungültig";
  }
}

function registerHotkey() {
  const err = tryRegister(settings.hotkey);
  if (err === "belegt") return `Die Tastenkombination ${prettyKey(settings.hotkey)} ist schon von einem anderen Programm belegt.`;
  if (err) return `Ungültige Tastenkombination: ${settings.hotkey}`;
  return null;
}

/* ---------------- IPC (Fenster ↔ Hauptprozess) ---------------- */
ipcMain.handle("state", async () => ({ settings, version: app.getVersion(), modsDir: MODS_DIR, hotkeyError: hotkeyError, smoke: SMOKE, ...(SMOKE ? await smokeExtras() : {}), ...modsState() }));

/** Testmodus: Testsätze mit der Windows-Stimme als WAV sprechen lassen + bisherige Satz-Grammatik zum Vergleich */
const SMOKE_SENTENCES_EN = ["open notepad", "what time is it", "next song", "close the tab", "volume up", "pause the music", "what is playing", "new tab",
  "what day is it today", "open youtube", "start the calculator", "turn it down", "open downloads", "set a timer for five minutes", "what can you do", "lock the computer"];
const SMOKE_SENTENCES = ["öffne die app editor", "wie spät ist es", "nächstes lied", "schließe den tab", "lauter", "pause", "was läuft gerade", "neuer tab",
  "welcher tag ist heute", "öffne youtube", "starte den rechner", "mach leiser", "öffne downloads", "stelle einen timer auf fünf minuten", "was kannst du", "würfle"];
async function smokeExtras() {
  const out = { audio: [] };
  if (process.platform !== "win32") return out;
  const dir = path.join(DATA, "testaudio");
  fs.mkdirSync(dir, { recursive: true });
  // dazu: Aktivierungswort (muss auslösen) und freie Sätze (für Suche/Aussprache, ohne Befehlsliste)
  const all = [...SMOKE_SENTENCES.map((t) => ({ text: t, lang: "de" })), ...SMOKE_SENTENCES_EN.map((t) => ({ text: t, lang: "en" })),
    { text: "hey wave", lang: "en", kind: "wake" }, { text: "hey computer", lang: "en", kind: "wake" },
    { text: "hey wave what time is it", lang: "en", kind: "wake", wakeWord: "hey wave" }, { text: "hey wave", lang: "de", kind: "wake" },
    { text: "play songs by coldplay", lang: "en", kind: "tail" }, { text: "search for funny cat videos", lang: "en", kind: "tail" }, { text: "funny cat videos", lang: "en", kind: "free" }, { text: "weather in berlin tomorrow", lang: "en", kind: "free" }];
  // echte menschliche Aussprache (Wikimedia Commons, CC BY-SA): einzelne deutsche Wörter
  for (const [i, w] of ["bunt", "und", "Musik", "Lied", "spielen", "Bonn"].entries()) {
    try {
      const api = await (await fetch(`https://commons.wikimedia.org/w/api.php?action=query&titles=File:De-${w}.ogg&prop=imageinfo&iiprop=url&format=json`, { headers: { "User-Agent": "CommandWave-Test/1.0" } })).json();
      const url = Object.values(api.query.pages)[0].imageinfo[0].url;
      const buf = Buffer.from(await (await fetch(url, { headers: { "User-Agent": "CommandWave-Test/1.0" } })).arrayBuffer());
      fs.writeFileSync(path.join(dir, `mensch${i}.ogg`), buf);
      out.audio.push({ text: w.toLowerCase(), lang: "de", kind: "human", url: `cw://app/testaudio/mensch${i}.ogg` });
    } catch (e) {
      console.log("Testaufnahme nicht ladbar:", w, e.message);
    }
  }
  for (const [i, { text, lang, kind, wakeWord }] of all.entries()) {
    const file = path.join(dir, `satz${i}.wav`);
    const ps = "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; " +
      `$f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono); $s.SetOutputToWaveFile('${file.replace(/'/g, "''")}', $f); $s.Speak('${text}'); $s.Dispose()`;
    await new Promise((r) => execFile("powershell.exe", ["-NoProfile", "-Command", ps], { windowsHide: true, timeout: 30000 }, r));
    if (fs.existsSync(file)) out.audio.push({ text, lang, kind: kind || "command", wakeWord, url: `cw://app/testaudio/satz${i}.wav` });
  }
  return out;
}
ipcMain.handle("match", (_e, text, lang) => (SMOKE ? assistant.matchOnly(text, lang || "de") : null));
ipcMain.handle("smoke", (_e, data) => {
  if (!SMOKE) return;
  console.log("SMOKE " + JSON.stringify(data));
  setTimeout(() => app.exit(data && data.ok ? 0 : 1), 200);
});
ipcMain.handle("command", (_e, text, lang) => (touch(), assistant.handle(String(text || ""), lang === "en" ? "en" : settings.language === "en" ? "en" : "de")));
// Erkennungen mehrerer Sprachen: die passendste ausführen, Antwort in deren Sprache
ipcMain.handle("commandMulti", (_e, cands, opts) => (touch(), assistant.handleMulti(cands, settings.language === "en" ? "en" : "de", opts || {})));
// „Meintest du …?“ → Antwort (ja/nein)
ipcMain.handle("confirm", (_e, text) => (touch(), assistant.answerConfirm(String(text || ""))));
// Mikrofon-Test: nur zeigen, was verstanden würde
ipcMain.handle("preview", (_e, cands) => assistant.preview(cands));
ipcMain.handle("ask:answer", (_e, id, text) => asks.get(id)?.(text ? String(text) : null));
// Aussprache lernen: „gehört“ ist ein weiterer Name für einen vorhandenen Wert
// heard: ein Text oder mehrere (alle Varianten, die beim Vorsprechen verstanden wurden)
// slot "_woerter": eigenes Wort (key = so wird es geschrieben, z. B. „DoctorBenx“) – für Suchbegriffe
ipcMain.handle("alias:add", (_e, { slot, key, heard, lang }) => {
  const norm = (t) => String(t || "").toLowerCase().replace(/\[unk\]/g, " ").replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();
  const word = slot === WORDS;
  if (word) key = String(key || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 40);
  const list = [...new Set([].concat(heard || []).map(norm))].filter((h) => h && h.split(" ").length <= 4 && h !== norm(key));
  if (!(word ? key : LEARNABLE.includes(slot) && assistant.slots[slot]?.[key])) return { ok: false, error: "ungültig" };
  if (!list.length) return { ok: false, same: [].concat(heard || []).some((h) => norm(h) === norm(key)) };
  const entries = Object.fromEntries(list.map((h) => [h, { key, lang: lang === "en" ? "en" : "de" }]));
  const a = { ...assistant.aliases, [slot]: { ...(assistant.aliases[slot] || {}), ...entries } };
  saveAliases(a);
  assistant.setAliases(a);
  send("mods", modsState());
  return { ok: true, heard: list };
});
ipcMain.handle("alias:remove", (_e, { slot, heard }) => {
  const a = { ...assistant.aliases, [slot]: { ...(assistant.aliases[slot] || {}) } };
  delete a[slot][heard];
  if (!Object.keys(a[slot]).length) delete a[slot];
  saveAliases(a);
  assistant.setAliases(a);
  send("mods", modsState());
  return { ok: true };
});
ipcMain.handle("settings:save", (_e, patch) => {
  const allowed = Object.keys(DEFAULTS);
  const p = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => allowed.includes(k)));
  // neue Tastenkombination erst übernehmen, wenn Windows sie annimmt – sonst bleibt die alte
  if ("hotkey" in p) {
    const err = tryRegister(p.hotkey);
    if (err) {
      const label = p.hotkeyLabel || p.hotkey;
      delete p.hotkey;
      delete p.hotkeyLabel;
      saveSettings(p);
      registerHotkey();
      return { settings, hotkeyError: err === "belegt" ? `${label} ist schon von einem anderen Programm belegt – bitte eine andere Kombination wählen.` : `${label} geht als Tastenkombination nicht.` };
    }
    hotkeyError = null;
  }
  saveSettings(p);
  if ("autostart" in p && app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!settings.autostart, args: ["--hidden"] });
  if ("disabled" in p) reloadMods();
  if ("overlay" in p && !settings.overlay) hideOverlay(0);
  if ("language" in p) send("mods", modsState()); // Fenster lädt die passenden Sprachmodelle
  if (tray && "hotkey" in p) buildTray();
  return { settings, hotkeyError };
});
ipcMain.handle("mods:reload", async () => (reloadMods(), await discoverApps(), modsState()));
ipcMain.handle("mods:folder", () => shell.openPath(MODS_DIR));
ipcMain.handle("mods:check", () => checkUpdates({ install: settings.autoUpdate }));
ipcMain.handle("mods:install", async (_e, id) => {
  try {
    await installUpdate(id);
    return { ok: true, state: modsState() };
  } catch (e) {
    return { ok: false, error: e.message, state: modsState() };
  }
});
ipcMain.handle("window:hide", () => alive() && win.hide());
// beim Aufnehmen einer neuen Tastenkombination die globalen kurz abschalten
ipcMain.handle("hotkey:pause", () => globalShortcut.unregisterAll());
ipcMain.handle("hotkey:resume", () => (hotkeyError = registerHotkey()));
ipcMain.handle("app:update", () => appUpdate);
ipcMain.handle("app:checkUpdate", async () => {
  if (!autoUpdater) return { status: "dev" };
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    if (!isNetError(e)) return { ...appUpdate, status: "error", error: e.message };
    await fallbackUpdate(setAppUpdate); // Chromium darf nicht ins Netz → über Node
  }
  return appUpdate;
});
ipcMain.handle("app:installUpdate", () => installUpdateNow());
// neueste Version von Hand laden (wenn automatische Updates klemmen)
ipcMain.handle("app:download", () => shell.openExternal("https://github.com/xNikYox/commandwave/releases/latest/download/CommandWave-Setup.exe"));
ipcMain.handle("report:copy", () => {
  const text = buildReport();
  clipboard.writeText(text);
  const file = path.join(DATA, "fehlerbericht.txt");
  try {
    fs.writeFileSync(file, text);
  } catch {
    // nicht schreibbar
  }
  return { ok: true, chars: text.length, file };
});
ipcMain.handle("report:folder", () => shell.openPath(DATA));
// Testmodus: Overlay öffnen und prüfen, ob es lädt und Meldungen anzeigt
ipcMain.handle("overlay:test", () => new Promise((resolve) => {
  if (!SMOKE) return resolve(null);
  const o = ensureOverlay();
  const done = (r) => (clearTimeout(t), ipcMain.removeAllListeners("overlay:shown"), resolve(r));
  const t = setTimeout(() => done({ ok: false, error: "keine Antwort" }), 15000);
  ipcMain.once("overlay:shown", (_e, text) => done({ ok: text === "Ich höre zu …", text, visible: o.isVisible(), bounds: o.getBounds() }));
  const go = () => {
    overlayShown = false;
    if (alive()) win.blur();
    overlayUpdate({ mode: "listening", text: "Ich höre zu …", heard: "", level: 0.4 });
    if (!overlayShown) o.showInactive();
    o.webContents.send("update", { mode: "listening", text: "Ich höre zu …", heard: "", level: 0.4, echo: true });
  };
  o.webContents.isLoading() ? o.webContents.once("did-finish-load", go) : go();
}));

let hotkeyError = null;

/* ---------------- Start ---------------- */
app.on("second-instance", showWindow);

app.whenReady().then(async () => {
  // Alles unter einer Herkunft (cw://app/), damit Erkennung und Modell im Worker ohne CORS laden:
  //   cw://app/…        Oberfläche      cw://app/vosk/…  Erkennung (vosk-browser)      cw://app/model/…  Sprachmodell
  protocol.handle("cw", (req) => {
    const u = new URL(req.url);
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, "");
    let base = path.join(__dirname, "renderer");
    let sub = rel;
    if (rel.startsWith("vosk/")) (base = path.join(ROOT, "node_modules", "vosk-browser", "dist")), (sub = rel.slice(5));
    else if (rel.startsWith("tjs/")) (base = path.join(RES, "vendor", "transformers")), (sub = rel.slice(4)); // Whisper-Laufzeit
    else if (SMOKE && rel.startsWith("testaudio/")) (base = path.join(DATA, "testaudio")), (sub = rel.slice(10));
    else if (rel.startsWith("model/")) (base = path.join(RES, "models")), (sub = rel.slice(6));
    const file = path.join(base, sub);
    if (u.host !== "app" || !file.startsWith(base + path.sep) || !fs.existsSync(file)) return new Response("Nicht gefunden", { status: 404 });
    // „cross-origin isolated“: erst damit darf WebAssembly mehrere Kerne nutzen (Whisper ~3× schneller)
    return net.fetch(pathToFileURL(file).toString()).then((r) => {
      const headers = new Headers(r.headers);
      headers.set("Cross-Origin-Opener-Policy", "same-origin");
      headers.set("Cross-Origin-Embedder-Policy", "require-corp");
      headers.set("Cross-Origin-Resource-Policy", "same-origin");
      if (/\.m?js$/.test(file)) headers.set("Content-Type", "text/javascript");
      if (/\.wasm$/.test(file)) headers.set("Content-Type", "application/wasm");
      return new Response(r.body, { status: r.status, headers });
    });
  });
  // Mikrofon nur für das eigene Fenster erlauben
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === "media" && wc.getURL().startsWith("cw://app/")));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => perm === "media" && !!wc && wc.getURL().startsWith("cw://app/"));

  if (FULLTEST) {
    // Nachstellen des gemeldeten Absturzes: Fenster zerstört, dann App erneut gestartet / Tray geklickt
    let windowTest = "nicht gelaufen";
    setTimeout(() => {
      try {
        win?.destroy();
        app.emit("second-instance");
        windowTest = alive() ? "Fenster neu geöffnet" : "kein Fenster";
      } catch (e) {
        windowTest = "Fehler: " + e.message;
      }
    }, 25000);
    // Tastenkombinationen, die man jetzt einstellen kann, müssen sich bei Windows anmelden lassen
    const hotkeys = {};
    setTimeout(() => {
      for (const acc of ["Control+/", "Control+num1", "num5", "Control+Alt+numadd", "F9", "Control+Shift+Space", "Control+-", "Control+."]) hotkeys[acc] = tryRegister(acc) || "ok";
      registerHotkey();
    }, 30000);
    // Test des normalen Starts (Tray, App-Updater, Mod-Updates, App-Suche): 45 s laufen lassen, Stand ausgeben, beenden
    setTimeout(() => {
      const m = app.getAppMetrics();
      const perf = {
        processes: m.length,
        memoryMB: Math.round(m.reduce((a, p) => a + (p.memory?.workingSetSize || 0), 0) / 1024),
        cpuPercent: Math.round(m.reduce((a, p) => a + (p.cpu?.percentCPUUsage || 0), 0) * 10) / 10,
        types: m.map((p) => p.type).join(","),
      };
      console.log("FULLTEST " + JSON.stringify({ windowTest, hotkeys, perf, mods: assistant.mods.map((m) => m.id + "@" + m.version), foundApps, updates: { errors: updates.errors, installed: updates.installed }, appUpdate, tray: !!tray, grammar: assistant.grammar.length }));
      quitting = true;
      app.exit(0);
    }, 45000);
  }
  if (SMOKE) {
    setTimeout(() => {
      console.log("SMOKE " + JSON.stringify({ ok: false, error: "Zeitüberschreitung" }));
      app.exit(2);
    }, 280000);
  }
  const copied = seedDefaults(DEFAULT_MODS, MODS_DIR);
  if (copied.length) log("Mitgelieferte Mods eingerichtet:", copied.join(", "));
  assistant.reload(settings.disabled);
  discoverApps();
  setInterval(discoverApps, 30 * 60 * 1000); // neu installierte Apps alle 30 Minuten übernehmen
  hotkeyError = registerHotkey();
  if (!SMOKE) buildTray();
  createWindow(!(SMOKE || process.argv.includes("--hidden") || settings.startHidden));
  if (!SMOKE && settings.checkOnStart && settings.sources.length) setTimeout(() => checkUpdates(), 4000);
  if (!SMOKE) setInterval(() => settings.sources.length && checkUpdates(), 6 * 3600 * 1000); // Mods alle 6 Stunden
  setupAppUpdates();
});

app.on("window-all-closed", () => {
  // läuft im Tray weiter
});
app.on("before-quit", () => {
  quitting = true;
  if (overlay && !overlay.isDestroyed()) overlay.destroy();
});
app.on("child-process-gone", (_e, d) => {
  if (d.reason !== "clean-exit" && d.reason !== "killed") logCrash("Hilfsprozess beendet", new Error(JSON.stringify(d)));
});
app.on("will-quit", () => globalShortcut.unregisterAll());
