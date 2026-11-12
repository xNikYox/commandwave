// Amazon Music: bestimmte Lieder/Playlists/Sender – Rückfrage, Suche in der App, Ersatzwege
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const { Assistant } = require("../src/core/assistant");
const { amazonMusicScript } = require("../src/core/winscripts");
const { createActions } = require("../src/core/actions");

function setup(amazon, info = [{ ok: false }, { ok: true, title: "Blinding Lights", artist: "The Weeknd", status: "Playing" }], answer = "blinding lights") {
  const calls = [];
  let n = 0;
  const actions = {
    amazonMusic: async (a) => (calls.push("amazon " + a.query), amazon),
    mediaSession: async () => info[Math.min(n++, info.length - 1)],
    open: async (a) => calls.push("open " + a.target),
  };
  const a = new Assistant({ modsDir: path.join(__dirname, "..", "mods"), actions, dataDir: os.tmpdir(), ask: async () => answer });
  a.reload();
  return { a, calls };
}

test("„Spiele etwas auf Amazon Music“ → fragt, sucht, sagt was läuft", async () => {
  const { a, calls } = setup({ ok: true, clicked: "Abspielen" });
  assert.equal((await a.handle("spiele etwas auf amazon music")).say, "Ich spiele Blinding Lights von The Weeknd.");
  assert.deepEqual(calls, ["amazon blinding lights"]);
  assert.equal((await setup({ ok: true }).a.handle("play something on amazon music", "en")).say, "Playing Blinding Lights by The Weeknd.");
  for (const t of ["spiel eine playlist auf amazon musik", "spiele einen sender auf amazon", "spiele meine playlist bei amazon music"]) assert.equal((await setup({ ok: true }).a.handle(t)).ok, true, t);
});

test("Amazon Music: Ersatzwege und ehrliche Antworten", async () => {
  // nicht installiert → Suche im Browser
  let s = setup({ ok: false, step: "app", error: "nicht installiert" });
  assert.equal((await s.a.handle("spiele etwas auf amazon music")).say, "Amazon Music ist nicht installiert – ich habe die Suche nach „blinding lights“ im Browser geöffnet.");
  assert.deepEqual(s.calls, ["amazon blinding lights", "open https://music.amazon.de/search/blinding%20lights"]);
  // gesucht, aber kein Abspielen-Knopf gefunden
  s = setup({ ok: false, step: "abspielen", error: "kein Abspielen-Knopf", searched: true });
  assert.match((await s.a.handle("spiele etwas auf amazon music")).say, /gesucht, konnte es aber nicht starten/);
  // geklickt, aber es läuft (noch) nichts Neues → nicht behaupten, was läuft
  s = setup({ ok: true }, [{ ok: true, title: "Altes Lied", status: "Playing" }]);
  assert.equal((await s.a.handle("spiele etwas auf amazon music")).say, "Ich spiele „blinding lights“ auf Amazon Music.");
  // keine Antwort auf die Rückfrage
  s = setup({ ok: true }, undefined, null);
  assert.equal((await s.a.handle("spiele etwas auf amazon music")).say, "Okay, dann nicht.");
  assert.deepEqual(s.calls, []);
});

test("Amazon-Music-Skript: Suchbegriff sicher eingesetzt, Fehlersuche ins Protokoll", async () => {
  const sc = amazonMusicScript("rock'n'roll (live) 100%");
  assert.match(sc, /\$q = 'rock''n''roll \(live\) 100%'/);
  const fs = require("node:fs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-am-"));
  const actions = createActions({ diagDir: dir, powershellJson: async () => ({ ok: false, step: "suchfeld", error: "Suchfeld nicht gefunden", dump: ["Button: Start", "Edit: "] }) });
  const r = await actions.amazonMusic({ query: "test" });
  assert.equal(r.dump, undefined);
  assert.match(fs.readFileSync(path.join(dir, "amazon-music.log"), "utf8"), /suchfeld: Suchfeld nicht gefunden – Suche „test“\nButton: Start/);
});
