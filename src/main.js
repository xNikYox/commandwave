// CommandWave – Hauptprozess: Fenster, Tray-Icon, Tastenkombination, Mods, Mod-Updater, Einstellungen.
// Spracherkennung (Vosk) und Sprachausgabe (Windows-Stimmen) laufen im Fenster – komplett offline.
const { app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, nativeImage, Notification, shell, protocol, net, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { Assistant } = require("./core/assistant");
const { createActions } = require("./core/actions");
const { seedDefaults } = require("./core/mods");
const updater = require("./core/updater");

if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}
app.setAppUserModelId("de.xnikyox.commandwave");

// Eigenes Protokoll cw:// für Oberfläche, Erkennung und Sprachmodell (fetch/Worker brauchen eine echte Herkunft)
protocol.registerSchemesAsPrivileged([{ scheme: "cw", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

const ROOT = path.join(__dirname, "..");
const RES = app.isPackaged ? process.resourcesPath : ROOT;
const DATA = app.getPath("userData");
const MODS_DIR = path.join(DATA, "mods");
const DEFAULT_MODS = path.join(RES, app.isPackaged ? "mods-default" : "mods");
const SETTINGS_FILE = path.join(DATA, "einstellungen.json");
// Testmodus (GitHub Actions): Fenster unsichtbar laden, Erkennung prüfen, Ergebnis ausgeben, beenden
const SMOKE = process.argv.includes("--smoke");
/** Offizielle Mod-Quelle: hier liegen die mitgelieferten Mods und neue Mods von CommandWave */
const OFFICIAL = { type: "github", repo: "xNikYox/commandwave-mods", branch: "main", dir: "" };

const DEFAULTS = {
  hotkey: "Control+Space",
  voice: "", // leer = erste deutsche Stimme
  rate: 1,
  volume: 1,
  micId: "",
  maxSeconds: 7,
  beep: true,
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

/* ---------------- Assistent ---------------- */
const actions = createActions({
  openExternal: (u) => shell.openExternal(u),
  openPath: (p) => shell.openPath(p),
});
const assistant = new Assistant({
  modsDir: MODS_DIR,
  dataDir: DATA,
  actions,
  say: (text) => send("speak", text),
  notify: (title, body) => notify(title, body),
  log,
  disabled: settings.disabled,
});

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
    commands: assistant.compiled.map((c) => ({ id: c.id, mod: c.mod, phrases: c.phrases })),
    slots: Object.fromEntries(Object.entries(assistant.slots).map(([k, v]) => [k, Object.entries(v).map(([key, val]) => (val && typeof val === "object" && val.label) || key)])),
    updates: { ...updates, list: updates.list.map(({ entry, source, ...u }) => u) },
  };
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

/* ---------------- App-Updates (GitHub-Releases, electron-updater) ---------------- */
const appUpdate = { status: "idle", version: null, percent: 0, error: null };
let autoUpdater = null;
function setupAppUpdates() {
  if (!app.isPackaged || SMOKE) return;
  ({ autoUpdater } = require("electron-updater"));
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  const set = (p) => {
    Object.assign(appUpdate, p);
    send("appUpdate", appUpdate);
  };
  autoUpdater.on("checking-for-update", () => set({ status: "checking", error: null }));
  autoUpdater.on("update-available", (i) => set({ status: "downloading", version: i.version, percent: 0 }));
  autoUpdater.on("update-not-available", () => set({ status: "current" }));
  autoUpdater.on("download-progress", (p) => set({ status: "downloading", percent: Math.round(p.percent) }));
  autoUpdater.on("update-downloaded", (i) => {
    set({ status: "ready", version: i.version });
    notify("CommandWave-Update bereit", `Version ${i.version} wird beim Beenden installiert.`);
  });
  autoUpdater.on("error", (e) => set({ status: "error", error: String(e?.message || e).slice(0, 200) }));
  const check = () => settings.appAutoUpdate && autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 10000);
  setInterval(check, 4 * 3600 * 1000);
}

/* ---------------- Fenster & Tray ---------------- */
const asset = (f) => path.join(ROOT, "build", f);

function createWindow(show = true) {
  win = new BrowserWindow({
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
  win.removeMenu();
  if (SMOKE) {
    // Testmodus: Meldungen aus dem Fenster mit ausgeben
    win.webContents.on("console-message", (e) => console.log("[fenster]", e.message));
    win.webContents.on("did-fail-load", (_e, code, desc, url) => console.log("[laden fehlgeschlagen]", code, desc, url));
    win.webContents.on("render-process-gone", (_e, d) => console.log("[fenster abgestürzt]", JSON.stringify(d)));
  }
  win.loadURL("cw://app/index.html");
  win.once("ready-to-show", () => show && win.show());
  win.on("close", (e) => {
    if (!quitting && settings.closeToTray) {
      e.preventDefault();
      win.hide();
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
}

function showWindow() {
  if (!win) return createWindow(true);
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function send(ch, data) {
  if (win && !win.isDestroyed()) win.webContents.send(ch, data);
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
    ...(appUpdate.status === "ready" ? [{ label: `Update ${appUpdate.version} jetzt installieren`, click: () => autoUpdater.quitAndInstall(true, true) }] : []),
    { type: "separator" },
    { label: "Beenden", click: () => app.quit() },
  ]));
}

const prettyKey = (k) => String(k || "").replace("Control", "Strg").replace("Space", "Leertaste").replace(/\+/g, " + ");

/** Zuhören starten (Tastenkombination, Tray oder Knopf) */
function listen() {
  if (!win) createWindow(false);
  if (settings.showOnHotkey) showWindow();
  send("listen");
}

function registerHotkey() {
  globalShortcut.unregisterAll();
  if (!settings.hotkey) return null;
  try {
    return globalShortcut.register(settings.hotkey, listen) ? null : `Die Tastenkombination ${prettyKey(settings.hotkey)} ist schon von einem anderen Programm belegt.`;
  } catch {
    return `Ungültige Tastenkombination: ${settings.hotkey}`;
  }
}

/* ---------------- IPC (Fenster ↔ Hauptprozess) ---------------- */
ipcMain.handle("state", () => ({ settings, version: app.getVersion(), modsDir: MODS_DIR, hotkeyError: hotkeyError, smoke: SMOKE, ...modsState() }));
ipcMain.handle("smoke", (_e, data) => {
  if (!SMOKE) return;
  console.log("SMOKE " + JSON.stringify(data));
  setTimeout(() => app.exit(data && data.ok ? 0 : 1), 200);
});
ipcMain.handle("command", (_e, text) => assistant.handle(String(text || "")));
ipcMain.handle("settings:save", (_e, patch) => {
  const allowed = Object.keys(DEFAULTS);
  const p = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => allowed.includes(k)));
  saveSettings(p);
  if ("hotkey" in p) hotkeyError = registerHotkey();
  if ("autostart" in p && app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!settings.autostart, args: ["--hidden"] });
  if ("disabled" in p) reloadMods();
  if (tray && "hotkey" in p) buildTray();
  return { settings, hotkeyError };
});
ipcMain.handle("mods:reload", () => (reloadMods(), modsState()));
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
ipcMain.handle("window:hide", () => win?.hide());
ipcMain.handle("app:update", () => appUpdate);
ipcMain.handle("app:checkUpdate", () => (autoUpdater ? autoUpdater.checkForUpdates().then(() => appUpdate).catch((e) => ({ ...appUpdate, status: "error", error: e.message })) : { status: "dev" }));
ipcMain.handle("app:installUpdate", () => {
  if (autoUpdater && appUpdate.status === "ready") {
    quitting = true;
    autoUpdater.quitAndInstall(true, true);
  }
});

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
    else if (rel.startsWith("model/")) (base = path.join(RES, "models")), (sub = rel.slice(6));
    const file = path.join(base, sub);
    if (u.host !== "app" || !file.startsWith(base + path.sep) || !fs.existsSync(file)) return new Response("Nicht gefunden", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  // Mikrofon nur für das eigene Fenster erlauben
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === "media" && wc.getURL().startsWith("cw://app/")));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => perm === "media" && !!wc && wc.getURL().startsWith("cw://app/"));

  if (SMOKE) {
    setTimeout(() => {
      console.log("SMOKE " + JSON.stringify({ ok: false, error: "Zeitüberschreitung" }));
      app.exit(2);
    }, 120000);
  }
  const copied = seedDefaults(DEFAULT_MODS, MODS_DIR);
  if (copied.length) log("Mitgelieferte Mods eingerichtet:", copied.join(", "));
  assistant.reload(settings.disabled);
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
app.on("before-quit", () => (quitting = true));
app.on("will-quit", () => globalShortcut.unregisterAll());
