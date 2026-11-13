// 1.7: Wecker, Screenshot
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { Assistant } = require("../src/core/assistant");
const { screenshotScript } = require("../src/core/winscripts");

function setup({ media = { ok: true, app: "AmazonMobileLLC.AmazonMusic_kc6t79cpj4tdy!App" }, dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cw17-")) } = {}) {
  const calls = [];
  const actions = {
    screenshot: async (a) => (calls.push("shot " + a.mode), { ok: true, file: "C:\\Bilder\\x.png", name: a.mode === "window" ? "notepad" : "" }),
    open: async (a) => calls.push("open " + a.target),
    mediaSession: async (a) => (calls.push(`media ${a.command} ${a.app}`.trim()), typeof media === "function" ? media(a) : media),
    appVolume: async (a) => (calls.push(`vol ${a.op} ${a.match} ${Math.round(a.value * 100) / 100}`), { ok: true }),
  };
  const a = new Assistant({ modsDir: path.join(__dirname, "..", "mods"), actions, dataDir, say: (t) => calls.push("say " + t), notify: () => {}, sound: (n, on) => calls.push(`sound ${n} ${on}`), reveal: (f) => calls.push("reveal " + f) });
  a.reload();
  return { a, calls, dataDir };
}
const clear = () => {
  const R = globalThis.__cwAlarms;
  if (!R) return;
  for (const t of R.timers.values()) clearTimeout(t);
  R.timers.clear();
  if (R.ringing) (clearInterval(R.ringing.ramp), clearTimeout(R.ringing.end));
  R.ringing = null;
};

test("Wecker stellen, auflisten, nach Neustart wieder da, löschen", async (t) => {
  t.after(clear);
  const { a, dataDir } = setup();
  assert.match((await a.handle("weck mich um sieben uhr")).say, /^Okay, der Wecker klingelt (heute|morgen) um 7:00 Uhr\.$/);
  assert.match((await a.handle("wecker auf sechs uhr dreißig")).say, /6:30 Uhr/);
  assert.match((await a.handle("wake me up at seven am", "en")).say, /^Okay, alarm set for (today|tomorrow) at 7:00 AM\.$/);
  assert.match((await a.handle("welche wecker habe ich")).say, /^Du hast 3 Wecker: /);
  a.reload();
  a.reload();
  assert.equal(globalThis.__cwAlarms.timers.size, 3);
  const b = setup({ dataDir });
  assert.equal(globalThis.__cwAlarms.timers.size, 3);
  assert.equal((await b.a.handle("lösche alle wecker")).say, "3 Wecker gelöscht.");
  assert.equal((await b.a.handle("welche wecker habe ich")).say, "Du hast keinen Wecker gestellt.");
  assert.equal((await b.a.handle("wecker aus")).say, "Gerade klingelt kein Wecker.");
});

test("Wecker klingelt: Amazon Music leise fortsetzen, dann lauter; „Wecker aus“", async (t) => {
  t.after(clear);
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: new Date(2026, 10, 13, 6, 59, 0).getTime() });
  const { a, calls } = setup();
  await a.handle("weck mich um sieben uhr");
  calls.splice(0);
  t.mock.timers.tick(60 * 1000);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls.slice(0, 4), ["media info amazon", "vol set amazon music 0.1", "media play amazon", "say Guten Morgen! Es ist 7 Uhr."]);
  t.mock.timers.tick(30 * 1000);
  assert.deepEqual(calls.filter((c) => c.startsWith("vol")).slice(1), ["vol set amazon music 0.17", "vol set amazon music 0.24"]);
  assert.equal((await a.handle("wecker aus")).say, "Wecker aus. Einen schönen Tag!");
  const n = calls.length;
  t.mock.timers.tick(60 * 1000);
  assert.equal(calls.length, n, "nach „Wecker aus“ wird nicht weiter lauter gedreht");
});

test("Wecker ohne Musik: Weckton; Schlummern weckt nach 9 Minuten nochmal", async (t) => {
  t.after(clear);
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: new Date(2026, 10, 13, 6, 59, 0).getTime() });
  const { a, calls } = setup({ media: { ok: false, error: "keine Wiedergabe" } });
  await a.handle("weck mich um sieben uhr");
  t.mock.timers.tick(60 * 1000);
  for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
  assert.ok(calls.includes("sound alarm true"), calls.join(" | "));
  assert.equal((await a.handle("schlummern")).say, "Okay, ich wecke dich in 9 Minuten nochmal.");
  assert.ok(calls.includes("sound alarm false"));
  calls.splice(0);
  t.mock.timers.tick(9 * 60 * 1000);
  for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
  assert.ok(calls.includes("sound alarm true"), "nach dem Schlummern klingelt er wieder");
  assert.equal((await a.handle("alarm off", "en")).say, "Alarm off. Have a nice day!");
});

test("Screenshot: Bildschirm, Fenster, letzten zeigen", async () => {
  const { a, calls } = setup();
  assert.equal((await a.handle("zeig den letzten screenshot")).say, "Ich habe noch keinen Screenshot gemacht.");
  assert.equal((await a.handle("mach einen screenshot")).say, "Screenshot gespeichert unter Bilder, Screenshots.");
  assert.equal((await a.handle("screenshot vom fenster")).say, "Screenshot von dem Editor gespeichert.");
  assert.equal((await a.handle("take a screenshot of the window", "en")).say, "Saved a screenshot of Notepad.");
  await a.handle("zeig den letzten screenshot");
  await a.handle("zeig meine screenshots");
  assert.deepEqual(calls, ["shot screen", "shot window", "shot window", "open C:\\Bilder\\x.png", "reveal C:\\Bilder\\x.png"]);
  assert.match(screenshotScript("C:\\a'b.png", "window", 9), /\$file = 'C:\\a''b\.png'; \$mode = 'window'; \$skip = 9/);
});
