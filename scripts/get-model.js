// Vosk-Sprachmodelle (offline, Apache 2.0) herunterladen und als models/vosk-model-<sprache>.tar.gz ablegen.
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

(async () => {
  for (const m of MODELS) await get(m);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
