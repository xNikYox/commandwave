// Jedes Wort der Grammatik muss im Vosk-Modell stehen – sonst hört die Befehls-Erkennung es nie.
// (Läuft, wenn die Modelle da sind: lokal nach „npm run model“, im CI immer.)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readVocabulary, unknownWords } = require("../src/core/vocab");
const { Assistant } = require("../src/core/assistant");

const model = (l) => path.join(__dirname, "..", "models", `vosk-model-${l}.tar.gz`);
// schon vor 2.0 so in den Mods (englische Erkennung hört sie trotzdem meist über ähnliche Wörter)
const KNOWN = { de: [], en: ["powershell", "vlc", "whatsapp"] };

for (const lang of ["de", "en"]) {
  test(`Grammatik (${lang}): alle Wörter kennt das Sprachmodell`, { skip: !fs.existsSync(model(lang)) && "Modell fehlt (npm run model)" }, () => {
    const vocab = readVocabulary(model(lang), path.join(os.tmpdir(), `cw-wortschatz-${lang}.txt`));
    assert.ok(vocab.size > 100000, String(vocab.size));
    assert.ok(vocab.has(lang === "de" ? "öffne" : "open"));
    const a = new Assistant({ modsDir: path.join(__dirname, "..", "mods"), actions: {}, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "cw-vocab-")) });
    a.reload();
    const missing = unknownWords(a.grammars[lang], vocab).filter((w) => !KNOWN[lang].includes(w));
    assert.deepEqual(missing, [], `unbekannte Wörter – so schreiben, wie sie klingen (z. B. „disk kord“): ${missing.join(", ")}`);
  });
}

test("Wortschatz: Lautschrift-Beispiele", { skip: !fs.existsSync(model("de")) && "Modell fehlt" }, () => {
  const vocab = readVocabulary(model("de"), path.join(os.tmpdir(), "cw-wortschatz-de.txt"));
  assert.deepEqual(unknownWords(["öffne discord", "öffne disk kord"], vocab), ["discord"]);
});
