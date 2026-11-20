// 2.0: Routinen – Zeitplan (nächster Lauf, Wochentage), Schritte nacheinander mit Fehler-Toleranz
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../src/core/routines");

const at = (y, mo, d, h, mi, s = 0) => new Date(y, mo - 1, d, h, mi, s);
// 20.11.2026 ist ein Freitag
test("nächster Lauf: Uhrzeit an Wochentagen", () => {
  const work = { time: "08:00", days: [1, 2, 3, 4, 5] };
  assert.deepEqual(R.nextTime(work, at(2026, 11, 20, 7, 0)), at(2026, 11, 20, 8, 0)); // Freitag vor 8
  assert.deepEqual(R.nextTime(work, at(2026, 11, 20, 8, 0)), at(2026, 11, 23, 8, 0)); // genau 8 → nächster Werktag (Montag)
  assert.deepEqual(R.nextTime(work, at(2026, 11, 21, 12, 0)), at(2026, 11, 23, 8, 0)); // Samstag → Montag
  assert.deepEqual(R.nextTime({ time: "22:30", days: [6] }, at(2026, 11, 20, 23, 0)), at(2026, 11, 21, 22, 30));
  assert.deepEqual(R.nextTime({ time: "07:15", days: [5] }, at(2026, 11, 20, 7, 16)), at(2026, 11, 27, 7, 15)); // eine Woche später
  assert.equal(R.nextTime({ time: "08:00", days: [] }, at(2026, 11, 20, 7, 0)), null);
  assert.equal(R.nextTime({ time: "25:00", days: [1] }, at(2026, 11, 20, 7, 0)), null);
  const r = { enabled: true, times: [{ time: "18:00", days: [5] }, { time: "09:00", days: [6, 0] }] };
  assert.deepEqual(R.nextRun(r, at(2026, 11, 20, 19, 0)), at(2026, 11, 21, 9, 0));
  assert.equal(R.nextRun({ ...r, enabled: false }, at(2026, 11, 20, 19, 0)), null);
  // Zeitumstellung (25.10.2026, 3 → 2 Uhr): 08:00 bleibt 08:00 Ortszeit
  assert.equal(R.nextTime({ time: "08:00", days: [0] }, at(2026, 10, 24, 12, 0)).getHours(), 8);
});

test("Routine aufräumen: Name, Sätze ohne Muster-Zeichen, Zeiten, Schritte", () => {
  const r = R.normalize({ name: "  Gaming Modus ", phrases: ["Gaming-Modus!", "gaming (modus)", ""], times: [{ time: "8:05", days: [1, 1, 9, 2] }, { time: "x" }],
    onStart: 1, steps: [{ type: "website", url: "youtube.com" }, { type: "volume", value: 140 }, { type: "wait", seconds: 99999 }, { type: "format c" }, { type: "say", text: "  " }] }, () => "r1");
  assert.deepEqual(r, { id: "r1", name: "Gaming Modus", enabled: true, phrases: ["gaming modus"], times: [{ time: "08:05", days: [1, 2] }], onStart: true,
    steps: [{ type: "website", url: "https://youtube.com" }, { type: "volume", value: 100 }, { type: "wait", seconds: 3600 }] });
  assert.equal(R.normalize({ name: "" }), null);
  assert.equal(R.triggerLabel(r), "„gaming modus“ · Mo, Di 08:05 · beim Start");
  assert.equal(R.daysLabel([1, 2, 3, 4, 5]), "Mo–Fr");
  assert.equal(R.daysLabel([6, 0]), "Sa, So");
  assert.equal(R.daysLabel([0, 1, 2, 3, 4, 5, 6]), "täglich");
});

test("Zeitplan: weckt zur richtigen Zeit, je Minute nur einmal, verpasste nicht nachholen", async () => {
  let now = at(2026, 11, 20, 7, 59, 0);
  const timers = [];
  const ran = [];
  const s = new R.Scheduler({ now: () => new Date(now), setTimeout: (f, ms) => (timers.push({ f, ms }), timers.length), clearTimeout: () => {}, run: (r) => ran.push(r.name + "@" + new Date(now).toTimeString().slice(0, 5)) });
  const morning = { id: "a", name: "Morgen", enabled: true, times: [{ time: "08:00", days: [1, 2, 3, 4, 5] }] };
  const evening = { id: "b", name: "Abend", enabled: true, times: [{ time: "08:00", days: [5] }, { time: "20:00", days: [5] }] };
  s.update([morning, evening]);
  assert.equal(timers.at(-1).ms, 60 * 1000);
  now = at(2026, 11, 20, 8, 0, 0);
  timers.at(-1).f();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(ran.sort(), ["Abend@08:00", "Morgen@08:00"]);
  // nächster: 20:00 – aber höchstens 1 Stunde am Stück schlafen
  assert.equal(timers.at(-1).ms, 3600 * 1000);
  now = at(2026, 11, 20, 9, 0, 0);
  timers.at(-1).f();
  assert.equal(ran.length, 2);
  // PC hat geschlafen: 20:00 erst um 23:00 bemerkt → nicht nachholen, nächster Termin Montag 08:00
  now = at(2026, 11, 20, 23, 0, 0);
  timers.at(-1).f();
  await new Promise((r) => setImmediate(r));
  assert.equal(ran.length, 2);
  assert.deepEqual(s.next().at, at(2026, 11, 23, 8, 0));
  s.update([]);
  assert.equal(s.next().at, null);
});

test("Schritte: nacheinander, ein Fehler stoppt nicht, Zusammenfassung", async () => {
  const log = [];
  const exec = {
    command: async (t) => log.push("befehl " + t),
    app: async (t) => {
      log.push("app " + t);
      throw new Error("nicht gefunden");
    },
    website: async (u) => log.push("web " + u),
    volume: async (v) => log.push("vol " + v),
    wait: async (s) => log.push("warte " + s),
    say: async (t) => log.push("sage " + t),
  };
  const r = R.normalize({ name: "Arbeitsmodus", steps: [{ type: "command", text: "öffne die app editor" }, { type: "app", target: "Spotify" }, { type: "wait", seconds: 2 },
    { type: "volume", value: 30 }, { type: "website", url: "https://github.com" }, { type: "say", text: "Los geht's" }] });
  const res = await R.runSteps(r, exec);
  assert.deepEqual(log, ["befehl öffne die app editor", "app Spotify", "warte 2", "vol 30", "web https://github.com", "sage Los geht's"]);
  assert.equal(res.ok, false);
  assert.deepEqual(res.failed.map((f) => [f.index, f.label, f.error]), [[1, "Spotify starten", "nicht gefunden"]]);
  assert.equal(R.summary("Arbeitsmodus", res), "Routine Arbeitsmodus ist fertig – ein Schritt hat nicht geklappt: Spotify starten.");
  assert.equal(R.summary("Arbeitsmodus", { ok: true, total: 3, failed: [] }), "Routine Arbeitsmodus ist fertig.");
  assert.equal(R.summary("Leer", { ok: true, total: 0, failed: [] }), "Die Routine Leer hat noch keine Schritte.");
  assert.equal(R.stepLabel({ type: "wait", seconds: 120 }), "2 Min. warten");
  assert.equal(R.stepLabel({ type: "website", url: "https://www.youtube.com/" }), "youtube.com öffnen");
});

test("Mod „routinen“: eigener Satz, „Starte Routine …“, „Welche Routinen gibt es“", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { Assistant } = require("../src/core/assistant");
  const started = [];
  const list = [{ id: "r1", name: "Arbeitsmodus", enabled: true, phrases: ["arbeitsmodus"], steps: 3 }, { id: "r2", name: "Gaming Modus", enabled: true, phrases: ["gaming modus"], steps: 2 },
    { id: "r3", name: "Leer", enabled: true, phrases: [], steps: 0 }, { id: "r4", name: "Aus", enabled: false, phrases: ["aus modus"], steps: 1 }];
  const a = new Assistant({ modsDir: path.join(__dirname, "..", "mods"), actions: {}, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "cw-rt-")), appVersion: "2.0.0",
    routines: { list: () => list, run: async (id) => started.push(id) } });
  a.reload();
  assert.equal((await a.handle("arbeitsmodus")).say, "Ich starte die Routine Arbeitsmodus.");
  assert.equal((await a.handle("starte die routine gaming modus")).say, "Ich starte die Routine Gaming Modus.");
  assert.equal((await a.handle("starte routine leer")).say, "Die Routine Leer hat noch keine Schritte.");
  t.mock.timers.tick(500);
  assert.deepEqual(started, ["r1", "r2"]);
  assert.equal((await a.handle("welche routinen gibt es")).say, "Deine Routinen: Arbeitsmodus, Gaming Modus und Leer.");
  assert.equal((await a.handle("aus modus")).ok, false); // abgeschaltete Routine hört nicht
  assert.ok(a.grammar.includes("arbeitsmodus") && a.grammar.includes("gaming modus"));
  assert.equal((await a.handle("what routines are there", "en")).say, "Your routines: Arbeitsmodus, Gaming Modus and Leer.");
});
