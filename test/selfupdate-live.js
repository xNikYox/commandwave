// Ersatzweg für App-Updates gegen das echte GitHub-Release: latest.yml lesen, Installer laden, Prüfsumme prüfen.
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { check, download } = require("../src/core/selfupdate");

(async () => {
  const info = await check("0.0.1");
  if (!info) throw new Error("keine Version gefunden");
  console.log("Neueste Version laut latest.yml:", info.version, info.path);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-live-"));
  const t = Date.now();
  const file = await download(info, dir);
  console.log(`Geladen und Prüfsumme ok: ${file} (${Math.round(fs.statSync(file).size / 1e6)} MB, ${Math.round((Date.now() - t) / 1000)} s)`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
