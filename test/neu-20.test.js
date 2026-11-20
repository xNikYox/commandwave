// 2.0: Schnittstelle für Mods – {frei} mitten im Satz, Auswahl aus einer Liste, Tasten, Mod-Einstellungen
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const P = require("../src/core/phrases");
const N = require("../src/core/numbers");
const { Assistant } = require("../src/core/assistant");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cw20-"));

test("{frei} mitten im Satz: „spiel {frei} auf spotify“ schlägt „spiel lieder von {frei}“", () => {
  const c = P.compile([{ id: "sp", phrases: ["(spiel|spiele) [lieder|musik] [von] {frei} auf spotify"] }, { id: "am", phrases: ["(spiel|spiele) [mir] [lieder|musik] von {frei}"] }]);
  const m = P.match("spiel lieder von sdp auf spotify", c, {});
  assert.equal(m.command.id, "sp");
  assert.equal(m.slots.frei.key, "sdp");
  assert.equal(P.match("spiele the weeknd auf spotify", c, {}).slots.frei.key, "the weeknd");
  assert.equal(P.match("spiel lieder von sdp", c, {}).command.id, "am");
  assert.ok(P.freeInMiddle(c[0]) && !P.freeInMiddle(c[1]));
});

test("Auswahl: „Nummer drei“, „die zweite“, Ziffern, zu groß", () => {
  assert.equal(N.pick("nummer drei", 5), 3);
  assert.equal(N.pick("die zweite bitte", 5), 2);
  assert.equal(N.pick("4", 5), 4);
  assert.equal(N.pick("eins", 5), 1);
  assert.equal(N.pick("die letzte", 3), 3);
  assert.equal(N.pick("nummer sechs", 5), null);
  assert.equal(N.pick("number two", 5, "en"), 2);
  assert.equal(N.pick("keine ahnung", 5), null);
  assert.equal(N.pick(null, 5), null);
});

test("Mod-Schnittstelle 2.0: choose, keys, settings, showList", async () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "x"));
  fs.writeFileSync(path.join(dir, "x", "mod.json"), JSON.stringify({ id: "x", version: "1.0.0", minApp: "2.0.0", main: "main.js",
    settings: [{ key: "taste", label: "Taste", type: "hotkey", default: "^+m" }, { key: "name", label: "Name", default: "" }] }));
  fs.writeFileSync(path.join(dir, "x", "main.js"), `module.exports = (api) => {
    api.command("wähle etwas", async (ctx) => { const i = await ctx.choose("Welche Nummer?", ["Apfel", "Birne", "Kirsche"]); return i == null ? "nichts" : "gewählt " + i; });
    api.command("drück die taste", async () => { await api.keys(api.settings().taste); return "gedrückt " + api.settings().name; });
    api.command("zeig liste", () => { api.showList("Liste", ["a", 2]); return "ok"; });
  };`);
  const calls = [];
  let answer = "nummer zwei";
  const a = new Assistant({ modsDir: dir, dataDir: dir, appVersion: "2.0.0", actions: { keys: async (x) => calls.push("keys " + x.keys) },
    ask: async (q) => (calls.push("ask " + q), answer), showList: (t, items, o) => calls.push(`list ${t}|${items.join(",")}${o?.choose ? "|wahl" : ""}`), modSettings: (id) => (id === "x" ? { name: "Nik" } : {}) });
  a.reload();
  assert.deepEqual(a.errors, []);
  assert.equal((await a.handle("wähle etwas")).say, "gewählt 1");
  assert.deepEqual(calls.splice(0), ["list Welche Nummer?|Apfel,Birne,Kirsche|wahl", "ask Welche Nummer?", "list |"]);
  answer = "weiß nicht";
  assert.equal((await a.handle("wähle etwas")).say, "nichts");
  calls.splice(0);
  assert.equal((await a.handle("drück die taste")).say, "gedrückt Nik");
  assert.deepEqual(calls.splice(0), ["keys ^+m"]);
  await a.handle("zeig liste");
  assert.deepEqual(calls.splice(0), ["list Liste|a,2"]);
  assert.deepEqual(a.mods[0].settings.map((s) => s.key), ["taste", "name"]);
});

test("mod.json: settings und minApp werden geprüft", () => {
  const { validate } = require("../src/core/mods");
  assert.ok(validate({ id: "a", version: "1.0.0", minApp: "2.0.0", settings: [{ key: "k", label: "K" }] }).mod);
  assert.match(validate({ id: "a", version: "1.0.0", minApp: "zwei" }).error, /minApp/);
  assert.match(validate({ id: "a", version: "1.0.0", settings: [{ key: "a b" }] }).error, /settings/);
});
