// CommandWave – Mod-Updater.
//
// Quellen (in den Einstellungen):
//   { "type": "folder", "path": "\\\\NAS\\CommandWave-Mods" }               lokaler Ordner oder Netzwerkfreigabe
//   { "type": "github", "repo": "name/mods", "branch": "main", "dir": "" }  öffentliches GitHub-Repository
//   { "type": "url", "url": "https://example.de/cw-mods/" }                 beliebige Adresse mit index.json
//
// Jede Quelle hat eine index.json (erzeugt mit „npm run index“ bzw. scripts/build-index.js):
//   { "mods": [ { "id": "uhrzeit", "version": "1.1.0", "name": "…", "description": "…", "path": "uhrzeit",
//                 "files": [ { "path": "mod.json", "sha256": "…" }, { "path": "main.js", "sha256": "…" } ] } ] }
// Ein Ordner ohne index.json wird direkt durchsucht.
//
// Ablauf: Versionen vergleichen → Dateien in einen Zwischenordner laden → jede Datei per SHA-256 prüfen →
// alte Version nach mods/.backup verschieben → neue an ihre Stelle → Mods neu laden. Geht etwas schief, bleibt die alte.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { compareVersions, validate } = require("./mods");

const MAX_FILE = 5 * 1024 * 1024;
const MAX_FILES = 200;
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const safeRel = (p) => typeof p === "string" && p && !path.isAbsolute(p) && !p.split(/[\\/]/).includes("..") && !/^[a-z]:/i.test(p);

function sourceId(s) {
  if (s.type === "folder") return "folder:" + s.path;
  if (s.type === "github") return `github:${s.repo}@${s.branch || "main"}/${s.dir || ""}`;
  return "url:" + s.url;
}

function sourceLabel(s) {
  if (s.type === "folder") return s.path;
  if (s.type === "github") return `GitHub ${s.repo}${s.dir ? "/" + s.dir : ""}`;
  return s.url;
}

/** Zugriff auf eine Quelle: readIndex() und readFile(modPath, filePath) */
function openSource(s, fetchImpl = globalThis.fetch) {
  if (s.type === "folder") {
    const root = s.path;
    return {
      async readIndex() {
        const idx = path.join(root, "index.json");
        if (fs.existsSync(idx)) return JSON.parse(fs.readFileSync(idx, "utf8"));
        return buildIndex(root); // ohne index.json: Ordner durchsuchen
      },
      async readFile(modPath, file) {
        const p = path.join(root, modPath, file);
        if (fs.statSync(p).size > MAX_FILE) throw new Error("Datei zu groß: " + file);
        return fs.readFileSync(p);
      },
    };
  }
  let base;
  if (s.type === "github") {
    if (!/^[\w.-]+\/[\w.-]+$/.test(s.repo || "")) throw new Error("GitHub-Quelle: repo muss „name/repository“ sein");
    base = `https://raw.githubusercontent.com/${s.repo}/${encodeURIComponent(s.branch || "main")}/${(s.dir || "").replace(/^\/|\/$/g, "")}${s.dir ? "/" : ""}`;
  } else if (s.type === "url") {
    if (!/^https?:\/\//i.test(s.url || "")) throw new Error("URL-Quelle braucht http(s)://");
    base = s.url.endsWith("/") ? s.url : s.url + "/";
  } else throw new Error("Unbekannte Quelle: " + s.type);
  const get = async (rel) => {
    const res = await fetchImpl(base + rel.split("/").map(encodeURIComponent).join("/"), { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} für ${rel}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_FILE) throw new Error("Datei zu groß: " + rel);
    return buf;
  };
  return {
    async readIndex() {
      return JSON.parse((await get("index.json")).toString("utf8"));
    },
    async readFile(modPath, file) {
      return get(`${modPath}/${file}`);
    },
  };
}

/** index.json für einen Mod-Ordner erzeugen (auch für das eigene Mod-Repo) */
function buildIndex(root) {
  const mods = [];
  for (const d of fs.readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith(".")) continue;
    const dir = path.join(root, d.name);
    let json;
    try {
      json = JSON.parse(fs.readFileSync(path.join(dir, "mod.json"), "utf8"));
    } catch {
      continue;
    }
    if (validate(json, d.name).error) continue;
    const files = [];
    const walk = (rel) => {
      for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
        const r = rel ? rel + "/" + e.name : e.name;
        if (e.name.startsWith(".")) continue;
        if (e.isDirectory()) walk(r);
        else files.push({ path: r, sha256: sha256(fs.readFileSync(path.join(dir, r))) });
      }
    };
    walk("");
    mods.push({ id: json.id, version: json.version, name: json.name || json.id, description: json.description || "", path: d.name, script: !!json.main, files: files.sort((a, b) => a.path.localeCompare(b.path)) });
  }
  return { generated: new Date().toISOString(), mods: mods.sort((a, b) => a.id.localeCompare(b.id)) };
}

/**
 * Was gibt es Neues? installed = [{ id, version }] → [{ id, from, to, source, entry, isNew }]
 * Gleiche Mod in mehreren Quellen: die höchste Version gewinnt.
 */
async function check(sources, installed, fetchImpl) {
  const found = new Map();
  const errors = [];
  for (const s of sources) {
    try {
      const idx = await openSource(s, fetchImpl).readIndex();
      for (const e of idx.mods || []) {
        if (!e || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(e.id || "") || !e.version || !Array.isArray(e.files) || !safeRel(e.path || e.id)) continue;
        const old = found.get(e.id);
        if (!old || compareVersions(e.version, old.entry.version) > 0) found.set(e.id, { entry: e, source: s });
      }
    } catch (err) {
      errors.push({ source: sourceLabel(s), error: err.message });
    }
  }
  const list = [];
  for (const [id, { entry, source }] of found) {
    const have = installed.find((m) => m.id === id);
    if (have && compareVersions(entry.version, have.version) <= 0) continue;
    list.push({ id, name: entry.name || id, description: entry.description || "", from: have?.version || null, to: entry.version, isNew: !have, script: !!entry.script, source, sourceLabel: sourceLabel(source), entry });
  }
  return { updates: list.sort((a, b) => a.id.localeCompare(b.id)), errors };
}

/** Eine Mod installieren/aktualisieren (atomar, mit Sicherung) → { id, version, backup } */
async function install(update, modsDir, fetchImpl) {
  const { entry, source } = update;
  if (entry.files.length > MAX_FILES) throw new Error("Zu viele Dateien");
  if (!entry.files.some((f) => f.path === "mod.json")) throw new Error("mod.json fehlt in der Quelle");
  const src = openSource(source, fetchImpl);
  const modPath = entry.path || entry.id;
  const tmp = path.join(modsDir, `.tmp-${entry.id}-${Date.now()}`);
  fs.mkdirSync(tmp, { recursive: true });
  try {
    for (const f of entry.files) {
      if (!safeRel(f.path) || !/^[0-9a-f]{64}$/.test(f.sha256 || "")) throw new Error("Ungültiger Dateieintrag: " + f.path);
      const buf = await src.readFile(modPath, f.path);
      if (sha256(buf) !== f.sha256) throw new Error(`Prüfsumme stimmt nicht: ${f.path} – Datei wurde verändert oder ist unvollständig`);
      const out = path.join(tmp, f.path);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, buf);
    }
    const json = JSON.parse(fs.readFileSync(path.join(tmp, "mod.json"), "utf8"));
    const v = validate(json, entry.id);
    if (v.error) throw new Error("mod.json: " + v.error);
    if (json.version !== entry.version) throw new Error(`Version in mod.json (${json.version}) passt nicht zur index.json (${entry.version})`);
    // tauschen: alte Version sichern, neue an ihren Platz
    const target = path.join(modsDir, entry.id);
    let backup = null;
    if (fs.existsSync(target)) {
      const oldVer = JSON.parse(fs.readFileSync(path.join(target, "mod.json"), "utf8")).version || "alt";
      backup = path.join(modsDir, ".backup", `${entry.id}-${oldVer}-${Date.now()}`);
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.renameSync(target, backup);
    }
    try {
      fs.renameSync(tmp, target);
    } catch (e) {
      if (backup) fs.renameSync(backup, target); // zurück
      throw e;
    }
    pruneBackups(path.join(modsDir, ".backup"), entry.id, 3);
    return { id: entry.id, version: entry.version, backup };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Nur die letzten n Sicherungen je Mod behalten */
function pruneBackups(dir, id, keep) {
  let list = [];
  try {
    // nach Zeitstempel (letzter Teil des Namens) sortieren, älteste zuerst
    list = fs.readdirSync(dir).filter((n) => n.startsWith(id + "-")).sort((a, b) => Number(a.split("-").pop()) - Number(b.split("-").pop()));
  } catch {
    return;
  }
  for (const n of list.slice(0, Math.max(0, list.length - keep))) fs.rmSync(path.join(dir, n), { recursive: true, force: true });
}

module.exports = { check, install, buildIndex, openSource, sourceId, sourceLabel, sha256, safeRel };
