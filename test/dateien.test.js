// 2.0: Mod „dateien“ – Dateinamen ordnen (Umlaute, Endung, Hörfehler, neuere zuerst) und Öffnen per Sprache
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const R = require("../mods/dateien/rank");
const S = require("../mods/dateien/search");
const { Assistant } = require("../src/core/assistant");

const F = (name, modified = "2024-01-01T10:00:00Z", folder = "Dokumente") => ({ path: `C:\\Users\\nik\\Documents\\${name}`, name, folder, modified });

test("Ähnlichkeit: Umlaute, Endung, Trennzeichen, Hörfehler", () => {
  assert.ok(R.score("bewerbung mueller", "Bewerbung_Müller_2024.docx") > 0.9);
  assert.ok(R.score("bewerbung muller", "Bewerbung_Müller_2024.docx") > 0.9);
  assert.ok(R.score("rechnung", "Rechnung-Telekom.pdf") >= 0.85);
  assert.ok(R.score("rechnung", "rechnung.pdf") > R.score("rechnung", "Rechnung-Telekom.pdf"));
  assert.ok(R.score("bewerbungs schreiben", "Bewerbungsschreiben.docx") > 0.85);
  assert.ok(R.score("steuererklärung", "Steuererklaerung 2023.pdf") > 0.9);
  assert.ok(R.score("urlaubsfotos", "Urlaubsfoto Italien.jpg") > 0.75); // Hörfehler am Wortende
  assert.ok(R.score("rechnung", "Urlaub.jpg") < R.MIN);
  assert.equal(R.stem("Bericht.final.docx"), "Bericht.final");
});

test("Reihenfolge: bester Name zuerst, bei Gleichstand die neuere Datei", () => {
  const files = [F("Rechnung Strom.pdf", "2023-05-01T00:00:00Z"), F("Rechnung Strom.pdf.bak"), F("Rechnung Strom (2).pdf", "2024-06-01T00:00:00Z"), F("Urlaub.jpg")];
  files[1] = { ...files[1], path: files[1].path + "x" };
  const r = R.rank("rechnung strom", [files[0], files[2], files[3]]);
  assert.equal(r.length, 2);
  assert.equal(r[0].name, "Rechnung Strom (2).pdf"); // gleich gut → neuer gewinnt
  // „punkt pdf“ gibt der passenden Endung den Vorsprung
  const x = R.rank("lebenslauf punkt pdf", [F("Lebenslauf.docx", "2025-01-01T00:00:00Z"), F("Lebenslauf.pdf", "2020-01-01T00:00:00Z")]);
  assert.equal(x[0].name, "Lebenslauf.pdf");
  assert.deepEqual(R.parseQuery("die bewerbung bitte"), { text: "bewerbung", ext: null });
  assert.deepEqual(R.parseQuery("Rechnung.PDF"), { text: "rechnung", ext: "pdf" });
});

test("Entscheidung: klarer Treffer, Auswahl, nichts", () => {
  assert.ok(R.decide(R.rank("bewerbung", [F("Bewerbung.docx"), F("Urlaub.jpg")])).open);
  const amb = R.decide(R.rank("rechnung", [F("Rechnung Strom.pdf"), F("Rechnung Gas.pdf"), F("Rechnung Telekom.pdf")]));
  assert.equal(amb.choose.length, 3);
  assert.ok(R.decide([]).none);
  const many = Array.from({ length: 8 }, (_, i) => F(`Foto ${i}.jpg`));
  assert.equal(R.decide(R.rank("foto", many)).choose.length, 5);
  assert.equal(R.label(F("Bewerbung Müller 2024.docx")), "Bewerbung Müller 2024.docx – Dokumente");
  assert.equal(R.spoken("Bewerbung_Müller_2024.docx"), "Bewerbung Müller 2024");
});

test("Index-Skript: Wortanfänge mit Umlaut-Varianten, Benutzerordner OneDrive-tauglich", () => {
  assert.deepEqual(S.likeTerms("bewerbung mueller"), ["bewe", "muel", "mül"]);
  assert.deepEqual(S.likeTerms("o'brien % ab"), ["brie"]); // keine Anführungszeichen/Platzhalter, kurze Wörter weg
  const ps = S.indexScript("rechnung telekom");
  assert.match(ps, /Search\.CollatorDSO/);
  assert.match(ps, /374DE290-123F-4565-9164-39C4925E467B/);
  assert.match(ps, /GetFolderPath\('MyDocuments'\)/);
  assert.match(ps, /'rech', 'tele'/);
});

test("Ordner selbst durchsuchen: Tiefe, versteckte und System-Ordner", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cw-dat-"));
  const mk = (rel) => (fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }), fs.writeFileSync(path.join(root, rel), "x"));
  mk("Bewerbung Müller 2024.docx");
  mk("Arbeit/2024/Rechnung Telekom.pdf");
  mk(".versteckt/Bewerbung alt.docx");
  mk("node_modules/x/Bewerbung.js");
  mk("a/b/c/d/e/f/g/h/Bewerbung tief.docx");
  const names = S.walk([{ label: "Test", path: root }]).map((f) => f.name).sort();
  assert.deepEqual(names, ["Bewerbung Müller 2024.docx", "Rechnung Telekom.pdf"]);
  assert.ok(S.walk([{ label: "Test", path: root }], { max: 1 }).length <= 1);
  assert.equal(S.withDates(S.walk([{ label: "Test", path: root }]))[0].modified.length > 10, true);
});

function setup(files, answer = "nummer zwei") {
  const calls = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-dat-mod-"));
  const actions = {
    powershellJson: async () => ({ ok: true, index: true, roots: [{ label: "Dokumente", path: dir }], files }),
    open: async (a) => calls.push("open " + a.target),
  };
  const a = new Assistant({ modsDir: path.join(__dirname, "..", "mods"), dataDir: dir, appVersion: "2.0.0", actions,
    ask: async (q) => (calls.push("ask " + q), answer), showList: (t, items) => items.length && calls.push("list " + items.join(" | ")) });
  a.reload();
  return { a, calls };
}

test("Mod: klarer Treffer wird gleich geöffnet", async () => {
  const { a, calls } = setup([F("Bewerbung_Müller_2024.docx"), F("Urlaub.jpg")]);
  const r = await a.handle("öffne die datei bewerbung müller");
  assert.equal(r.say, "Bewerbung Müller 2024 wird geöffnet");
  assert.deepEqual(calls, ["open C:\\Users\\nik\\Documents\\Bewerbung_Müller_2024.docx"]);
});

test("Mod: mehrere ähnliche → Liste, „Nummer zwei“ öffnet die zweite", async () => {
  const { a, calls } = setup([F("Rechnung Strom.pdf", "2024-03-01T00:00:00Z"), F("Rechnung Gas.pdf", "2024-02-01T00:00:00Z"), F("Rechnung Telekom.pdf", "2024-01-01T00:00:00Z")]);
  const r = await a.handle("suche die datei rechnung");
  assert.equal(r.say, "Rechnung Gas wird geöffnet");
  assert.deepEqual(calls, ["list Rechnung Strom.pdf – Dokumente | Rechnung Gas.pdf – Dokumente | Rechnung Telekom.pdf – Dokumente", "ask Welche Datei meinst du? Sag die Nummer.", "open C:\\Users\\nik\\Documents\\Rechnung Gas.pdf"]);
  const b = setup([F("Rechnung Strom.pdf"), F("Rechnung Gas.pdf")], "keine ahnung");
  assert.equal((await b.a.handle("suche die datei rechnung")).say, "Okay, dann nicht.");
});

test("Mod: nichts gefunden (auch nicht beim Durchsuchen der Ordner)", async () => {
  const { a, calls } = setup([]);
  assert.equal((await a.handle("öffne die datei zauberformel")).say, "Ich habe keine Datei „zauberformel“ gefunden.");
  assert.deepEqual(calls, []);
  assert.equal((await a.handle("open the file magic spell", "en")).say, 'I couldn\'t find a file called "magic spell".');
});
