// Praxistest auf Windows (GitHub Actions): Mod „dateien“ – eigener Testordner, Suche ohne Index (Ordner durchsuchen),
// Ranking und Öffnen; dazu: die echte Abfrage des Windows-Suchindex muss laufen (auf dem Testrechner evtl. leer).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createActions } = require("../src/core/actions");
const { Assistant } = require("../src/core/assistant");
const { indexScript, walk } = require("../mods/dateien/search");
const { rank, decide } = require("../mods/dateien/rank");

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cw-dateien-"));
  for (const rel of ["Bewerbung Müller 2024.docx", "Rechnung.pdf", "Rechnung Telekom.pdf", "Arbeit/Steuererklärung 2023.pdf", "Urlaub/Strand.jpg"]) {
    fs.mkdirSync(path.dirname(path.join(root, ...rel.split("/"))), { recursive: true });
    fs.writeFileSync(path.join(root, ...rel.split("/")), "test");
  }
  const files = walk([{ label: "Test", path: root }]);
  assert.equal(files.length, 5, JSON.stringify(files));
  assert.equal(decide(rank("bewerbung mueller", files)).open?.name, "Bewerbung Müller 2024.docx");
  assert.equal(decide(rank("steuer erklärung", files)).open?.name, "Steuererklärung 2023.pdf");
  assert.ok(decide(rank("rechnung", files)).choose, "„rechnung“ sollte nachfragen");
  console.log("Ordner durchsuchen + Ranking: ok");

  // echte Windows-Abfrage (Benutzerordner + SYSTEMINDEX): darf nicht abstürzen, liefert die Ordner
  const actions = createActions({ openExternal: async () => {}, openPath: async () => "" });
  if (process.platform === "win32") {
    const ix = await actions.powershellJson({ script: indexScript("bewerbung") });
    console.log("Suchindex:", JSON.stringify({ ok: ix.ok, error: ix.error, roots: ix.roots, files: (ix.files || []).length }));
    assert.equal(typeof ix.ok, "boolean");
    assert.ok([].concat(ix.roots || []).some((r) => /Documents|Dokumente/i.test(r.path)), "Dokumente-Ordner nicht gefunden");
  } else console.log("kein Windows – Suchindex nicht geprüft");

  // ganzer Ablauf über den Assistenten: Index liefert nichts → Testordner wird durchsucht → Datei geöffnet
  const opened = [];
  const fake = { ...actions, powershellJson: async () => ({ ok: true, index: true, roots: [{ label: "Test", path: root }], files: [] }), open: async (a) => opened.push(a.target) };
  const a = new Assistant({ modsDir: path.join(__dirname, "..", "mods"), dataDir: root, appVersion: "2.0.0", actions: fake, ask: async () => "nummer zwei", showList: () => {} });
  a.reload();
  let r = await a.handle("öffne die datei bewerbung müller");
  assert.equal(r.say, "Bewerbung Müller 2024 wird geöffnet", JSON.stringify(r));
  assert.equal(opened.at(-1), path.join(root, "Bewerbung Müller 2024.docx"));
  r = await a.handle("suche die datei rechnung");
  assert.match(r.say, /^Rechnung( Telekom)? wird geöffnet$/, JSON.stringify(r));
  console.log("„Öffne die Datei Bewerbung Müller“ / „Suche die Datei Rechnung“ → Nummer zwei: ok");
  fs.rmSync(root, { recursive: true, force: true });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
