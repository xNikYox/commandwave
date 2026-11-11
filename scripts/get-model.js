// Deutsches Vosk-Sprachmodell (offline, ~45 MB, Apache 2.0) herunterladen und als models/vosk-model-de.tar.gz ablegen.
//   npm run model
// Wird nur zum Bauen gebraucht – in der fertigen App ist das Modell schon enthalten.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const URL = "https://alphacephei.com/vosk/models/vosk-model-small-de-0.15.zip";
const NAME = "vosk-model-small-de-0.15";
const OUT = path.join(__dirname, "..", "models", "vosk-model-de.tar.gz");

(async () => {
  if (fs.existsSync(OUT)) return console.log("Modell schon vorhanden:", OUT);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-model-"));
  const zip = path.join(tmp, NAME + ".zip");
  console.log("Lade", URL, "…");
  const res = await fetch(URL);
  if (!res.ok) throw new Error("Download fehlgeschlagen: HTTP " + res.status);
  fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  // Entpacken: Windows 10/11 hat tar.exe (kann auch .zip), sonst Python
  try {
    execFileSync("tar", ["-xf", zip, "-C", tmp], { stdio: "ignore" });
    if (!fs.existsSync(path.join(tmp, NAME))) throw new Error("tar kann kein zip");
  } catch {
    execFileSync("python3", ["-c", `import zipfile;zipfile.ZipFile(${JSON.stringify(zip)}).extractall(${JSON.stringify(tmp)})`]);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  execFileSync("tar", ["-czf", OUT, "-C", tmp, NAME]);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("Fertig:", OUT, Math.round(fs.statSync(OUT).size / 1e6) + " MB");
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
