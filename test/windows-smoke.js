// Praxistest auf echtem Windows (GitHub Actions): Programme starten/schließen, Medientasten, Ordner öffnen.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const { createActions } = require("../src/core/actions");
const { Assistant } = require("../src/core/assistant");
const { START_APPS_CMD, toSlots } = require("../src/core/apps");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Hat der Prozess ein sichtbares Fenster? (früher startete CommandWave Programme versteckt) */
const visibleWindow = (name) => execFileSync("powershell.exe", ["-NoProfile", "-Command",
  "Add-Type -Namespace W -Name U -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool IsWindowVisible(IntPtr h);'; " +
  `$p = Get-Process -Name ${name} -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }; if ($p -and [W.U]::IsWindowVisible($p[0].MainWindowHandle)) { 'ja' } else { 'nein' }`]).toString().trim();
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
  assert.equal(visibleWindow("notepad"), "ja", "Editor läuft, aber ohne sichtbares Fenster");
  console.log("„Öffne die App Editor“ → Editor läuft mit sichtbarem Fenster: ok");

  r = await a.handle("schließe den editor");
  assert.equal(r.say, "Editor wird geschlossen");
  await wait(2500);
  assert.ok(!running("notepad.exe"), "Editor läuft noch");
  console.log("„Schließe den Editor“ → beendet: ok");

  // Installierte Apps aus dem Startmenü (Get-StartApps) und Start über shell:AppsFolder
  const list = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command", START_APPS_CMD]).toString() || "[]");
  const slots = toSlots(list);
  console.log(`Get-StartApps: ${[].concat(list).length} Einträge → ${Object.keys(slots).length} sprechbare Apps, z. B. ${Object.keys(slots).slice(0, 12).join(", ")}`);
  assert.ok(Object.keys(slots).length >= 5, "zu wenige Apps gefunden");
  a.setExtraSlots({ app: slots });
  const np = Object.entries(slots).find(([, v]) => /notepad/i.test(v.target));
  if (np) {
    await actions.run({ target: np[1].target });
    await wait(3000);
    assert.ok(running("notepad.exe"), "Start über shell:AppsFolder hat nicht geklappt: " + np[1].target);
    console.log(`Start über das Startmenü (${np[1].target}): ok`);
    execFileSync("taskkill", ["/IM", "notepad.exe", "/F"]);
  } else console.log("Editor nicht im Startmenü gefunden – Start über shell:AppsFolder nicht geprüft");

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
