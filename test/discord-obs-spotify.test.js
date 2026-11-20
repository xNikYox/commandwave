// 2.0: Discord (Tastenkürzel), OBS (obs-websocket 5), Spotify (Suche + Abspielen)
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Assistant } = require("../src/core/assistant");
const obs = require("../mods/obs/obs");
const { startFakeObs } = require("./fake-obs");

function setup({ settings = {}, actions = {} } = {}) {
  const calls = [];
  const a = new Assistant({
    modsDir: path.join(__dirname, "..", "mods"), dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "cw-dos-")), appVersion: "2.0.0",
    actions: {
      keys: async (x) => calls.push("keys " + x.keys),
      window: async (x) => (calls.push(`window ${x.op} ${x.match}`), { ok: true }),
      open: async (x) => calls.push("open " + x.target),
      playInApp: async (x) => (calls.push(`play ${x.like} ${x.uri}`), { ok: true }),
      mediaSession: async (x) => (calls.push(`media ${x.command} ${x.app}`), { ok: false, error: "keine Wiedergabe" }),
      appVolume: async (x) => (calls.push(`vol ${x.op} ${x.match}`), { ok: true }),
      media: async (x) => calls.push("taste " + x.key),
      ...actions,
    },
    ask: async () => null,
    modSettings: (id) => settings[id] || {},
  });
  a.reload();
  return { a, calls };
}

test("Discord: Sätze lösen die eingestellten Tasten aus, ohne Lautstärke-Befehle zu stören", async () => {
  const { a, calls } = setup({ settings: { discord: { deafen: "^%d" } } });
  assert.deepEqual(a.errors, []);
  for (const t of ["mikro stumm", "mikrofon stumm schalten", "stumm schalten in disk kord", "stumm schaltung aufheben", "mikrofon wieder an"]) {
    const r = await a.handle(t);
    assert.equal(r.mod, "discord", t);
    assert.equal(r.say, "Okay, Discord-Mikro umgeschaltet.");
    assert.equal(calls.pop(), "keys ^+m", t);
  }
  for (const t of ["taub schalten", "taub aufheben", "taub schaltung aufheben"]) {
    const r = await a.handle(t);
    assert.equal(r.say, "Okay, Discord-Ton umgeschaltet.", t);
    assert.equal(calls.pop(), "keys ^%d", t); // eigene Taste aus den Einstellungen
  }
  assert.equal((await a.handle("mute my mic in discord", "en")).mod, "discord");
  assert.equal((await a.handle("mute discord", "en")).mod, "lautstaerke"); // Discord-Ton stumm (Lautstärke je App)
  assert.equal((await a.handle("un deafen discord", "en")).mod, "discord");
  // bestehende Befehle bleiben, wo sie waren
  assert.equal((await a.handle("stumm schalten")).mod, "medien");
  assert.equal((await a.handle("ton aus")).mod, "medien");
  assert.equal((await a.handle("disk kord stumm")).mod, "lautstaerke");
  assert.equal((await a.handle("disk kord stumm schalten")).mod, "lautstaerke");
  // keine Taste eingestellt
  const b = setup({ settings: { discord: { mute: "" } } });
  assert.match((await b.a.handle("mikro stumm")).say, /keine Taste/);
  assert.deepEqual(b.calls, []);
});

test("OBS: Anmeldung (SHA-256) wie in obs-websocket 5", () => {
  const b64 = (s) => crypto.createHash("sha256").update(s).digest("base64");
  const secret = b64("geheim" + "c2FsdA==");
  assert.equal(obs.authFor("geheim", "c2FsdA==", "Y2hhbGxlbmdl"), b64(secret + "Y2hhbGxlbmdl"));
  // bekannter Wert (unabhängig berechnet)
  assert.equal(obs.authFor("supersecretpassword", "lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=", "+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY="),
    b64(b64("supersecretpassword" + "lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=") + "+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY="));
});

test("OBS: Szenennamen verzeihend finden", () => {
  const scenes = ["Gaming", "Just Chatting", "Pause-Bildschirm", "Kamera 2", "Übergang"];
  assert.equal(obs.matchScene("gaming", scenes), "Gaming");
  assert.equal(obs.matchScene("just chatting", scenes), "Just Chatting");
  assert.equal(obs.matchScene("justchatting", scenes), "Just Chatting");
  assert.equal(obs.matchScene("pause bildschirm", scenes), "Pause-Bildschirm");
  assert.equal(obs.matchScene("kamera zwei", scenes), "Kamera 2");
  assert.equal(obs.matchScene("uebergang", scenes), "Übergang");
  assert.equal(obs.matchScene("gamming", scenes), "Gaming");
  assert.equal(obs.matchScene("kamera", scenes), "Kamera 2");
  assert.equal(obs.matchScene("desktop", scenes), null);
  assert.equal(obs.matchScene("", scenes), null);
});

test("OBS: Aufnahme, Stream, Szene gegen einen nachgebauten OBS-Server; falsches Passwort; OBS aus", async (t) => {
  const srv = await startFakeObs({ password: "geheim", scenes: ["Start", "Gaming", "Kamera 2"] });
  t.after(() => srv.close());
  const { a } = setup({ settings: { obs: { url: srv.url, password: "geheim" } } });
  assert.equal((await a.handle("aufnahme starten")).say, "Aufnahme läuft.");
  assert.equal((await a.handle("aufnahme starten")).say, "Die Aufnahme läuft schon.");
  assert.equal((await a.handle("aufnahme pausieren")).say, "Aufnahme pausiert.");
  assert.equal((await a.handle("aufnahme fortsetzen")).say, "Aufnahme läuft weiter.");
  assert.equal((await a.handle("aufnahme stoppen")).say, "Aufnahme gestoppt.");
  assert.equal((await a.handle("stream starten")).say, "Stream gestartet.");
  assert.equal((await a.handle("stream beenden")).say, "Stream beendet.");
  let r = await a.handle("wechsle zur szene kamera zwei", "de");
  assert.equal(r.mod, "obs");
  assert.equal(r.say, "Szene Kamera 2.");
  assert.equal(srv.state.scene, "Kamera 2");
  r = await a.handle("szene desktop");
  assert.equal(r.say, "Eine Szene „desktop“ habe ich nicht gefunden. Es gibt: Start, Gaming, Kamera 2.");
  assert.deepEqual(srv.requests.map((x) => x.requestType), ["StartRecord", "StartRecord", "PauseRecord", "ResumeRecord", "StopRecord", "StartStream", "StopStream", "GetSceneList", "SetCurrentProgramScene", "GetSceneList"]);
  assert.equal((await a.handle("start recording", "en")).say, "Recording started.");
  // „Pause“ allein bleibt bei der Musik
  assert.equal((await a.handle("pause")).mod, "musik");
  // falsches Passwort → OBS schließt mit 4009
  const w = setup({ settings: { obs: { url: srv.url, password: "falsch" } } });
  assert.equal((await w.a.handle("aufnahme starten")).say, "Das OBS-Passwort stimmt nicht – bitte in CommandWave unter Einstellungen eintragen.");
  const none = setup({ settings: { obs: { url: srv.url, password: "" } } });
  assert.match((await none.a.handle("aufnahme starten")).say, /Passwort stimmt nicht/);
  // OBS läuft nicht (Port zu)
  const port = srv.port;
  await srv.close();
  const off = setup({ settings: { obs: { url: `ws://127.0.0.1:${port}` } } });
  assert.match((await off.a.handle("stream starten")).say, /^OBS ist nicht erreichbar\. Läuft OBS und ist der WebSocket-Server an/);
});

test("OBS ohne Passwort", async (t) => {
  const srv = await startFakeObs({ scenes: ["Eins"] });
  t.after(() => srv.close());
  assert.deepEqual(await obs.request("GetSceneList", {}, { url: srv.url }), { currentProgramSceneName: "Eins", scenes: [{ sceneName: "Eins", sceneIndex: 0 }] });
});

test("Spotify: suchen und abspielen, Playlist, nicht installiert, Lied speichern; Amazon-Befehle bleiben", async () => {
  let n = 0;
  const { a, calls } = setup({ actions: { mediaSession: async (x) => (calls.push(`media ${x.command} ${x.app}`), n++ ? { ok: true, title: "Yellow", artist: "Coldplay", status: "Playing" } : { ok: false }) } });
  let r = await a.handle("spiel coldplay auf spotify");
  assert.equal(r.mod, "spotify");
  assert.equal(r.say, "Ich spiele Yellow von Coldplay auf Spotify.");
  assert.ok(calls.includes("play Spotify* spotify:search:coldplay"), calls.join("; "));
  calls.splice(0);
  r = await a.handle("spiele lieder von sdp auf spotify");
  assert.equal(r.mod, "spotify");
  assert.ok(calls.includes("play Spotify* spotify:search:sdp"));
  calls.splice(0);
  n = 0;
  r = await a.handle("spiel die playlist chillout auf spotify");
  assert.ok(calls.includes("play Spotify* spotify:search:playlist%20chillout"), calls.join("; "));
  // „spiel lieder von …“ ohne Spotify bleibt Amazon Music
  assert.equal(a.matchOnly("spiel lieder von sdp").command.startsWith("musik#"), true);
  assert.equal(a.matchOnly("was läuft gerade").command.startsWith("musik#"), true);
  // nicht installiert → Browser
  const b = setup({ actions: { playInApp: async () => ({ ok: false, step: "app", error: "nicht installiert" }) } });
  r = await b.a.handle("spiel coldplay auf spotify");
  assert.equal(r.say, "Spotify ist nicht installiert – ich habe die Suche nach „coldplay“ im Browser geöffnet.");
  assert.ok(b.calls.includes("open https://open.spotify.com/search/coldplay"));
  // kein Abspielen-Knopf
  const c = setup({ actions: { playInApp: async () => ({ ok: false, step: "abspielen", error: "kein Abspielen-Knopf" }) } });
  assert.equal((await c.a.handle("spiel coldplay auf spotify")).say, "Ich habe „coldplay“ bei Spotify gesucht – klick bitte auf Abspielen.");
  // Lied speichern: Spotify nach vorne, Alt+Umschalt+B
  const d = setup();
  r = await d.a.handle("lied gefällt mir");
  assert.equal(r.mod, "spotify");
  assert.deepEqual(d.calls, ["window focus spotify", "keys %+b"]);
  const e = setup({ actions: { window: async () => ({ ok: false, error: "nicht gefunden" }) } });
  assert.equal((await e.a.handle("lied gefällt mir")).say, "Spotify läuft gerade nicht.");
  assert.equal((await e.a.handle("play coldplay on spotify", "en")).mod, "spotify");
});
