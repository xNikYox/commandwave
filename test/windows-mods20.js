// Praxistest auf echtem Windows (GitHub Actions) für die Mods aus 2.0: Discord-Tasten, OBS (nachgebauter Server), Spotify.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createActions } = require("../src/core/actions");
const { Assistant } = require("../src/core/assistant");
const { startFakeObs } = require("./fake-obs");

(async () => {
  const srv = await startFakeObs({ password: "geheim", scenes: ["Start", "Gaming"] });
  const opened = [];
  const actions = createActions({ openExternal: async (u) => opened.push(u), openPath: async (p) => (opened.push(p), ""), diagDir: os.tmpdir() });
  const settings = { obs: { url: srv.url, password: "geheim" }, discord: { mute: "^+{F13}", deafen: "^+{F14}" } }; // F13/F14: stört im Test kein Programm
  const a = new Assistant({ modsDir: path.join(__dirname, "..", "mods"), actions, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "cw-m20-")), appVersion: "2.0.0", modSettings: (id) => settings[id] || {} });
  a.reload();
  assert.deepEqual(a.errors, []);

  // Discord: SendKeys-Skript läuft durch (ob Discord reagiert, prüft man nur mit echtem Discord)
  let r = await a.handle("mikro stumm");
  assert.equal(r.ok, true, "Discord-Taste: " + r.error);
  assert.equal(r.say, "Okay, Discord-Mikro umgeschaltet.");
  r = await a.handle("taub schalten");
  assert.equal(r.ok, true, "Discord-Taste: " + r.error);
  console.log("Discord-Tasten (SendKeys): ok");

  // OBS: über den echten Windows-Netzwerkstapel gegen den nachgebauten obs-websocket-5-Server
  assert.equal((await a.handle("aufnahme starten")).say, "Aufnahme läuft.");
  assert.equal((await a.handle("szene gaming")).say, "Szene Gaming.");
  assert.equal((await a.handle("aufnahme stoppen")).say, "Aufnahme gestoppt.");
  assert.equal(srv.state.scene, "Gaming");
  await srv.close();
  assert.match((await a.handle("stream starten")).say, /^OBS ist nicht erreichbar/);
  console.log("OBS (WebSocket 5, Passwort, Szene, OBS aus): ok");

  // Spotify: auf dem Testrechner nicht installiert → Skript läuft durch, Ersatz über den Browser
  const p = await actions.playInApp({ like: "Spotify*", uri: "" });
  console.log("playInApp ohne Spotify:", JSON.stringify(p));
  assert.equal(p.ok, false);
  assert.ok(p.step === "app" || p.step === "abspielen", JSON.stringify(p));
  console.log("Spotify-Steuerung ohne Spotify: kein Absturz – ok");
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
