// 1.4: „Meintest du …?“, Rückfragen (Suche), gelernte Aussprache, Fenster
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const { Assistant } = require("../src/core/assistant");
const P = require("../src/core/phrases");
const { windowScript } = require("../src/core/winscripts");
const { createActions } = require("../src/core/actions");

function setup(extra = {}) {
  const calls = [];
  const actions = {
    run: async (a) => calls.push("run " + a.target),
    open: async (a) => calls.push("open " + a.target),
    window: async (a) => (calls.push(`window ${a.op}${a.match ? " " + a.match : ""}`), { ok: a.match !== "gibtsnicht" }),
  };
  const a = new Assistant({ modsDir: path.join(__dirname, "..", "mods"), actions, dataDir: os.tmpdir(), ...extra });
  a.reload();
  return { a, calls };
}

test("knapp daneben → „Meintest du …?“; ja führt aus, nein nicht", async () => {
  const { a } = setup();
  const q = await a.handleMulti([{ lang: "de", text: "welcher tag ist", conf: 0.9 }]);
  assert.equal(q.confirm, true);
  assert.equal(q.say, "Meintest du „welcher tag ist heute“?");
  const yes = await a.answerConfirm("ja");
  assert.equal(yes.ok, true);
  assert.match(yes.say, /^Heute ist /);
  // ein zweites „ja“ ohne neue Frage tut nichts
  assert.equal((await a.answerConfirm("ja")).ok, false);
  await a.handleMulti([{ lang: "de", text: "welcher tag ist", conf: 0.9 }]);
  assert.equal((await a.answerConfirm("nein")).say, "Okay, dann nicht.");
  // unsichere Erkennung: auch bei gutem Treffer erst nachfragen
  const u = await a.handleMulti([{ lang: "de", text: "öffne die app editor", conf: 0.3 }], "de", { unsure: true });
  assert.equal(u.confirm, true);
  assert.equal(u.say, "Meintest du „öffne die app editor“?");
  // eingetippt: nie nachfragen
  assert.equal((await a.handleMulti([{ lang: "de", text: "welcher tag ist", conf: null }], "de", { confirm: false })).confirm, undefined);
  const en = await a.handleMulti([{ lang: "en", text: "day is it", conf: 0.9 }], "en");
  assert.match(en.say, /^Did you mean "what day is it"/);
  assert.equal((await a.answerConfirm("no")).say, "Okay, never mind.");
});

test("Ja/Nein erkennen", () => {
  assert.equal(P.yesNo("ja bitte"), true);
  assert.equal(P.yesNo("genau"), true);
  assert.equal(P.yesNo("yes please"), true);
  assert.equal(P.yesNo("nein danke"), false);
  assert.equal(P.yesNo("no"), false);
  assert.equal(P.yesNo("vielleicht"), null);
  const { a } = setup();
  assert.ok(a.grammars.de.includes("ja") && a.grammars.de.includes("nein"));
  assert.ok(a.grammars.en.includes("yes") && !a.grammars.en.includes("ja"));
});

test("Suche: Rückfrage nach dem Begriff, dann Ergebnisse öffnen", async () => {
  const asked = [];
  const { a, calls } = setup({ ask: async (q, lang) => (asked.push(q), lang === "en" ? "funny cats" : "lustige katzen") });
  assert.equal((await a.handle("suche auf youtube")).say, "Ich suche „lustige katzen“ auf YouTube.");
  assert.equal((await a.handle("search on wikipedia", "en")).say, 'Searching Wikipedia for "funny cats".');
  assert.equal((await a.handle("suche etwas")).say, "Ich suche „lustige katzen“ auf Google.");
  assert.deepEqual(asked, ["Was soll ich auf YouTube suchen?", "What should I search for on Wikipedia?", "Was soll ich suchen?"]);
  assert.deepEqual(calls, ["open https://www.youtube.com/results?search_query=lustige%20katzen", "open https://en.wikipedia.org/w/index.php?search=funny%20cats", "open https://www.google.com/search?q=lustige%20katzen"]);
  const none = setup({ ask: async () => null });
  assert.equal((await none.a.handle("suche auf amazon")).say, "Okay, keine Suche.");
  assert.deepEqual(none.calls, []);
});

test("gelernte Aussprache: weiterer Name für einen Wert, nur in seiner Sprache", async () => {
  const { a, calls } = setup();
  a.setAliases({ app: { "note pad": { key: "editor", lang: "de" } }, seite: { "you tube": { key: "youtube", lang: "en" } } });
  assert.equal((await a.handle("öffne note pad")).say, "Editor wird gestartet");
  assert.deepEqual(calls.splice(0), ["run notepad.exe"]);
  assert.ok(a.grammars.de.join(" ").includes("note pad"));
  assert.ok(!a.grammars.de.join(" ").includes("you tube"));
  assert.ok(a.grammars.en.join(" ").includes("you tube"));
  // unbekannter Wert oder schon vorhandener Name: ignorieren
  a.setAliases({ app: { editor: { key: "rechner" }, quatsch: { key: "gibtsnicht" } } });
  assert.equal(a.slots.app.editor.target, "notepad.exe");
  assert.equal(a.slots.app.quatsch, undefined);
});

test("Fenster: Befehle und Wechsel zu einer App", async () => {
  const { a, calls } = setup();
  for (const t of ["minimiere das fenster", "maximiere das fenster", "fenster nach links", "schiebe das fenster nach rechts", "zeige den desktop", "fenster wiederherstellen"]) assert.equal((await a.handle(t)).ok, true, t);
  for (const t of ["minimize the window", "snap the window left", "show the desktop"]) assert.equal((await a.handle(t, "en")).ok, true, t);
  assert.deepEqual(calls.splice(0), ["window minimize", "window maximize", "window left", "window right", "window desktop", "window restore", "window minimize", "window left", "window desktop"]);
  assert.equal((await a.handle("wechsle zu editor")).say, "Wechsle zu Editor.");
  assert.equal((await a.handle("switch to calculator", "en")).say, "Switching to Calculator.");
  assert.deepEqual(calls.splice(0), ["window focus notepad|editor", "window focus calculatorapp|calc|rechner|calculator"]);
});

test("Fenster-Skript: CommandWave selbst wird übersprungen, Namen sicher eingesetzt", async () => {
  const s = windowScript("focus", "o'brien|notepad", 4242);
  assert.match(s, /\$skip = 4242/);
  assert.match(s, /'o''brien\|notepad'/);
  let got = null;
  const actions = createActions({ powershellJson: async (script) => ((got = script), { ok: true }), skipPid: 77 });
  assert.deepEqual(await actions.window({ op: "minimize" }), { ok: true });
  assert.match(got, /\$skip = 77/);
  assert.match(got, /\$op = 'minimize'/);
});

test("Vorschau (Mikrofon-Test) führt nichts aus", () => {
  const { a, calls } = setup();
  const p = a.preview([{ lang: "de", text: "öffne die app editor", conf: 0.8 }]);
  assert.equal(p.command, "apps#0");
  assert.equal(p.sure, true);
  assert.equal(p.mod, "Apps starten und schließen");
  assert.deepEqual(calls, []);
  assert.equal(a.preview([]).command, null);
});
