// CommandWave – natürliche Stimme mit Piper (offline, MIT): https://github.com/rhasspy/piper
//
// Sprachausgabe hat zwei Wege („Backends“), das Fenster wählt je nach Einstellung „tts“:
//   windows          die Windows-Stimmen (speechSynthesis im Fenster) – wie bisher
//   piper-kerstin    Piper, deutsche Frauenstimme    } piper.exe macht aus Text eine WAV-Datei,
//   piper-thorsten   Piper, deutsche Männerstimme    } das Fenster spielt sie ab
// Piper und die Stimme werden einmal geladen, wenn man sie auswählt (mit Bestätigung), danach läuft alles offline.
// Jede Datei wird per Größe und SHA-256 geprüft. Gespeichert unter …\CommandWave\piper\.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const PIPER = {
  version: "2023.11.14-2",
  url: "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip",
  size: 22477236,
  sha256: "f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea",
};
// feste Version der Stimmen (Hugging Face, rhasspy/piper-voices) – damit die Prüfsummen stimmen. Thorsten aus v1.0.0:
// neuere Fassungen sind mit Piper 1.5 erzeugt (Laute aus mehreren Zeichen wie „aɪ“), daran stürzt piper.exe 2023.11 ab
const HF = "https://huggingface.co/rhasspy/piper-voices/resolve/42301ec547bc2939386cf0ae9f9050ca05b1d3af/de/de_DE/";
const HF_V1 = "https://huggingface.co/rhasspy/piper-voices/resolve/375a0fe641dea077c2a47b4e9a056d6da521eed3/de/de_DE/";
const VOICES = {
  "piper-kerstin": { label: "Piper – Frau (Kerstin)", name: "de_DE-kerstin-low", dir: "kerstin/low/",
    onnx: { size: 63104526, sha256: "d352a7641892cebf2903859af94e9ba81a141110215fe3943bcda7f7da401b7a" },
    json: { size: 4158, sha256: "56e708556b7b9b7a53c4f8957e021421e69f11a600962bba554cffbe72cf2d47" } },
  "piper-thorsten": { label: "Piper – Mann (Thorsten)", name: "de_DE-thorsten-medium", dir: "thorsten/medium/", base: HF_V1,
    onnx: { size: 63201294, sha256: "7e64762d8e5118bb578f2eea6207e1a35a8e0c30595010b666f983fc87bb7819" },
    json: { size: 4819, sha256: "974adee790533adb273a1ac88f49027d2a1b8f0f2cf4905954a4791e79264e85" } },
};
const isPiper = (id) => Object.prototype.hasOwnProperty.call(VOICES, id);

/** Wo was liegt (dir = …\CommandWave\piper) */
function paths(dir, id, platform = process.platform) {
  const v = VOICES[id];
  return {
    zip: path.join(dir, "piper_windows_amd64.zip"),
    bin: path.join(dir, "bin"),
    exe: path.join(dir, "bin", "piper", platform === "win32" ? "piper.exe" : "piper"),
    model: v ? path.join(dir, "voices", v.name + ".onnx") : null,
    config: v ? path.join(dir, "voices", v.name + ".onnx.json") : null,
  };
}

/** Datei vorhanden und richtig groß? (die Prüfsumme wurde beim Laden geprüft) */
const ok = (file, size) => {
  try {
    return fs.statSync(file).size === size;
  } catch {
    return false;
  }
};

/** Was fehlt noch? → [{ url, file, size, sha256, label }] (leer = fertig) */
function missing(dir, id, platform = process.platform) {
  const v = VOICES[id];
  if (!v) throw new Error("Unbekannte Stimme: " + id);
  const p = paths(dir, id, platform);
  const out = [];
  if (!fs.existsSync(p.exe)) out.push({ url: PIPER.url, file: p.zip, size: PIPER.size, sha256: PIPER.sha256, label: "Piper", unzip: true });
  if (!ok(p.model, v.onnx.size)) out.push({ url: (v.base || HF) + v.dir + v.name + ".onnx", file: p.model, ...v.onnx, label: v.label });
  if (!ok(p.config, v.json.size)) out.push({ url: (v.base || HF) + v.dir + v.name + ".onnx.json", file: p.config, ...v.json, label: v.label });
  return out;
}

const isInstalled = (dir, id, platform) => isPiper(id) && !missing(dir, id, platform).length;

/** Eine Datei laden und prüfen (Größe + SHA-256), erst danach an ihren Platz → onBytes(geladen) */
async function download(item, { fetchImpl = globalThis.fetch, onBytes = () => {} } = {}) {
  fs.mkdirSync(path.dirname(item.file), { recursive: true });
  const res = await fetchImpl(item.url);
  if (!res.ok || !res.body) throw new Error(`Download fehlgeschlagen (${item.label}): HTTP ${res.status}`);
  const tmp = item.file + ".part";
  const out = fs.createWriteStream(tmp);
  const hash = crypto.createHash("sha256");
  let got = 0;
  try {
    for await (const chunk of res.body) {
      hash.update(chunk);
      got += chunk.length;
      if (got > item.size) throw new Error(`${item.label}: Datei größer als erwartet`);
      if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
      onBytes(got);
    }
  } catch (e) {
    out.destroy();
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  await new Promise((r) => out.end(r));
  if (got !== item.size || hash.digest("hex") !== item.sha256) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`${item.label}: Prüfsumme stimmt nicht – Download verworfen`);
  }
  fs.renameSync(tmp, item.file);
}

/** ZIP entpacken – Windows 10/11 hat tar.exe (kann auch .zip) */
function unzip(zip, dest, sp = spawn) {
  fs.mkdirSync(dest, { recursive: true });
  return new Promise((resolve, reject) => {
    const c = sp("tar", ["-xf", zip, "-C", dest], { windowsHide: true, stdio: "ignore" });
    c.on("error", reject);
    c.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("Entpacken fehlgeschlagen (Code " + code + ")"))));
  });
}

/**
 * Piper und Stimme einrichten (was schon da ist, wird nicht nochmal geladen).
 * onProgress({ percent, label, done, total }) – total = Bytes, die geladen werden müssen
 */
async function install(dir, id, { fetchImpl, onProgress = () => {}, extract = unzip, platform = process.platform } = {}) {
  const list = missing(dir, id, platform);
  const total = list.reduce((a, x) => a + x.size, 0);
  let before = 0;
  for (const item of list) {
    await download(item, { fetchImpl, onBytes: (n) => onProgress({ percent: total ? Math.floor(((before + n) / total) * 100) : 100, label: item.label, done: before + n, total }) });
    before += item.size;
    if (item.unzip) {
      await extract(item.file, paths(dir, id, platform).bin);
      fs.rmSync(item.file, { force: true });
      if (!fs.existsSync(paths(dir, id, platform).exe)) throw new Error("piper.exe fehlt im Archiv");
    }
  }
  onProgress({ percent: 100, label: "fertig", done: total, total });
  return { ok: true, loaded: total };
}

/**
 * Piper als Hintergrundprozess: das Modell bleibt geladen, jeder Satz kommt als JSON-Zeile hinein
 * ({"text", "output_file"}), Piper meldet die fertige Datei auf stdout. Ein Satz nach dem anderen.
 * env = { spawn } für Tests.
 */
class PiperEngine {
  constructor({ exe, model, rate = 1, sp = spawn } = {}) {
    this.exe = exe;
    this.model = model;
    this.rate = rate;
    this.sp = sp;
    this.proc = null;
    this.queue = Promise.resolve();
    this.waiting = null;
  }

  start_() {
    if (this.proc) return this.proc;
    // Tempo: Piper rechnet in Lautlänge (2 = halb so schnell)
    const scale = Math.max(0.5, Math.min(2, 1 / (Number(this.rate) || 1))).toFixed(2);
    // Pfade relativ zum Stimmen-Ordner: piper.exe kommt mit Umlauten im Benutzernamen (C:\Users\Jürgen\…) nicht klar
    this.cwd = path.dirname(this.model);
    const espeak = path.relative(this.cwd, path.join(path.dirname(this.exe), "espeak-ng-data"));
    const p = this.sp(this.exe, ["--model", path.basename(this.model), "--espeak_data", espeak, "--json-input", "--quiet", "--length_scale", scale], { windowsHide: true, cwd: this.cwd });
    this.proc = p;
    let buf = "";
    let err = "";
    p.stdout?.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line && this.waiting) this.waiting.resolve(line);
      }
    });
    p.stderr?.on("data", (d) => (err = (err + d).slice(-500)));
    const gone = (why) => {
      if (this.proc === p) this.proc = null;
      this.waiting?.reject(new Error(`Piper beendet (${why})${err ? ": " + err.trim().split(/\r?\n/).pop() : ""}`));
    };
    p.on("error", (e) => gone(e.code || e.message));
    p.on("exit", (code) => gone("Code " + code));
    return p;
  }

  /** Text → WAV-Datei (outFile) → Promise<outFile> */
  synth(text, outFile, timeoutMs = 30000) {
    const run = () => new Promise((resolve, reject) => {
      const p = this.start_();
      const t = setTimeout(() => {
        this.waiting = null;
        this.stop();
        reject(new Error("Piper antwortet nicht"));
      }, timeoutMs);
      this.waiting = {
        resolve: () => (clearTimeout(t), (this.waiting = null), fs.existsSync(outFile) ? resolve(outFile) : reject(new Error("Piper hat keine Datei geschrieben"))),
        reject: (e) => (clearTimeout(t), (this.waiting = null), reject(e)),
      };
      p.stdin.write(JSON.stringify({ text: String(text).replace(/\s+/g, " ").trim(), output_file: path.relative(this.cwd, outFile) }) + "\n");
    });
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {});
    return next;
  }

  stop() {
    const p = this.proc;
    this.proc = null;
    try {
      p?.stdin?.end();
      p?.kill();
    } catch {
      // schon beendet
    }
  }
}

module.exports = { PIPER, VOICES, isPiper, paths, missing, isInstalled, download, unzip, install, PiperEngine };
