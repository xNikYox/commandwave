// Praxistest (GitHub Actions, Windows): Piper und eine Stimme wirklich laden (mit Prüfsummen), einen Satz sprechen
// lassen – es muss eine WAV-Datei mit echtem Inhalt entstehen. Genau der Weg, den die App beim Auswählen der Stimme geht.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const tts = require("../src/core/tts");

(async () => {
  if (process.platform !== "win32") return console.log("Piper-Test nur unter Windows (piper.exe)");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-piper-"));
  const id = process.env.CW_PIPER_VOICE || "piper-thorsten";
  const t0 = Date.now();
  let last = -10;
  await tts.install(dir, id, { onProgress: (p) => p.percent >= last + 10 && console.log(`  ${p.label} ${(last = p.percent)} %`) });
  console.log(`Geladen und geprüft in ${Math.round((Date.now() - t0) / 1000)} s:`, tts.paths(dir, id).exe);
  assert.ok(tts.isInstalled(dir, id), "nicht vollständig eingerichtet");
  const p = tts.paths(dir, id);
  const engine = new tts.PiperEngine({ exe: p.exe, model: p.model });
  for (const [i, text] of ["Hallo, ich bin CommandWave. Editor wird gestartet.", "Diesen Befehl kenne ich leider nicht."].entries()) {
    const out = path.join(dir, `satz${i}.wav`);
    const t1 = Date.now();
    await engine.synth(text, out, 60000);
    const buf = fs.readFileSync(out);
    console.log(`„${text}“ → ${buf.length} Bytes in ${Date.now() - t1} ms`);
    assert.equal(buf.subarray(0, 4).toString(), "RIFF", "keine WAV-Datei");
    assert.equal(buf.subarray(8, 12).toString(), "WAVE");
    assert.ok(buf.length > 20000, "WAV zu klein: " + buf.length);
  }
  engine.stop();
  console.log("Piper-Test bestanden.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
