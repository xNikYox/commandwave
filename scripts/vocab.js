// Kennt das Sprachmodell diese Wörter? (nur bekannte Wörter kann die Befehls-Erkennung hören)
//   node scripts/vocab.js de discord "disk kord" notiz
// Unbekannte Wörter so schreiben, wie sie klingen: „discord“ → „disk kord“.
const path = require("node:path");
const os = require("node:os");
const { readVocabulary } = require("../src/core/vocab");

const [lang = "de", ...words] = process.argv.slice(2);
const model = path.join(__dirname, "..", "models", `vosk-model-${lang}.tar.gz`);
const vocab = readVocabulary(model, path.join(os.tmpdir(), `cw-wortschatz-${lang}.txt`));
console.log(`${vocab.size} Wörter im Modell (${lang})`);
for (const w of words.flatMap((x) => x.toLowerCase().split(/\s+/))) console.log(`  ${vocab.has(w) ? "✓" : "✗"} ${w}`);
