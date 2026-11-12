const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { parseLatest, check, download } = require("../src/core/selfupdate");

const exe = Buffer.from("MZ das ist ein Installer".repeat(1000));
const sha = crypto.createHash("sha512").update(exe).digest("base64");
const yml = (v = "9.9.9", s = sha) => `version: ${v}\nfiles:\n  - url: CommandWave-Setup-${v}.exe\n    sha512: ${s}\n    size: ${exe.length}\npath: CommandWave-Setup-${v}.exe\nsha512: ${s}\nreleaseDate: '2026-11-12T15:40:00.000Z'\n`;
const fetchMock = (text, body = exe) => async (url) => {
  if (url.endsWith("latest.yml")) return { ok: true, status: 200, text: async () => text };
  return { ok: true, status: 200, headers: new Map([["content-length", String(body.length)]]), body: (async function* () { for (let i = 0; i < body.length; i += 4096) yield body.subarray(i, i + 4096); })() };
};

test("latest.yml lesen und Dateinamen prüfen", () => {
  const i = parseLatest(yml());
  assert.equal(i.version, "9.9.9");
  assert.equal(i.path, "CommandWave-Setup-9.9.9.exe");
  assert.equal(i.sha512, sha);
  assert.equal(i.size, exe.length);
  assert.throws(() => parseLatest(yml().replace(/path: .*/, "path: ../../böse.exe")), /ungültiger Dateiname/);
  assert.throws(() => parseLatest("version: 1.0.0\n"), /unvollständig/);
});

test("neue Version erkennen, gleiche/ältere nicht", async () => {
  assert.equal((await check("1.4.0", fetchMock(yml("1.4.1")))).version, "1.4.1");
  assert.equal(await check("1.4.0", fetchMock(yml("1.4.0"))), null);
  assert.equal(await check("1.4.0", fetchMock(yml("1.3.0"))), null);
});

test("Download mit Prüfsumme – falsche Datei wird verworfen", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-su-"));
  const info = parseLatest(yml());
  const seen = [];
  const file = await download(info, dir, { fetchImpl: fetchMock(yml()), onProgress: (p) => seen.push(p) });
  assert.deepEqual(fs.readFileSync(file), exe);
  assert.equal(seen.at(-1), 100);
  const bad = Buffer.from(exe);
  bad[5] ^= 1;
  await assert.rejects(download(info, dir + "2", { fetchImpl: fetchMock(yml(), bad) }), /Prüfsumme/);
  assert.equal(fs.existsSync(path.join(dir + "2", info.path)), false);
});
