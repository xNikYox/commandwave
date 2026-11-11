const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { Assistant, UNKNOWN } = require("../src/core/assistant");
const { createActions, mediaScript } = require("../src/core/actions");
const { validate, compareVersions, seedDefaults, loadAll } = require("../src/core/mods");

const MODS = path.join(__dirname, "..", "mods");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cw-"));

/** Windows-Attrappe: merkt sich gestartete Programme */
function fakeEnv(notFound = []) {
  const calls = [];
  return {
    calls,
    env: {
      platform: "win32",
      spawn(cmd, args) {
        calls.push([cmd, ...args].join(" "));
        const e = new EventEmitter();
        e.unref = () => {};
        setImmediate(() => (notFound.includes(cmd) ? e.emit("error", Object.assign(new Error("ENOENT"), { code: "ENOENT" })) : e.emit("spawn")));
        setImmediate(() => e.emit("exit", 0));
        return e;
      },
      openExternal: async (u) => calls.push("öffne " + u),
      openPath: async (p) => (calls.push("pfad " + p), ""),
    },
  };
}

test("mitgelieferte Mods laden ohne Fehler", () => {
  const a = new Assistant({ modsDir: MODS, actions: createActions(fakeEnv().env), dataDir: tmp() });
  const s = a.reload();
  assert.deepEqual(s.errors, []);
  assert.deepEqual(a.mods.map((m) => m.id), ["apps", "hilfe", "medien", "system", "uhrzeit", "webseiten"]);
  assert.ok(a.mods.find((m) => m.id === "uhrzeit").script);
  assert.ok(s.commands >= 15);
});

test("Beispiel aus der Aufgabe: Editor starten mit Antwort, Unbekanntes", async () => {
  const f = fakeEnv();
  const a = new Assistant({ modsDir: MODS, actions: createActions(f.env), dataDir: tmp() });
  a.reload();
  const r = await a.handle("Öffne die App Editor");
  assert.equal(r.ok, true);
  assert.equal(r.say, "Editor wird gestartet");
  assert.deepEqual(f.calls, ["notepad.exe"]);
  const u = await a.handle("erzähl mir einen witz");
  assert.equal(u.ok, false);
  assert.equal(u.say, UNKNOWN);
  assert.equal(u.say, "Diesen Befehl kenne ich leider nicht.");
});

test("Aktionen der mitgelieferten Mods", async () => {
  const f = fakeEnv(["winword"]);
  const a = new Assistant({ modsDir: MODS, actions: createActions(f.env), dataDir: tmp() });
  a.reload();
  const cases = [
    ["schließe paint", "Paint wird geschlossen", "taskkill.exe /IM mspaint.exe"],
    ["öffne word", "Word wird gestartet", 'winword; cmd.exe /d /s /c start "" winword'],
    ["öffne youtube", "Ich öffne YouTube.", "öffne https://www.youtube.com"],
    ["öffne die bluetooth einstellungen", "Ich öffne die Einstellungen für Bluetooth.", "öffne ms-settings:bluetooth"],
    ["öffne die einstellungen", "Einstellungen wird gestartet", "öffne ms-settings:"],
    ["sperre den computer", "Der Computer wird gesperrt.", "rundll32.exe user32.dll,LockWorkStation"],
  ];
  for (const [t, say, call] of cases) {
    const r = await a.handle(t);
    assert.equal(r.say, say, t);
    assert.equal(f.calls.splice(0).join("; "), call, t);
  }
  const loud = await a.handle("mach lauter");
  assert.equal(loud.ok, true);
  assert.match(f.calls.splice(0)[0], /^powershell\.exe .*keybd_event\(175/);
});

test("Skript-Mod (Uhrzeit, Timer) und Hilfe", async () => {
  const said = [];
  const a = new Assistant({ modsDir: MODS, actions: createActions(fakeEnv().env), dataDir: tmp(), say: (t) => said.push(t) });
  a.reload();
  assert.match((await a.handle("wie spät ist es")).say, /^Es ist \d{1,2} Uhr/);
  assert.match((await a.handle("welcher tag ist heute")).say, /^Heute ist \w+, der \d+\. \w+ \d{4}\.$/);
  assert.equal((await a.handle("stelle einen timer auf fünf minuten")).say, "Timer auf 5 Minuten gestellt.");
  assert.equal((await a.handle("lösche alle timer")).say, "1 Timer gelöscht.");
  assert.match((await a.handle("was kannst du")).say, /Apps starten und schließen.*Webseiten öffnen/);
});

test("eigene Mod: hineinlegen, neu laden, abschalten, kaputte Mod meldet Fehler", async () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "gruss"));
  fs.writeFileSync(path.join(dir, "gruss", "mod.json"), JSON.stringify({ id: "gruss", version: "1.0.0", commands: [{ phrases: ["guten morgen"], say: "Guten Morgen! Schön, dass du da bist." }] }));
  fs.mkdirSync(path.join(dir, "kaputt"));
  fs.writeFileSync(path.join(dir, "kaputt", "mod.json"), "{ nicht json");
  fs.mkdirSync(path.join(dir, "falsch"));
  fs.writeFileSync(path.join(dir, "falsch", "mod.json"), JSON.stringify({ id: "anders", version: "x" }));
  const a = new Assistant({ modsDir: dir, actions: createActions(fakeEnv().env), dataDir: dir });
  a.reload();
  assert.equal((await a.handle("guten morgen")).say, "Guten Morgen! Schön, dass du da bist.");
  assert.deepEqual(a.errors.map((e) => e.dir).sort(), ["falsch", "kaputt"]);
  assert.match(a.errors.find((e) => e.dir === "falsch").error, /passt nicht zum Ordnernamen.*version/);
  a.reload(["gruss"]);
  assert.equal((await a.handle("guten morgen")).ok, false);
  // Änderung an main.js wirkt nach „Neu laden“ ohne Neustart
  fs.writeFileSync(path.join(dir, "gruss", "mod.json"), JSON.stringify({ id: "gruss", version: "1.0.1", main: "main.js" }));
  fs.writeFileSync(path.join(dir, "gruss", "main.js"), 'module.exports = (api) => api.command("guten morgen", () => "Version eins");');
  a.reload([]);
  assert.equal((await a.handle("guten morgen")).say, "Version eins");
  fs.writeFileSync(path.join(dir, "gruss", "main.js"), 'module.exports = (api) => api.command("guten morgen", () => "Version zwei");');
  a.reload([]);
  assert.equal((await a.handle("guten morgen")).say, "Version zwei");
});

test("Fehler in einer Aktion → freundliche Antwort statt Absturz", async () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "x"));
  fs.writeFileSync(path.join(dir, "x", "mod.json"), JSON.stringify({ id: "x", version: "1.0.0", main: "main.js" }));
  fs.writeFileSync(path.join(dir, "x", "main.js"), 'module.exports = (api) => api.command("kaputt", () => { throw new Error("Absicht"); });');
  const a = new Assistant({ modsDir: dir, actions: {}, dataDir: dir });
  a.reload();
  const r = await a.handle("kaputt");
  assert.equal(r.say, "Das hat leider nicht geklappt.");
  assert.equal(r.error, "Absicht");
});

test("Prüfung von mod.json, Versionen, Standard-Mods kopieren", () => {
  assert.equal(validate({ id: "ok", version: "1.0.0", commands: [{ phrases: ["a"], action: { type: "run" } }] }, "ok").mod.id, "ok");
  assert.match(validate({ id: "Gross", version: "1" }).error, /id/);
  assert.match(validate({ id: "a", version: "1.0.0", commands: [{ phrases: [] }] }).error, /phrases/);
  assert.match(validate({ id: "a", version: "1.0.0", commands: [{ phrases: ["x"], action: { type: "format c" } }] }).error, /unbekannte Aktion/);
  assert.match(validate({ id: "a", version: "1.0.0", main: "../evil.js" }).error, /main/);
  assert.equal(compareVersions("1.10.0", "1.9.9"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0-beta"), 1);
  assert.equal(compareVersions("1.0", "1.0.0"), 0);
  const dst = tmp();
  assert.deepEqual(seedDefaults(MODS, dst).sort(), ["apps", "hilfe", "medien", "system", "uhrzeit", "webseiten"]);
  assert.deepEqual(seedDefaults(MODS, dst), []); // schon da, gleiche Version → nichts überschreiben
  assert.equal(loadAll(dst, { actions: {} }).errors.length, 0);
});

test("Medien-Tasten sicher erzeugt", () => {
  assert.match(mediaScript("volume_up", 5), /lt 5;.*keybd_event\(175,0,0,0\)/);
  assert.match(mediaScript("mute", 999), /lt 50;/);
  assert.throws(() => mediaScript("format"), /Unbekannte Taste/);
});
