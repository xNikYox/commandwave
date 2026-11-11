const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { toSlots, speakable } = require("../src/core/apps");
const { createActions } = require("../src/core/actions");
const { Assistant, NOTHING } = require("../src/core/assistant");
const path = require("node:path");
const os = require("node:os");

const START_APPS = [
  { Name: "Visual Studio Code", AppID: "Microsoft.VisualStudioCode" },
  { Name: "Microsoft Edge", AppID: "MSEdge" },
  { Name: "GIMP 2.10.34", AppID: "{6D809377}\\GIMP 2\\bin\\gimp-2.10.exe" },
  { Name: "Spotify", AppID: "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify" },
  { Name: "7-Zip Help", AppID: "x" },
  { Name: "Uninstall Steam", AppID: "y" },
  { Name: "Minecraft Launcher™", AppID: "Microsoft.4297127D64EC6_8wekyb3d8bbwe!Minecraft" },
  { Name: "Editor", AppID: "Microsoft.WindowsNotepad_8wekyb3d8bbwe!App" },
];

test("Startmenü-Apps werden zu sprechbaren Namen", () => {
  const s = toSlots(START_APPS);
  assert.deepEqual(Object.keys(s).sort(), ["edge", "editor", "gimp", "microsoft edge", "minecraft launcher", "spotify", "visual studio code"]);
  assert.equal(s.edge.target, "shell:AppsFolder\\MSEdge");
  assert.equal(s["minecraft launcher"].label, "Minecraft Launcher");
  assert.equal(speakable("Adobe Photoshop 2024 (x64)"), "adobe photoshop 2024");
  assert.deepEqual(toSlots(null), {});
  assert.deepEqual(Object.keys(toSlots({ Name: "Paint", AppID: "p" })), ["paint"]); // ein einzelnes Ergebnis ist kein Array
});

test("gefundene Apps: „Öffne Visual Studio Code“ startet über den Explorer; Mod-Werte haben Vorrang", async () => {
  const calls = [];
  const env = {
    platform: "win32",
    spawn(cmd, args, opts) {
      calls.push({ line: [cmd, ...args].join(" "), opts });
      const e = new EventEmitter();
      e.unref = () => {};
      setImmediate(() => e.emit("spawn"));
      return e;
    },
    openExternal: async () => {},
    openPath: async () => "",
  };
  const a = new Assistant({ modsDir: path.join(__dirname, "..", "mods"), actions: createActions(env), dataDir: os.tmpdir() });
  a.reload();
  a.setExtraSlots({ app: toSlots(START_APPS) });
  let r = await a.handle("öffne visual studio code");
  assert.equal(r.say, "Visual Studio Code wird gestartet");
  assert.equal(calls.at(-1).line, "explorer.exe shell:AppsFolder\\Microsoft.VisualStudioCode");
  r = await a.handle("starte gimp");
  assert.equal(r.say, "GIMP 2.10.34 wird gestartet");
  // „editor“ gibt es in der Apps-Mod (notepad.exe) und im Startmenü – die Mod gewinnt
  r = await a.handle("öffne den editor");
  assert.equal(calls.at(-1).line, "notepad.exe");
  // Programme werden NICHT mit verstecktem Fenster gestartet
  assert.ok(calls.every((c) => !c.opts?.windowsHide), "windowsHide darf nicht gesetzt sein");
  // realistisch viele Apps (Testrechner: 109): jede App einmal, nicht in jedem Muster wiederholt
  const many = [...START_APPS, ...Array.from({ length: 60 }, (_, i) => ({ Name: "Programm " + i, AppID: "p" + i }))];
  a.setExtraSlots({ app: toSlots(many) });
  assert.ok(a.grammar.includes("visual studio code"), "jede App einmal in der Grammatik");
  assert.ok(!a.grammar.includes("starte die app programm 59"), "Apps nicht in jedem Muster wiederholt");
  assert.ok(a.grammar.length < 3000, String(a.grammar.length));
  assert.equal(a.grammar.at(-1), "[unk]");
});

test("nichts gehört → eigene Antwort statt „Befehl unbekannt“", async () => {
  const a = new Assistant({ modsDir: path.join(__dirname, "..", "mods"), actions: {}, dataDir: os.tmpdir() });
  a.reload();
  for (const t of ["", "[unk]", "  "]) {
    const r = await a.handle(t);
    assert.equal(r.say, NOTHING);
    assert.equal(r.say, "Ich habe nichts gehört.");
  }
});
