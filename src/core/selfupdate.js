// CommandWave – Ersatzweg für App-Updates über Node (statt über den Netzwerkdienst von Chromium).
// Manche Sicherheitsprogramme/Firewalls lassen den abgeschotteten Chromium-Netzwerkdienst nicht ins Internet
// (net::ERR_NETWORK_ACCESS_DENIED) – dann prüft und lädt CommandWave selbst: latest.yml vom GitHub-Release lesen,
// Installer laden, SHA-512 aus latest.yml prüfen. Installiert wird wie sonst: still, im Leerlauf.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { compareVersions } = require("./mods");

const REPO = "xNikYox/commandwave";

/** Die wichtigen Felder aus latest.yml (einfaches YAML von electron-builder) */
function parseLatest(text) {
  const top = (k) => (new RegExp(`^${k}:\\s*['"]?([^'"\\r\\n]+)['"]?\\s*$`, "m").exec(text) || [])[1];
  const size = /^\s+size:\s*(\d+)/m.exec(text);
  const info = { version: top("version"), path: top("path"), sha512: top("sha512"), size: size ? Number(size[1]) : null };
  if (!info.version || !info.path || !info.sha512) throw new Error("latest.yml unvollständig");
  if (/[\\/]|\.\./.test(info.path) || !/\.exe$/i.test(info.path)) throw new Error("latest.yml: ungültiger Dateiname");
  return info;
}

/** Neue Version? → info oder null */
async function check(current, fetchImpl = globalThis.fetch, repo = REPO) {
  const res = await fetchImpl(`https://github.com/${repo}/releases/latest/download/latest.yml`, { cache: "no-store" });
  if (!res.ok) throw new Error("latest.yml: HTTP " + res.status);
  const info = parseLatest(await res.text());
  return compareVersions(info.version, current) > 0 ? info : null;
}

/** Installer laden und prüfen → Pfad der Datei (onProgress(prozent)) */
async function download(info, dir, { fetchImpl = globalThis.fetch, repo = REPO, onProgress = () => {} } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, info.path);
  const res = await fetchImpl(`https://github.com/${repo}/releases/download/v${info.version}/${encodeURIComponent(info.path)}`);
  if (!res.ok || !res.body) throw new Error("Download: HTTP " + res.status);
  const total = Number(res.headers.get("content-length")) || info.size || 0;
  const hash = crypto.createHash("sha512");
  const tmp = file + ".part";
  const out = fs.createWriteStream(tmp);
  let got = 0;
  let last = -1;
  try {
    for await (const chunk of res.body) {
      hash.update(chunk);
      got += chunk.length;
      if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
      const p = total ? Math.floor((got / total) * 100) : 0;
      if (p !== last) onProgress((last = p));
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
  if (hash.digest("base64") !== info.sha512) {
    fs.rmSync(tmp, { force: true });
    throw new Error("Prüfsumme stimmt nicht – Download verworfen");
  }
  fs.renameSync(tmp, file);
  return file;
}

module.exports = { parseLatest, check, download, REPO };
