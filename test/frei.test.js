// 1.8: Befehle mit freiem Rest („spiel lieder von SDP“) – erst Befehl erkennen, dann dieselbe Aufnahme frei erkennen
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { Assistant } = require("../src/core/assistant");
const P = require("../src/core/phrases");

function setup() {
  const calls = [];
  const actions = {
    amazonMusic: async (a) => (calls.push("amazon " + a.query), { ok: true }),
    mediaSession: async () => ({ ok: false }),
    media: async () => {},
    open: async (a) => calls.push("open " + a.target),
  };
  const a = new Assistant({ modsDir: path.join(__dirname, "..", "mods"), actions, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "cwf-")), ask: async () => (calls.push("ask"), "gefragt"), notify: () => {} });
  a.reload();
  return { a, calls };
}

test("freier Rest: Muster, Bewertung, Grammatik", () => {
  const c = P.compile([{ id: "x", phrases: ["(spiel|spiele) [lieder] von {frei}"] }, { id: "w", phrases: ["(spiel|spiele) weiter"] }]);
  assert.equal(P.match("spiel lieder von sdp", c, {}).slots.frei.key, "sdp");
  assert.equal(P.match("spiel weiter", c, {}).command.id, "w"); // feste Befehle gewinnen
  assert.equal(P.match("spiel lieder", c, {}), null); // ohne Namen kein Treffer
  assert.ok(P.compactGrammar(c, {}).includes("spiel lieder von"));
  assert.ok(!P.compactGrammar(c, {}).some((g) => g.includes("frei")));
});

test("„Spiel Lieder von SDP“: erst Rückmeldung „frei erkennen“, dann mit dem frei erkannten Text abspielen", async () => {
  const { a, calls } = setup();
  a.setAliases({ _woerter: { "es de pe": { key: "SDP", lang: "de" } } });
  // die Befehls-Erkennung hört den Namen falsch
  const r = await a.handleMulti([{ lang: "de", text: "spiel lieder von der pille", conf: 0.9 }]);
  assert.equal(r.needFree, true);
  assert.deepEqual(calls, []);
  // dieselbe Aufnahme frei erkannt (auch mit leicht anderem Anfang) → eigenes Wort eingesetzt
  const r2 = await a.handleMulti([{ lang: "de", text: "spiel lieder vom es de pe", conf: 0.7 }], "de", { free: r.command });
  assert.equal(r2.say, "Ich spiele „SDP“ auf Amazon Music.");
  assert.deepEqual(calls, ["amazon SDP"]);
});

test("freier Rest bei Suche und Erinnerung; ohne Aufnahme nachfragen; eingetippt direkt", async (t) => {
  t.after(() => {
    for (const x of (globalThis.__cwReminders || new Map()).values()) clearTimeout(x);
    globalThis.__cwReminders?.clear();
  });
  const { a, calls } = setup();
  let r = await a.handleMulti([{ lang: "de", text: "suche nach katzen", conf: 0.9 }]);
  assert.equal(r.needFree, true);
  r = await a.handleMulti([{ lang: "de", text: "suche nach lustigen katzenvideos" }], "de", { free: r.command });
  assert.equal(r.say, "Ich suche „lustigen katzenvideos“ auf Google.");
  r = await a.handleMulti([{ lang: "de", text: "erinnere mich in zehn minuten an pille" }]);
  r = await a.handleMulti([{ lang: "de", text: "erinnere mich in zehn minuten an die wäsche" }], "de", { free: r.command });
  assert.equal(r.say, "Okay, ich erinnere dich in 10 Minuten an: die wäsche.");
  // nach dem Aktivierungswort (keine eigene Aufnahme): der Befehl fragt nach
  calls.splice(0);
  r = await a.handleMulti([{ lang: "de", text: "spiel lieder von der pille", conf: 0.9 }], "de", { noFree: true });
  assert.deepEqual(calls, ["ask", "amazon gefragt"]);
  // eingetippt: der Text stimmt schon
  calls.splice(0);
  r = await a.handleMulti([{ lang: "de", text: "spiel lieder von sdp" }], "de", { confirm: false });
  assert.deepEqual(calls, ["amazon sdp"]);
  r = await a.handleMulti([{ lang: "en", text: "play songs by coldplay" }], "en", { confirm: false });
  assert.equal(r.say, 'Playing "coldplay" on Amazon Music.');
  // feste Befehle bleiben unverändert
  calls.splice(0);
  await a.handleMulti([{ lang: "de", text: "spiel meine playlist auf amazon music", conf: 0.9 }]);
  assert.deepEqual(calls, ["ask", "amazon gefragt"]);
});
