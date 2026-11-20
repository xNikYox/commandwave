// 2.0: Piper-Stimme – Download mit Prüfung (Größe, SHA-256), Einrichten, Sprechen über den Hintergrundprozess
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const T = require("../src/core/tts");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cw-tts-"));
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

/** Attrappe fürs Internet: Adresse → Inhalt (in Stücken, wie ein echter Download) */
function fakeFetch(files) {
  const urls = [];
  return {
    urls,
    fetch: async (url) => {
      urls.push(url);
      const b = files[url];
      if (!b) return { ok: false, status: 404 };
      return { ok: true, status: 200, body: (async function* () {
        for (let i = 0; i < b.length; i += 1000) yield b.subarray(i, i + 1000);
      })() };
    },
  };
}

test("Stimmen: feste Adressen mit Prüfsummen, Pfade", () => {
  assert.deepEqual(Object.keys(T.VOICES), ["piper-kerstin", "piper-thorsten"]);
  for (const v of Object.values(T.VOICES)) {
    assert.match(v.onnx.sha256, /^[0-9a-f]{64}$/);
    assert.match(v.json.sha256, /^[0-9a-f]{64}$/);
    assert.ok(v.onnx.size > 10e6);
  }
  assert.match(T.PIPER.url, /^https:\/\/github\.com\/rhasspy\/piper\/releases\/download\/.+\/piper_windows_amd64\.zip$/);
  const p = T.paths("C:\\cw\\piper", "piper-thorsten", "win32");
  assert.match(p.exe, /piper[\\/]piper\.exe$/);
  assert.match(p.model, /de_DE-thorsten-medium\.onnx$/);
  assert.equal(T.isPiper("windows"), false);
  assert.throws(() => T.missing(tmp(), "piper-gibtsnicht"), /Unbekannte Stimme/);
});

test("Einrichten: lädt nur was fehlt, prüft jede Datei, entpackt Piper", async () => {
  const dir = tmp();
  const id = "piper-kerstin";
  const v = T.VOICES[id];
  // kleine Stand-ins mit passenden Prüfsummen
  const zip = Buffer.from("zip-inhalt");
  const onnx = Buffer.alloc(5000, 7);
  const json = Buffer.from('{"audio":{"sample_rate":16000}}');
  const piper = { ...T.PIPER, size: zip.length, sha256: sha(zip) };
  const voice = { ...v, onnx: { size: onnx.length, sha256: sha(onnx) }, json: { size: json.length, sha256: sha(json) } };
  const restore = { piper: { ...T.PIPER }, voice: T.VOICES[id] };
  Object.assign(T.PIPER, piper);
  T.VOICES[id] = voice;
  try {
    const base = T.missing(dir, id, "win32");
    assert.deepEqual(base.map((x) => x.label), ["Piper", "Piper – Frau (Kerstin)", "Piper – Frau (Kerstin)"]);
    const net = fakeFetch({ [base[0].url]: zip, [base[1].url]: onnx, [base[2].url]: json });
    const progress = [];
    const extracted = [];
    await T.install(dir, id, { fetchImpl: net.fetch, platform: "win32", onProgress: (p) => progress.push(p.percent),
      extract: async (z, dest) => {
        extracted.push(path.basename(z));
        fs.mkdirSync(path.join(dest, "piper"), { recursive: true });
        fs.writeFileSync(path.join(dest, "piper", "piper.exe"), "exe");
      } });
    assert.deepEqual(extracted, ["piper_windows_amd64.zip"]);
    assert.equal(progress.at(-1), 100);
    assert.ok(progress.every((p, i) => !i || p >= progress[i - 1]), "Fortschritt steigt");
    assert.ok(T.isInstalled(dir, id, "win32"));
    assert.ok(!fs.existsSync(path.join(dir, "piper_windows_amd64.zip")), "ZIP danach gelöscht");
    // zweite Stimme: Piper ist schon da – nur die Stimme fehlt
    assert.deepEqual(T.missing(dir, "piper-thorsten", "win32").map((x) => path.basename(x.file)), ["de_DE-thorsten-medium.onnx", "de_DE-thorsten-medium.onnx.json"]);
    // kaputter Download: Prüfsumme falsch → nichts landet an seinem Platz
    const bad = tmp();
    const list = T.missing(bad, id, "win32");
    const broken = fakeFetch({ [list[0].url]: Buffer.from("zip-inhalX"), [list[1].url]: onnx, [list[2].url]: json });
    await assert.rejects(T.install(bad, id, { fetchImpl: broken.fetch, platform: "win32", extract: async () => {} }), /Prüfsumme stimmt nicht/);
    assert.ok(!fs.existsSync(path.join(bad, "piper_windows_amd64.zip")) && !fs.existsSync(path.join(bad, "piper_windows_amd64.zip.part")));
    // Server liefert zu viel → abgebrochen
    const big = fakeFetch({ [list[0].url]: Buffer.alloc(zip.length + 5000) });
    await assert.rejects(T.install(bad, id, { fetchImpl: big.fetch, platform: "win32", extract: async () => {} }), /größer als erwartet/);
    await assert.rejects(T.install(bad, id, { fetchImpl: fakeFetch({}).fetch, platform: "win32" }), /HTTP 404/);
  } finally {
    Object.assign(T.PIPER, restore.piper);
    T.VOICES[id] = restore.voice;
  }
});

/** Attrappe für piper.exe: liest JSON-Zeilen, schreibt die Datei, meldet den Pfad */
function fakePiper({ crash = false } = {}) {
  const runs = [];
  const sp = (exe, args) => {
    const p = new EventEmitter();
    p.stdout = new EventEmitter();
    p.stderr = new EventEmitter();
    runs.push({ exe, args, lines: [] });
    p.stdin = {
      write(line) {
        const j = JSON.parse(line);
        runs.at(-1).lines.push(j.text);
        setImmediate(() => {
          if (crash) {
            p.stderr.emit("data", "Modell kaputt\n");
            return p.emit("exit", 1);
          }
          fs.writeFileSync(j.output_file, Buffer.alloc(20000));
          p.stdout.emit("data", j.output_file + "\n");
        });
      },
      end() {},
    };
    p.kill = () => setImmediate(() => p.emit("exit", null));
    return p;
  };
  return { sp, runs };
}

test("Sprechen: ein Prozess für alle Sätze, nacheinander, Tempo, Fehler", async () => {
  const dir = tmp();
  const f = fakePiper();
  const e = new T.PiperEngine({ exe: "piper.exe", model: "m.onnx", rate: 1.25, sp: f.sp });
  const [a, b] = await Promise.all([e.synth("Hallo, ich bin CommandWave.", path.join(dir, "1.wav")), e.synth("Editor wird gestartet", path.join(dir, "2.wav"))]);
  assert.equal(path.basename(a), "1.wav");
  assert.equal(path.basename(b), "2.wav");
  assert.equal(f.runs.length, 1, "Modell bleibt geladen");
  assert.deepEqual(f.runs[0].lines, ["Hallo, ich bin CommandWave.", "Editor wird gestartet"]);
  assert.deepEqual(f.runs[0].args, ["--model", "m.onnx", "--json-input", "--quiet", "--length_scale", "0.80"]);
  e.stop();
  const bad = new T.PiperEngine({ exe: "piper.exe", model: "m.onnx", sp: fakePiper({ crash: true }).sp });
  await assert.rejects(bad.synth("Hallo", path.join(dir, "3.wav")), /Piper beendet \(Code 1\): Modell kaputt/);
  const missingExe = new T.PiperEngine({ exe: "gibtsnicht", model: "m.onnx", sp: () => {
    const p = new EventEmitter();
    p.stdin = { write() {}, end() {} };
    setImmediate(() => p.emit("error", Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })));
    return p;
  } });
  await assert.rejects(missingExe.synth("Hallo", path.join(dir, "4.wav")), /Piper beendet \(ENOENT\)/);
});
