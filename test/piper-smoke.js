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
  diagnose(p, dir);
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

// Diagnose: verschiedene Aufrufarten einzeln probieren und Ergebnis zeigen (Absturz-Code, stderr), damit ein Fehler
// im Praxistest sofort zeigt, woran es liegt.
function diagnose(p, dir) {
  const { spawnSync } = require("node:child_process");
  const exeDir = path.dirname(p.exe);
  console.log("Dateien neben piper.exe:", fs.readdirSync(exeDir).join(", "));
  const text = "Hallo, das ist ein Test.";
  const tries = [
    ["ohne espeak-Angabe, cwd=piper", exeDir, ["--model", p.model, "--output_file", path.join(dir, "d1.wav")]],
    ["espeak absolut, cwd=piper", exeDir, ["--model", p.model, "--espeak_data", path.join(exeDir, "espeak-ng-data"), "--output_file", path.join(dir, "d2.wav")]],
    ["json-input, cwd=piper", exeDir, ["--model", p.model, "--json-input", "--quiet"], JSON.stringify({ text, output_file: path.join(dir, "d3.wav") })],
    ["wie die App (cwd=Stimme, relativ)", path.dirname(p.model), ["--model", path.basename(p.model), "--espeak_data", path.relative(path.dirname(p.model), path.join(exeDir, "espeak-ng-data")), "--json-input", "--quiet"], JSON.stringify({ text, output_file: path.relative(path.dirname(p.model), path.join(dir, "d4.wav")) })],
  ];
  for (const [name, cwd, args, input] of tries) {
    const r = spawnSync(p.exe, args, { cwd, input: (input ?? text) + "\n", encoding: "utf8", timeout: 60000, windowsHide: true });
    const out = fs.readdirSync(dir).filter((f) => /^d\d\.wav$/.test(f)).map((f) => `${f}=${fs.statSync(path.join(dir, f)).size}`).join(" ");
    console.log(`  [${name}] Code ${r.status} (0x${((r.status ?? 0) >>> 0).toString(16)}) ${r.error ? r.error.message : ""} | ${out} | stderr: ${(r.stderr || "").trim().split(/\r?\n/).slice(-3).join(" / ")}`);
  }
}
