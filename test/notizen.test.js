// 2.0: Notizen – merken, vorlesen (die letzten fünf, alle in der Liste), einzeln und alle löschen (mit Rückfrage)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const N = require("../mods/notizen/notes");
const { Assistant } = require("../src/core/assistant");

function setup(answers = []) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-notiz-"));
  const calls = [];
  const a = new Assistant({ modsDir: path.join(__dirname, "..", "mods"), actions: {}, dataDir, appVersion: "2.0.0",
    ask: async (q) => (calls.push("frage " + q), answers.shift() ?? null), showList: (t, items) => calls.push(`liste ${t}: ${items.join(" | ")}`) });
  a.reload();
  return { a, calls, dataDir };
}

test("Notizen-Logik: Text aufräumen, Nummern, die letzten fünf", () => {
  assert.equal(N.cleanText("  dass ich milch kaufen muss "), "Ich milch kaufen muss");
  let list = [];
  for (const t of ["eins", "zwei", "drei", "vier", "fünf", "sechs"]) list = N.add(list, t, 1000).list;
  assert.equal(list.length, 6);
  assert.deepEqual(N.last(list, 5).map((x) => x.n), [2, 3, 4, 5, 6]);
  assert.match(N.readOut(list), /^Du hast 6 Notizen, hier die letzten fünf\. Nummer 2: Zwei\. .*Nummer 6: Sechs\.$/);
  assert.equal(N.readOut(list.slice(0, 1)), "Du hast eine Notiz. Nummer 1: Eins.");
  const r = N.remove(list, 2);
  assert.equal(r.removed.text, "Zwei");
  assert.deepEqual(N.lines(r.list).slice(0, 2), ["1. Eins", "2. Drei"]);
  assert.equal(N.remove(list, 9).removed, null);
  assert.equal(N.add(list, "   ").note, null);
});

test("Notizen per Sprache: merken, vorlesen, löschen, alle löschen mit Rückfrage", async () => {
  const { a, calls, dataDir } = setup(["Zahnarzt am Dienstag", "nein", "ja"]);
  assert.equal((await a.handle("merke dir milch kaufen")).say, "Ich habe mir gemerkt: Milch kaufen");
  assert.equal((await a.handle("notiere was")).say, "Ich habe mir gemerkt: Zahnarzt am dienstag");
  assert.deepEqual(calls.splice(0), ["frage Was soll ich mir merken?"]);
  assert.equal((await a.handle("was habe ich mir gemerkt")).say, "Du hast 2 Notizen. Nummer 1: Milch kaufen. Nummer 2: Zahnarzt am dienstag.");
  assert.deepEqual(calls.splice(0), ["liste Deine Notizen: 1. Milch kaufen | 2. Zahnarzt am dienstag"]);
  // gespeichert im Datenordner
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, "mod-data", "notizen.json"), "utf8")).notes.length, 2);
  assert.equal((await a.handle("lösche notiz nummer drei")).say, "Notiz Nummer 3 gibt es nicht.");
  assert.equal((await a.handle("lösche notiz nummer eins")).say, "Notiz Nummer 1 gelöscht: Milch kaufen");
  assert.equal((await a.handle("lösche alle notizen")).say, "Okay, die Notizen bleiben.");
  assert.equal((await a.handle("lösche alle notizen")).say, "Eine Notiz gelöscht.");
  assert.deepEqual(calls.splice(0), ["frage Soll ich wirklich die Notiz löschen?", "frage Soll ich wirklich die Notiz löschen?"]);
  assert.equal((await a.handle("was habe ich mir gemerkt")).say, "Du hast keine Notizen.");
  assert.equal((await a.handle("remember buy milk", "en")).say, "Got it, I'll remember: Buy milk");
});

test("Notizen: Sätze landen bei der richtigen Mod", () => {
  const { a } = setup();
  for (const [t, mod] of [["merke dir milch kaufen", "notizen"], ["notiere zahnarzt", "notizen"], ["schreib was", "diktieren"], ["lösche alle notizen", "notizen"], ["lösche alle erinnerungen", "erinnerungen"]]) {
    assert.equal(a.matchOnly(t)?.command.split("#")[0], mod, t);
  }
});
