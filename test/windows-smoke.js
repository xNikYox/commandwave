// Praxistest auf echtem Windows (GitHub Actions): Programme starten/schließen, Medientasten, Ordner öffnen.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const { createActions } = require("../src/core/actions");
const { Assistant } = require("../src/core/assistant");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const running = (exe) => execFileSync("tasklist", ["/FI", `IMAGENAME eq ${exe}`, "/NH"]).toString().toLowerCase().includes(exe.toLowerCase());

(async () => {
  const opened = [];
  const actions = createActions({ openExternal: async (u) => opened.push(u), openPath: async (p) => (opened.push(p), "") });
  const a = new Assistant({ modsDir: path.join(__dirname, "..", "mods"), actions, dataDir: os.tmpdir() });
  a.reload();
  assert.deepEqual(a.errors, []);

  let r = await a.handle("Öffne die App Editor");
  assert.equal(r.say, "Editor wird gestartet");
  await wait(2500);
  assert.ok(running("notepad.exe"), "Editor läuft nicht");
  console.log("„Öffne die App Editor“ → Editor läuft: ok");

  r = await a.handle("schließe den editor");
  assert.equal(r.say, "Editor wird geschlossen");
  await wait(2500);
  assert.ok(!running("notepad.exe"), "Editor läuft noch");
  console.log("„Schließe den Editor“ → beendet: ok");

  // Programm, das Windows nur über „start“ findet (App-Pfade), und eines mit Pfad + Argumenten
  await actions.run({ target: "cmd.exe", args: ["/c", "exit", "0"] });
  await assert.rejects(actions.run({ target: "gibt-es-nicht-cw.exe" }), /nicht gefunden|ENOENT/);
  console.log("Unbekanntes Programm → Fehler statt Absturz: ok");

  r = await a.handle("mach lauter");
  assert.equal(r.ok, true, "Medientaste: " + r.error);
  r = await a.handle("mach leiser");
  assert.equal(r.ok, true);
  console.log("Lautstärke-Tasten (PowerShell keybd_event): ok");

  r = await a.handle("öffne downloads");
  assert.equal(r.say, "Downloads wird geöffnet");
  assert.match(opened.at(-1), /\\Downloads$/);
  assert.ok(!opened.at(-1).includes("%"), "Umgebungsvariable nicht ersetzt: " + opened.at(-1));
  console.log("„Öffne Downloads“ →", opened.at(-1));

  assert.match((await a.handle("wie spät ist es")).say, /Uhr/);
  console.log("Windows-Praxistest bestanden.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
