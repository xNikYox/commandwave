// index.json für eine Mod-Quelle erzeugen (eigenes GitHub-Repo oder Netzwerkordner mit Mods).
//   node scripts/build-index.js <ordner-mit-mods>      (Standard: ./mods)
// Danach die index.json mit hochladen bzw. im Ordner liegen lassen – CommandWave findet darüber neue Versionen.
const fs = require("node:fs");
const path = require("node:path");
const { buildIndex } = require("../src/core/updater");

const dir = path.resolve(process.argv[2] || path.join(__dirname, "..", "mods"));
const idx = buildIndex(dir);
fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(idx, null, 2) + "\n");
console.log(`index.json geschrieben: ${idx.mods.length} Mods`);
for (const m of idx.mods) console.log(`  ${m.id} ${m.version} (${m.files.length} Dateien)`);
