const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const U = require("../src/core/updater");
const { Assistant } = require("../src/core/assistant");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cw-up-"));
function mod(root, id, version, extra = {}, files = {}) {
  fs.mkdirSync(path.join(root, id), { recursive: true });
  fs.writeFileSync(path.join(root, id, "mod.json"), JSON.stringify({ id, version, name: id, ...extra }));
  for (const [f, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, id, f)), { recursive: true });
    fs.writeFileSync(path.join(root, id, f), c);
  }
}

test("index.json erzeugen: Mods mit Version und SHA-256 je Datei", () => {
  const src = tmp();
  mod(src, "gruss", "1.2.0", { main: "main.js" }, { "main.js": "module.exports=()=>{}", "daten/liste.txt": "a" });
  mod(src, "kaputt", "nix");
  const idx = U.buildIndex(src);
  assert.deepEqual(idx.mods.map((m) => [m.id, m.version, m.script]), [["gruss", "1.2.0", true]]);
  assert.deepEqual(idx.mods[0].files.map((f) => f.path), ["daten/liste.txt", "main.js", "mod.json"]);
  assert.equal(idx.mods[0].files[1].sha256, U.sha256(Buffer.from("module.exports=()=>{}")));
});

test("Ordner-Quelle: neue Version finden, installieren, alte sichern, neu laden", async () => {
  const src = tmp();
  const mods = tmp();
  mod(mods, "gruss", "1.0.0", { commands: [{ phrases: ["guten morgen"], say: "alt" }] });
  mod(src, "gruss", "1.1.0", { commands: [{ phrases: ["guten morgen"], say: "neu" }] });
  mod(src, "neu", "1.0.0", { commands: [{ phrases: ["hallo welt"], say: "Hallo!" }] });
  const sources = [{ type: "folder", path: src }];
  const r = await U.check(sources, [{ id: "gruss", version: "1.0.0" }]);
  assert.deepEqual(r.updates.map((u) => [u.id, u.from, u.to, u.isNew]), [["gruss", "1.0.0", "1.1.0", false], ["neu", null, "1.0.0", true]]);
  for (const u of r.updates) await U.install(u, mods);
  const a = new Assistant({ modsDir: mods, actions: {}, dataDir: mods });
  a.reload();
  assert.equal((await a.handle("guten morgen")).say, "neu");
  assert.equal((await a.handle("hallo welt")).say, "Hallo!");
  const backups = fs.readdirSync(path.join(mods, ".backup"));
  assert.equal(backups.length, 1);
  assert.match(backups[0], /^gruss-1\.0\.0-\d+$/);
  assert.deepEqual((await U.check(sources, a.mods)).updates, []); // jetzt aktuell
  assert.ok(!fs.readdirSync(mods).some((n) => n.startsWith(".tmp-")));
});

test("GitHub-Quelle über raw.githubusercontent.com (mit Attrappe)", async () => {
  const repo = tmp();
  mod(repo, "wetter", "2.0.0", { main: "main.js" }, { "main.js": "module.exports=(api)=>api.command('wetter',()=>'Sonnig')" });
  fs.writeFileSync(path.join(repo, "index.json"), JSON.stringify(U.buildIndex(repo)));
  const urls = [];
  const fakeFetch = async (url) => {
    urls.push(url);
    const rel = url.replace("https://raw.githubusercontent.com/name/cw-mods/main/", "");
    const file = path.join(repo, ...rel.split("/").map(decodeURIComponent));
    if (!fs.existsSync(file)) return { ok: false, status: 404 };
    const b = fs.readFileSync(file);
    return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) };
  };
  const src = [{ type: "github", repo: "name/cw-mods", branch: "main" }];
  const r = await U.check(src, [], fakeFetch);
  assert.equal(r.updates[0].id, "wetter");
  assert.equal(r.updates[0].sourceLabel, "GitHub name/cw-mods");
  const mods = tmp();
  await U.install(r.updates[0], mods, fakeFetch);
  assert.ok(urls.includes("https://raw.githubusercontent.com/name/cw-mods/main/index.json"));
  assert.ok(urls.includes("https://raw.githubusercontent.com/name/cw-mods/main/wetter/main.js"));
  const a = new Assistant({ modsDir: mods, actions: {}, dataDir: mods });
  a.reload();
  assert.equal((await a.handle("wetter")).say, "Sonnig");
});

test("manipulierte Datei (Prüfsumme falsch) → nicht installiert, alte Version bleibt", async () => {
  const src = tmp();
  const mods = tmp();
  mod(mods, "gruss", "1.0.0", { commands: [{ phrases: ["guten morgen"], say: "alt" }] });
  mod(src, "gruss", "1.1.0", { commands: [{ phrases: ["guten morgen"], say: "neu" }] });
  fs.writeFileSync(path.join(src, "index.json"), JSON.stringify(U.buildIndex(src)));
  fs.writeFileSync(path.join(src, "gruss", "mod.json"), JSON.stringify({ id: "gruss", version: "1.1.0", commands: [{ phrases: ["guten morgen"], action: { type: "shell", command: "böse" } }] }));
  const r = await U.check([{ type: "folder", path: src }], [{ id: "gruss", version: "1.0.0" }]);
  await assert.rejects(U.install(r.updates[0], mods), /Prüfsumme stimmt nicht: mod\.json/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(mods, "gruss", "mod.json"), "utf8")).version, "1.0.0");
  assert.ok(!fs.readdirSync(mods).some((n) => n.startsWith(".tmp-")));
});

test("unsichere Pfade und falsche Angaben werden abgelehnt", async () => {
  assert.equal(U.safeRel("../../windows/system32/x.dll"), false);
  assert.equal(U.safeRel("C:/x"), false);
  assert.equal(U.safeRel("/etc/passwd"), false);
  assert.equal(U.safeRel("ordner/datei.js"), true);
  const mods = tmp();
  const src = { type: "folder", path: tmp() };
  const bad = { id: "x", version: "1.0.0", path: "x", files: [{ path: "mod.json", sha256: "a".repeat(64) }, { path: "../böse.js", sha256: "b".repeat(64) }] };
  await assert.rejects(U.install({ entry: bad, source: src }, mods), /Ungültiger Dateieintrag|ENOENT/);
  assert.throws(() => U.openSource({ type: "github", repo: "kein repo" }), /name\/repository/);
  assert.throws(() => U.openSource({ type: "url", url: "ftp://x" }), /http/);
  const r = await U.check([{ type: "folder", path: "/gibt/es/nicht" }], []);
  assert.equal(r.errors.length, 1);
});

test("mehrere Quellen: höchste Version gewinnt; nur 3 Sicherungen je Mod", async () => {
  const a1 = tmp();
  const a2 = tmp();
  mod(a1, "gruss", "1.1.0");
  mod(a2, "gruss", "1.3.0");
  const r = await U.check([{ type: "folder", path: a1 }, { type: "folder", path: a2 }], [{ id: "gruss", version: "1.0.0" }]);
  assert.equal(r.updates[0].to, "1.3.0");
  const mods = tmp();
  for (let v = 0; v < 6; v++) {
    const s = tmp();
    mod(s, "gruss", `2.${v}.0`);
    const c = await U.check([{ type: "folder", path: s }], fs.existsSync(path.join(mods, "gruss")) ? [{ id: "gruss", version: `2.${v - 1}.0` }] : []);
    await U.install(c.updates[0], mods);
  }
  assert.equal(fs.readdirSync(path.join(mods, ".backup")).length, 3);
});
