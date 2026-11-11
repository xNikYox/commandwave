const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../src/core/phrases");

const cmds = P.compile([
  { id: "open", phrases: ["öffne [die app] {app}", "starte [die app] {app}", "(mach|mache) {app} auf"] },
  { id: "time", phrases: ["wie spät ist es", "wie viel uhr ist es"] },
  { id: "loud", phrases: ["[mach] lauter"] },
]);
const slots = { app: { editor: "notepad.exe", rechner: "calc.exe", "task manager": "taskmgr.exe", paint: "mspaint.exe" } };
const m = (t) => P.match(t, cmds, slots);

test("Muster zerlegen und ausschreiben", () => {
  const v = P.expand(P.parse("öffne [die app] {app}")).map((x) => x.map((p) => (p.t === "slot" ? "{" + p.v + "}" : p.v)).join(" "));
  assert.deepEqual(v.sort(), ["öffne die app {app}", "öffne {app}"]);
  assert.equal(P.expand(P.parse("(a|b) [c] (d|e)")).length, 8);
});

test("Beispiel aus der Aufgabe: „Öffne die App Editor“", () => {
  const r = m("Öffne die App Editor");
  assert.equal(r.command.id, "open");
  assert.equal(r.slots.app.key, "editor");
  assert.equal(r.slots.app.value, "notepad.exe");
  assert.equal(r.score, 1);
});

test("verzeiht Füllwörter, Artikel und kleine Hörfehler", () => {
  assert.equal(m("bitte starte den rechner").slots.app.key, "rechner");
  assert.equal(m("öffne die ap editer").slots.app.key, "editor");
  assert.equal(m("mach paint auf").command.id, "open");
  assert.equal(m("öffne task manager").slots.app.key, "task manager");
  assert.equal(m("wie spät ist es bitte").command.id, "time");
  assert.equal(m("lauter").command.id, "loud");
});

test("Unbekanntes wird nicht geraten", () => {
  for (const t of ["erzähl einen witz", "öffne den kühlschrank", "öffne die app", "[unk]", "", "wie"]) assert.equal(m(t), null, t);
});

test("Grammatik für die Erkennung enthält alle Sätze mit eingesetzten Werten", () => {
  const g = P.grammar(cmds, slots);
  assert.ok(g.includes("öffne die app editor"));
  assert.ok(g.includes("mache task manager auf"));
  assert.ok(g.includes("wie viel uhr ist es"));
  assert.equal(g.at(-1), "[unk]");
  assert.ok(!g.some((x) => /[{}[\]()|]/.test(x.replace("[unk]", ""))));
});

test("Antworten mit Platzhaltern füllen", () => {
  const s = { app: { key: "editor", value: { target: "notepad.exe", process: "notepad.exe", label: "Editor" }, heard: "editer" } };
  assert.equal(P.fill("{app} wird gestartet", s), "Editor wird gestartet");
  assert.equal(P.fill("{app.value}|{app.process}|{app.key}|{app.heard}", s), "notepad.exe|notepad.exe|editor|editer");
  assert.equal(P.fill("{app}", { app: { key: "rechner", value: "calc.exe" } }), "Rechner");
  assert.equal(P.fill("{gibts} {app.nicht}", s), "{gibts} {app.nicht}");
});

test("Wortschatz für die Erkennung: jedes Wort einmal, viel kleiner als alle Sätze", () => {
  const v = P.vocabulary(cmds, slots);
  assert.equal(new Set(v).size, v.length);
  for (const w of ["öffne", "die", "app", "editor", "task", "manager", "wie", "spät", "lauter", "bitte"]) assert.ok(v.includes(w), w);
  assert.equal(v.at(-1), "[unk]");
  const all = P.grammar(cmds, slots).reduce((n, x) => n + x.split(" ").length, 0);
  assert.ok(v.length * 4 < all, `${v.length} Wörter statt ${all} Einträgen`);
});
