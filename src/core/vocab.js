// CommandWave – Wortschatz des Vosk-Sprachmodells: Welche Wörter kennt die Befehls-Erkennung?
// Ein Wort, das nicht im Modell steht, wird in der Grammatik ignoriert und nie erkannt – dann schreibt man es so, wie
// es klingt („disk kord“ statt „discord“). Die Wortliste steckt im Modell (graph/Gr.fst, Symboltabelle von OpenFST).
//   node scripts/vocab.js de discord notiz     → zeigt, welche Wörter das deutsche Modell kennt
const fs = require("node:fs");
const zlib = require("node:zlib");

const SYMTAB_MAGIC = 2125658996; // OpenFST-Symboltabelle

/** Symboltabelle(n) aus einer .fst-Datei lesen → Wörter (ohne <eps>, !SIL, [unk]) */
function wordsFromFst(buf) {
  const words = [];
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (buf.readInt32LE(i) !== SYMTAB_MAGIC) continue;
    let p = i + 4;
    const nameLen = buf.readInt32LE(p);
    if (nameLen < 0 || nameLen > 4096) continue;
    p += 4;
    const name = buf.toString("utf8", p, p + nameLen);
    p += nameLen + 8; // Name, nächster freier Schlüssel
    if (!/words/.test(name)) continue;
    const size = Number(buf.readBigInt64LE(p));
    p += 8;
    for (let k = 0; k < size && p < buf.length; k++) {
      const l = buf.readInt32LE(p);
      p += 4;
      words.push(buf.toString("utf8", p, p + l));
      p += l + 8; // Wort, Schlüssel
    }
    break;
  }
  return words.filter((w) => w && !/^(<eps>|!sil|\[unk\]|#\d+|<s>|<\/s>)$/i.test(w));
}

/** Eine Datei aus einem (unkomprimierten) tar-Archiv holen: Name endet auf suffix → Buffer oder null */
function fromTar(tar, suffix) {
  let p = 0;
  while (p + 512 <= tar.length) {
    const name = tar.toString("utf8", p, p + 100).replace(/\0.*$/s, "");
    if (!name) break;
    const prefix = tar.toString("utf8", p + 345, p + 500).replace(/\0.*$/s, "");
    const size = parseInt(tar.toString("ascii", p + 124, p + 136).replace(/\0/g, "").trim() || "0", 8);
    const full = prefix ? prefix + "/" + name : name;
    if (full.endsWith(suffix)) return tar.subarray(p + 512, p + 512 + size);
    p += 512 + Math.ceil(size / 512) * 512;
  }
  return null;
}

/**
 * Wortschatz aus dem Modell (vosk-model-xx.tar.gz) → Set der Wörter. cacheFile: Wortliste dort ablegen/wiederverwenden
 * (das Entpacken dauert ~1 s).
 */
function readVocabulary(modelTarGz, cacheFile = null) {
  if (cacheFile) {
    try {
      if (fs.statSync(cacheFile).mtimeMs >= fs.statSync(modelTarGz).mtimeMs) return new Set(fs.readFileSync(cacheFile, "utf8").split("\n").filter(Boolean));
    } catch {
      // noch keine Liste
    }
  }
  const tar = zlib.gunzipSync(fs.readFileSync(modelTarGz));
  const words = fromTar(tar, "graph/words.txt");
  const list = words ? words.toString("utf8").split(/\r?\n/).map((l) => l.split(/\s+/)[0]).filter((w) => w && !/^(<eps>|!sil|\[unk\]|#\d+)$/i.test(w)) : wordsFromFst(fromTar(tar, "graph/Gr.fst") || Buffer.alloc(0));
  if (!list.length) throw new Error("Wortschatz im Modell nicht gefunden");
  if (cacheFile) {
    try {
      fs.writeFileSync(cacheFile, list.join("\n"));
    } catch {
      // nicht schreibbar – dann nächstes Mal neu
    }
  }
  return new Set(list);
}

/** Wörter aus Sätzen, die das Modell nicht kennt → [wort, …] (sortiert, ohne Doppelte) */
function unknownWords(sentences, vocab) {
  const out = new Set();
  for (const s of [].concat(sentences || [])) {
    for (const w of String(s).toLowerCase().split(/\s+/)) if (w && w !== "[unk]" && !vocab.has(w)) out.add(w);
  }
  return [...out].sort();
}

module.exports = { readVocabulary, unknownWords, wordsFromFst, fromTar };
