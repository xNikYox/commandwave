// index.json für eine Mod-Quelle erzeugen (eigenes GitHub-Repo oder Netzwerkordner mit Mods).
//   node scripts/build-index.js <ordner-mit-mods>      (Standard: ./mods)
// Mods mit "minApp" landen in „modsMinApp“ (CommandWave vor 2.0 sieht sie nicht).
// Danach die index.json mit hochladen bzw. im Ordner liegen lassen – CommandWave findet darüber neue Versionen.
const fs = require("node:fs");
const path = require("node:path");
const { buildIndex } = require("../src/core/updater");

const dir = path.resolve(process.argv[2] || path.join(__dirname, "..", "mods"));
const idx = buildIndex(dir);
fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(idx, null, 2) + "\n");
console.log(`index.json geschrieben: ${idx.mods.length + idx.modsMinApp.length} Mods`);
for (const m of [...idx.mods, ...idx.modsMinApp]) console.log(`  ${m.id} ${m.version} (${m.files.length} Dateien)${m.minApp ? " – braucht CommandWave " + m.minApp : ""}`);
