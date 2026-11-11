const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const { Assistant } = require("../src/core/assistant");
const { mediaSessionScript, browserScript } = require("../src/core/winscripts");

function setup(media = { ok: true, title: "Blinding Lights", artist: "The Weeknd", app: "AmazonMobileLLC.AmazonMusic_xyz" }, tabs = 1) {
  const calls = [];
  const actions = {
    mediaSession: async (a) => (calls.push(`media ${a.command} ${a.app}`.trim()), typeof media === "function" ? media(a) : media),
    browser: async (a) => (calls.push(`browser ${a.op}${a.match ? " " + a.match : ""}${a.all ? " alle" : ""}`), { ok: true, count: a.op === "closeMatching" ? tabs : 0 }),
    media: async (a) => calls.push("taste " + a.key),
    run: async () => {}, open: async () => {},
  };
  const a = new Assistant({ modsDir: path.join(__dirname, "..", "mods"), actions, dataDir: os.tmpdir() });
  a.reload();
  return { a, calls };
}

test("Lieder steuern – gezielt je App (Amazon Music, Spotify, Browser) oder die aktuelle Wiedergabe", async () => {
  const { a, calls } = setup();
  const cases = [
    ["nächstes lied", "media next"],
    ["nächstes lied in amazon music", "media next amazon"],
    ["lied überspringen bei spotify", "media next spotify"],
    ["springe zum nächsten lied", "media next"],
    ["vorheriges lied in amazon", "media previous amazon"],
    ["pause bei amazon musik", "media pause amazon"],
    ["musik weiter", "media play"],
    ["nächstes lied bei youtube", "media next chrome|msedge|firefox|brave|opera"],
  ];
  for (const [t, call] of cases) {
    const r = await a.handle(t);
    assert.equal(r.ok, true, t);
    assert.deepEqual(calls.splice(0), [call], t);
  }
  assert.equal((await a.handle("was läuft gerade")).say, "Gerade läuft Blinding Lights von The Weeknd in Amazon Music.");
});

test("keine Wiedergabe: bei genannter App Hinweis, sonst Medientaste als Ersatz", async () => {
  const { a, calls } = setup({ ok: false, error: "keine Wiedergabe" });
  assert.equal((await a.handle("nächstes lied in amazon music")).say, "Bei Amazon Music läuft gerade nichts.");
  calls.splice(0);
  assert.equal((await a.handle("nächstes lied")).say, "");
  assert.deepEqual(calls, ["media next", "taste next"]);
  assert.equal((await a.handle("was läuft gerade")).say, "Gerade läuft nichts.");
});

test("Browser-Tabs: aktueller Tab, Tab nach Namen, alle passenden, Lautschrift", async () => {
  const { a, calls } = setup(undefined, 1);
  assert.equal((await a.handle("schließe den tab")).say, "Tab geschlossen.");
  assert.equal((await a.handle("schließe den youtube tab")).say, "YouTube-Tab geschlossen.");
  assert.equal((await a.handle("schließe den tab mit amazon")).say, "Amazon-Tab geschlossen.");
  assert.equal((await a.handle("schließe den red it tab")).say, "Reddit-Tab geschlossen.");
  assert.equal((await a.handle("schließe den nachrichten tab")).say, "Nachrichten-Tab geschlossen.");
  for (const t of ["neuer tab", "nächster tab", "vorheriger tab", "tab wiederherstellen"]) assert.equal((await a.handle(t)).ok, true, t);
  assert.deepEqual(calls.splice(0), ["browser close", "browser closeMatching youtube", "browser closeMatching amazon", "browser closeMatching reddit", "browser closeMatching tagesschau",
    "browser new", "browser next", "browser previous", "browser reopen"]);
  const many = setup(undefined, 3);
  assert.equal((await many.a.handle("schließe alle youtube tabs")).say, "3 YouTube-Tabs geschlossen.");
  assert.deepEqual(many.calls, ["browser closeMatching youtube alle"]);
  const none = setup(undefined, 0);
  assert.equal((await none.a.handle("schließe den twitch tab")).say, "Ich habe keinen Tab mit Twitch gefunden.");
  // „schließe den editor“ bleibt bei der Apps-Mod
  assert.equal((await a.handle("schließe den editor")).say, "Editor wird geschlossen");
});

test("Windows-Skripte: Werte sicher eingesetzt", () => {
  const m = mediaSessionScript("next", "amaz'on");
  assert.match(m, /\$want = 'amaz''on'/);
  assert.match(m, /TrySkipNextAsync/);
  const b = browserScript("closeMatching", "you'tube", true);
  assert.match(b, /\$m = 'you''tube'/);
  assert.doesNotMatch(b, /\$hits = @\(\$hits\[0\]\)/); // „alle“: nicht nur der erste
  assert.match(browserScript("closeMatching", "x"), /\$hits = @\(\$hits\[0\]\)/);
  assert.match(browserScript("close"), /SendKeys\('\^w'\)/);
  assert.match(browserScript("reopen"), /SendKeys\('\^\+t'\)/);
});
