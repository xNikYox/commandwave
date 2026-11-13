// Sprachmodelle herunterladen (nur zum Bauen – in der fertigen App sind sie enthalten):
//   Vosk (Apache 2.0) → models/vosk-model-<sprache>.tar.gz   schnelle Befehls-Erkennung
//   Whisper base (MIT, ONNX, 8 Bit) → models/whisper-base/    genaue Erkennung für Namen und unbekannte Wörter
//   transformers.js (Apache 2.0) → vendor/transformers/       führt Whisper im Fenster aus (WebAssembly)
//   npm run model
// Wird nur zum Bauen gebraucht – in der fertigen App sind die Modelle schon enthalten.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const MODELS = [
  { lang: "de", name: "vosk-model-small-de-0.15" }, // ~45 MB
  { lang: "en", name: "vosk-model-small-en-us-0.15" }, // ~40 MB
];

async function get({ lang, name }) {
  const out = path.join(__dirname, "..", "models", `vosk-model-${lang}.tar.gz`);
  if (fs.existsSync(out)) return console.log("schon vorhanden:", out);
  const url = `https://alphacephei.com/vosk/models/${name}.zip`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-model-"));
  const zip = path.join(tmp, name + ".zip");
  console.log("Lade", url, "…");
  const res = await fetch(url);
  if (!res.ok) throw new Error("Download fehlgeschlagen: HTTP " + res.status);
  fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  // Entpacken: Windows 10/11 hat tar.exe (kann auch .zip), sonst Python
  try {
    execFileSync("tar", ["-xf", zip, "-C", tmp], { stdio: "ignore" });
    if (!fs.existsSync(path.join(tmp, name))) throw new Error("tar kann kein zip");
  } catch {
    execFileSync("python3", ["-c", `import zipfile;zipfile.ZipFile(${JSON.stringify(zip)}).extractall(${JSON.stringify(tmp)})`]);
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  execFileSync("tar", ["-czf", out, "-C", tmp, name]);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("Fertig:", out, Math.round(fs.statSync(out).size / 1e6) + " MB");
}

const WHISPER = { repo: "onnx-community/whisper-base", rev: "main", dir: "whisper-base",
  files: ["config.json", "generation_config.json", "preprocessor_config.json", "tokenizer.json", "tokenizer_config.json", "onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx"] };
const TRANSFORMERS = { version: "3.8.1", files: ["transformers.min.js", "ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"] };

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download fehlgeschlagen (${url}): HTTP ${res.status}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

async function getWhisper() {
  const dir = path.join(__dirname, "..", "models", WHISPER.dir);
  for (const f of WHISPER.files) {
    const out = path.join(dir, f);
    if (fs.existsSync(out) && fs.statSync(out).size > 0) continue;
    console.log("Lade Whisper:", f, "…");
    await download(`https://huggingface.co/${WHISPER.repo}/resolve/${WHISPER.rev}/${f}`, out);
  }
  console.log("Whisper bereit:", dir);
}

async function getTransformers() {
  const dir = path.join(__dirname, "..", "vendor", "transformers");
  if (TRANSFORMERS.files.every((f) => fs.existsSync(path.join(dir, f)))) return console.log("schon vorhanden:", dir);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-tjs-"));
  const tgz = path.join(tmp, "t.tgz");
  console.log("Lade transformers.js", TRANSFORMERS.version, "…");
  await download(`https://registry.npmjs.org/@huggingface/transformers/-/transformers-${TRANSFORMERS.version}.tgz`, tgz);
  execFileSync("tar", ["-xzf", tgz, "-C", tmp]);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of TRANSFORMERS.files) fs.copyFileSync(path.join(tmp, "package", "dist", f), path.join(dir, f));
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("transformers.js bereit:", dir);
}

(async () => {
  for (const m of MODELS) await get(m);
  await getWhisper();
  await getTransformers();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
