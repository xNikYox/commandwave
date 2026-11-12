// CommandWave – Mods laden.
//
// Jede Mod ist ein Ordner in mods/ mit einer mod.json:
//   {
//     "id": "apps", "name": "Apps starten", "version": "1.0.0", "author": "…", "description": "…",
//     "slots":    { "app": { "editor": { "target": "notepad.exe", "label": "Editor" }, … } },
//     "commands": [ { "phrases": ["öffne [die app] {app}"], "say": "{app} wird gestartet", "action": { "type": "run", "target": "{app.value}" } } ],
//     "main": "main.js"      ← optional: eigene Logik in JavaScript (siehe Beispiel-Mod „uhrzeit“)
//   }
// Mods werden nur gelesen – der Hauptcode der App bleibt unverändert. „Neu laden“ übernimmt Änderungen sofort.
const fs = require("node:fs");
const path = require("node:path");

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const VERSION = /^\d+(\.\d+){0,3}([-+][0-9A-Za-z.]+)?$/;
const ACTIONS = ["run", "open", "say", "media", "mediaSession", "browser", "keys", "shell", "sequence", "none"];

/** mod.json prüfen → { mod } oder { error } */
function validate(json, dirName) {
  const errors = [];
  if (!json || typeof json !== "object") return { error: "mod.json ist kein JSON-Objekt" };
  if (!ID.test(json.id || "")) errors.push("id fehlt oder ungültig (nur a-z, 0-9, - und _)");
  if (json.id && dirName && json.id !== dirName) errors.push(`id „${json.id}“ passt nicht zum Ordnernamen „${dirName}“`);
  if (!VERSION.test(json.version || "")) errors.push("version fehlt oder ungültig (z. B. 1.0.0)");
  if (json.commands != null && !Array.isArray(json.commands)) errors.push("commands muss eine Liste sein");
  for (const [i, c] of (json.commands || []).entries()) {
    if (!Array.isArray(c.phrases) || !c.phrases.length || c.phrases.some((p) => typeof p !== "string" || !p.trim())) errors.push(`commands[${i}]: phrases fehlt`);
    if (c.action && !ACTIONS.includes(c.action.type)) errors.push(`commands[${i}]: unbekannte Aktion „${c.action.type}“ (erlaubt: ${ACTIONS.join(", ")})`);
  }
  if (json.slots != null && (typeof json.slots !== "object" || Array.isArray(json.slots))) errors.push("slots muss ein Objekt sein");
  if (json.main != null && (typeof json.main !== "string" || json.main.includes("..") || path.isAbsolute(json.main))) errors.push("main ungültig");
  return errors.length ? { error: errors.join("; ") } : { mod: json };
}

/**
 * Alle Mods aus einem Ordner laden. host = { actions, say, log, dataDir } (von der App).
 * → { mods: [...], commands: [...], slots: {...}, errors: [{ dir, error }] }
 */
function loadAll(modsDir, host, disabled = []) {
  const mods = [];
  const errors = [];
  const commands = [];
  const slots = {};
  let names = [];
  try {
    names = fs.readdirSync(modsDir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => d.name).sort();
  } catch {
    return { mods, commands, slots, errors };
  }
  for (const dir of names) {
    const base = path.resolve(modsDir, dir);
    let json;
    try {
      json = JSON.parse(fs.readFileSync(path.join(base, "mod.json"), "utf8"));
    } catch (e) {
      errors.push({ dir, error: "mod.json fehlt oder ist kaputt: " + e.message });
      continue;
    }
    const { mod, error } = validate(json, dir);
    if (error) {
      errors.push({ dir, error });
      continue;
    }
    const info = { id: mod.id, name: mod.name || mod.id, version: mod.version, author: mod.author || "", description: mod.description || "", dir: base,
      script: !!mod.main, enabled: !disabled.includes(mod.id), commands: 0, error: null, examples: [] };
    mods.push(info);
    if (!info.enabled) continue;
    // Platzhalter-Werte zusammenführen (mehrere Mods dürfen z. B. weitere Apps zu {app} beisteuern)
    for (const [name, values] of Object.entries(mod.slots || {})) slots[name] = { ...(slots[name] || {}), ...values };
    for (const [i, c] of (mod.commands || []).entries()) {
      commands.push({ id: `${mod.id}#${i}`, mod: mod.id, lang: "de", phrases: c.phrases, say: c.say ?? null, action: c.action || null });
      info.commands++;
      info.examples.push(c.phrases[0]);
      // englische Fassung: "en": { "phrases": [...], "say": "…" } – gleiche Aktion (ältere Versionen ignorieren das Feld)
      if (c.en && Array.isArray(c.en.phrases) && c.en.phrases.length) {
        commands.push({ id: `${mod.id}#${i}en`, mod: mod.id, lang: "en", phrases: c.en.phrases.filter((x) => typeof x === "string" && x.trim()), say: c.en.say ?? c.say ?? null, action: c.action || null });
        info.commands++;
      }
    }
    if (mod.main) {
      try {
        const file = path.resolve(base, mod.main);
        delete require.cache[require.resolve(file)]; // neu laden erlaubt Änderungen ohne Neustart
        const fn = require(file);
        const api = makeApi(mod, base, host, commands, slots, info);
        (typeof fn === "function" ? fn : fn.default)(api);
      } catch (e) {
        info.error = "main.js: " + e.message;
        errors.push({ dir, error: info.error });
      }
    }
  }
  return { mods, commands, slots, errors };
}

/** Schnittstelle für Skript-Mods (main.js) */
function makeApi(mod, base, host, commands, slots, info) {
  const dataFile = path.join(host.dataDir || base, "mod-data", mod.id + ".json");
  let n = 0;
  return {
    id: mod.id,
    version: mod.version,
    dir: base,
    /** Befehl mit eigener Logik: handler(ctx) → Text zum Sprechen (oder { say }) – darf async sein */
    command(phrases, handler, options = {}) {
      const list = (Array.isArray(phrases) ? phrases : [phrases]).filter((p) => typeof p === "string" && p.trim());
      if (!list.length || typeof handler !== "function") throw new Error("command(phrases, handler) erwartet Sätze und eine Funktion");
      // options.lang: "de" (Standard) oder "en" – Antworten kommen dann in dieser Sprache
      const lang = options.lang === "en" ? "en" : "de";
      commands.push({ id: `${mod.id}#js${n++}`, mod: mod.id, lang, phrases: list, handler });
      info.commands++;
      info.examples.push(list[0]);
    },
    /** Werte für einen Platzhalter ergänzen, z. B. api.slot("app", { spotify: "spotify.exe" }) */
    slot(name, values) {
      slots[name] = { ...(slots[name] || {}), ...values };
    },
    say: (text) => host.say?.(String(text)),
    run: (target, args) => host.actions.run({ target, args }),
    open: (target) => host.actions.open({ target }),
    media: (key, times) => host.actions.media({ key, times }),
    /** Musik gezielt steuern: api.mediaSession("next", "amazon") → { ok, app, title, artist, status } (ab 1.1) */
    mediaSession: (command, app) => host.actions.mediaSession({ command, app }),
    /** Browser-Tabs: api.browser("closeMatching", "youtube") → { ok, count, closed } (ab 1.1) */
    browser: (op, match, all) => host.actions.browser({ op, match, all }),
    notify: (title, body) => host.notify?.(title, body),
    log: (...a) => host.log?.(`[${mod.id}]`, ...a),
    /** kleiner Speicher je Mod (JSON) */
    storage: {
      get() {
        try {
          return JSON.parse(fs.readFileSync(dataFile, "utf8"));
        } catch {
          return {};
        }
      },
      set(obj) {
        fs.mkdirSync(path.dirname(dataFile), { recursive: true });
        fs.writeFileSync(dataFile, JSON.stringify(obj, null, 2));
      },
    },
  };
}

/** Mitgelieferte Mods beim ersten Start (und neue Versionen davon) in den Benutzer-Ordner kopieren */
function seedDefaults(defaultDir, modsDir) {
  const copied = [];
  let names = [];
  try {
    names = fs.readdirSync(defaultDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return copied;
  }
  fs.mkdirSync(modsDir, { recursive: true });
  for (const name of names) {
    const src = path.join(defaultDir, name);
    const dst = path.join(modsDir, name);
    const srcVer = readVersion(src);
    const dstVer = readVersion(dst);
    if (dstVer && compareVersions(dstVer, srcVer) >= 0) continue;
    fs.rmSync(dst, { recursive: true, force: true });
    fs.cpSync(src, dst, { recursive: true });
    copied.push(name);
  }
  return copied;
}

function readVersion(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "mod.json"), "utf8")).version || null;
  } catch {
    return null;
  }
}

/** 1.10.0 > 1.9.0; 1.0.0 > 1.0.0-beta */
function compareVersions(a, b) {
  const [ma, pa = ""] = String(a || "0").split("-");
  const [mb, pb = ""] = String(b || "0").split("-");
  const x = ma.split(".").map(Number);
  const y = mb.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  if (pa === pb) return 0;
  if (!pa) return 1;
  if (!pb) return -1;
  return pa < pb ? -1 : 1;
}

module.exports = { loadAll, validate, seedDefaults, compareVersions, readVersion, ACTIONS };
