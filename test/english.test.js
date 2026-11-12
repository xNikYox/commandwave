const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const { Assistant, TEXT } = require("../src/core/assistant");
const P = require("../src/core/phrases");

function setup() {
  const calls = [];
  const actions = {
    run: async (a) => calls.push("run " + a.target),
    open: async (a) => calls.push("open " + a.target),
    media: async (a) => calls.push("taste " + a.key),
    mediaSession: async (a) => (calls.push(`media ${a.command} ${a.app}`.trim()), { ok: true, title: "Blinding Lights", artist: "The Weeknd", app: "Spotify.exe" }),
    browser: async (a) => (calls.push(`browser ${a.op}${a.match ? " " + a.match : ""}`), { ok: true, count: 1 }),
  };
  const a = new Assistant({ modsDir: path.join(__dirname, "..", "mods"), actions, dataDir: os.tmpdir() });
  a.reload();
  return { a, calls };
}

test("englische Befehle werden erkannt und auf Englisch beantwortet", async () => {
  const { a, calls } = setup();
  assert.equal((await a.handle("open notepad", "en")).say, "Starting Notepad");
  assert.equal((await a.handle("close paint", "en")).say, "Closing Paint");
  assert.match((await a.handle("what time is it", "en")).say, /^It's /);
  assert.equal((await a.handle("set a timer for five minutes", "en")).say, "Timer set for 5 minutes.");
  await a.handle("timer stopp", "de"); // Timer wieder löschen, sonst bleibt der Test offen
  assert.equal((await a.handle("open youtube", "en")).say, "Opening YouTube.");
  calls.splice(0);
  await a.handle("next song on spotify", "en");
  await a.handle("volume up", "en");
  await a.handle("close the youtube tab", "en");
  assert.deepEqual(calls, ["media next spotify", "taste volume_up", "browser closeMatching youtube"]);
  assert.equal((await a.handle("tell me a joke", "en")).say, TEXT.en.unknown);
});

test("deutsche und englische Befehle bleiben getrennt", () => {
  const { a } = setup();
  assert.equal(a.matchOnly("open notepad", "de"), null);
  assert.equal(a.matchOnly("öffne den editor", "en"), null);
  assert.ok(a.matchOnly("öffne den editor", "de"));
  assert.ok(a.grammars.de.length && a.grammars.en.length);
  assert.ok(!a.grammars.en.join(" ").includes("öffne"));
});

test("beide Sprachen: der passendere Satz gewinnt, Antwort in dessen Sprache", async () => {
  const { a } = setup();
  const en = await a.handleMulti([{ lang: "de", text: "öffne ein pad", conf: 0.4 }, { lang: "en", text: "open notepad", conf: 0.9 }], "de");
  assert.equal(en.lang, "en");
  assert.equal(en.say, "Starting Notepad");
  const de = await a.handleMulti([{ lang: "de", text: "starte den rechner", conf: 0.9 }, { lang: "en", text: "start the rest", conf: 0.5 }], "de");
  assert.equal(de.lang, "de");
  assert.equal(de.say, "Rechner wird gestartet");
  const none = await a.handleMulti([{ lang: "de", text: "", conf: null }, { lang: "en", text: "", conf: null }], "en");
  assert.equal(none.say, TEXT.en.nothing);
});

test("englische Anzeige-Namen in Antworten", () => {
  assert.equal(P.fill("Opening {seite}.", { seite: { key: "weather", value: { label: "Wetter", label_en: "the weather" } } }, {}, "en"), "Opening the weather.");
});
