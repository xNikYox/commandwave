// 1.6: Diktieren, Erinnerungen, Lautstärke je App, Systeminfo, Rechnen & Umrechnen
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { Assistant } = require("../src/core/assistant");
const N = require("../src/core/numbers");
const { appVolumeScript, typeTextScript } = require("../src/core/winscripts");

function setup({ answer = null, dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cw16-")), info } = {}) {
  const calls = [];
  const said = [];
  const actions = {
    typeText: async (a) => (calls.push("type " + a.text), { ok: true }),
    appVolume: async (a) => (calls.push(`vol ${a.op} ${a.match} ${a.value ?? ""}`.trim()), { ok: true, volume: 40, muted: a.op === "mute" }),
    systemInfo: async () => info || { ok: true, memTotal: 16 * 1024 ** 3, memFree: 6 * 1024 ** 3, cpu: 12, uptime: 3 * 86400 + 4 * 3600, disk: { free: 120 * 1024 ** 3, total: 500 * 1024 ** 3 }, battery: null, temp: null },
    run: async () => {}, open: async () => {},
  };
  const a = new Assistant({ modsDir: path.join(__dirname, "..", "mods"), actions, dataDir, ask: async () => answer, say: (t) => said.push(t), notify: () => {} });
  a.reload();
  return { a, calls, said, dataDir };
}
const clearReminders = () => {
  for (const t of (globalThis.__cwReminders || new Map()).values()) clearTimeout(t);
  globalThis.__cwReminders?.clear();
};

test("Zahlen: deutsch und englisch, zusammengesetzt, Komma", () => {
  assert.equal(N.deWord("zweihundertfünfundzwanzig"), 225);
  assert.equal(N.deWord("einundzwanzig"), 21);
  assert.equal(N.deWord("dreitausendvierhundert"), 3400);
  assert.deepEqual(N.readNumber(["ein", "und", "zwanzig", "äpfel"]), { value: 21, used: 3 });
  assert.deepEqual(N.readNumber(["drei", "komma", "fünf"]), { value: 3.5, used: 3 });
  assert.deepEqual(N.readNumber(["twenty", "five"], 0, "en"), { value: 25, used: 2 });
  assert.deepEqual(N.readNumber(["a", "hundred", "and", "twenty"], 0, "en"), { value: 120, used: 4 });
  assert.equal(N.toWords(21), "einundzwanzig");
  assert.equal(N.toWords(100), "einhundert");
  assert.equal(N.toWords(73, "en"), "seventy three");
  for (let n = 0; n <= 100; n++) assert.equal(N.deWord(N.toWords(n)), n, "de " + n);
});

test("Rechnen und Umrechnen", () => {
  const cases = [
    ["fünfzehn prozent von achtzig", "Das ergibt 12."], ["was ist drei komma fünf mal zwei", "Das ergibt 7."], ["fünf plus drei mal zwei", "Das ergibt 11."],
    ["zwei hoch zehn", "Das ergibt 1024."], ["wurzel aus neun", "Das ergibt 3."], ["zehn geteilt durch vier", "Das ergibt 2,5."], ["zehn durch null", "Durch null kann man nicht teilen."],
    ["fünf meilen in kilometer", "5 Meilen sind 8,05 Kilometer."], ["zwanzig grad in fahrenheit", "20 Grad Celsius sind 68 Grad Fahrenheit."], ["eins komma fünf liter in milliliter", "1,5 Liter sind 1500 Milliliter."],
  ];
  for (const [q, want] of cases) assert.equal(N.evaluate(q, "de")?.text, want, q);
  assert.equal(N.evaluate("fifteen percent of eighty", "en").text, "That's 12.");
  assert.equal(N.evaluate("five miles to kilometers", "en").text, "5 miles is 8.05 kilometers.");
  assert.equal(N.evaluate("seventy two degrees fahrenheit in celsius", "en").text, "72 degrees Fahrenheit is 22.22 degrees Celsius.");
  assert.equal(N.evaluate("hallo welt", "de"), null);
  assert.equal(N.evaluate("fünf meilen in kilogramm", "de"), null); // passt nicht zusammen
});

test("Rechnen per Sprache: direkt und mit Rückfrage", async () => {
  let { a } = setup();
  assert.equal((await a.handle("was ist fünf mal sieben")).say, "Das ergibt 35.");
  assert.equal((await a.handle("zwanzig prozent von achtzig")).say, "Das ergibt 16.");
  assert.equal((await a.handle("what is twenty times three", "en")).say, "That's 60.");
  ({ a } = setup({ answer: "fünf meilen in kilometer" }));
  assert.equal((await a.handle("rechne etwas")).say, "5 Meilen sind 8,05 Kilometer.");
  ({ a } = setup({ answer: "blabla" }));
  assert.equal((await a.handle("rechne etwas")).say, "Das konnte ich nicht ausrechnen: „blabla“.");
});

test("Diktieren: Satzzeichen, Großschreibung, eigene Wörter", async () => {
  let { a, calls } = setup({ answer: "hallo komma wie geht es dir fragezeichen neue zeile grüße von deer balance" });
  a.setAliases({ _woerter: { "deer balance": { key: "DoctorBenx", lang: "de" } } });
  assert.equal((await a.handle("schreib was")).ok, true);
  assert.deepEqual(calls, ["type Hallo, wie geht es dir?\nGrüße von DoctorBenx"]);
  ({ a, calls } = setup({ answer: "i think so period see you" }));
  await a.handle("type something", "en");
  assert.deepEqual(calls, ["type I think so. See you"]);
  ({ a, calls } = setup({ answer: null }));
  assert.equal((await a.handle("schreib was")).say, "Okay, nichts geschrieben.");
  assert.deepEqual(calls, []);
});

test("Erinnerungen: in/um, Liste, löschen, nach Neustart wieder da, verpasste melden", async (t) => {
  t.after(clearReminders);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cw16r-"));
  const { a } = setup({ answer: "pizza holen", dataDir });
  assert.equal((await a.handle("erinnere mich in zehn minuten")).say, "Okay, ich erinnere dich in 10 Minuten an: pizza holen.");
  assert.match((await a.handle("erinnere mich um achtzehn uhr dreißig")).say, /^Okay, ich erinnere dich (morgen )?um 18:30 Uhr an: pizza holen\.$/);
  assert.match((await a.handle("remind me in two hours", "en")).say, /^Okay, I'll remind you in 2 hours: pizza holen\.$/);
  assert.match((await a.handle("welche erinnerungen habe ich")).say, /^Du hast 3 Erinnerungen: /);
  // gespeichert → nach „Neustart“ (neu laden) genau einmal geplant
  const stored = JSON.parse(fs.readFileSync(path.join(dataDir, "mod-data", "erinnerungen.json"), "utf8")).list;
  assert.equal(stored.length, 3);
  a.reload();
  a.reload();
  assert.equal(globalThis.__cwReminders.size, 3);
  // eine verpasste Erinnerung (Zeit vorbei) wird nach dem Start gemeldet
  stored[0].at = Date.now() - 1000;
  fs.writeFileSync(path.join(dataDir, "mod-data", "erinnerungen.json"), JSON.stringify({ list: stored }));
  const b = setup({ dataDir });
  assert.equal(globalThis.__cwReminders.size, 3);
  assert.equal((await b.a.handle("lösche alle erinnerungen")).say, "3 Erinnerungen gelöscht.");
  assert.equal(globalThis.__cwReminders.size, 0);
  assert.equal((await b.a.handle("welche erinnerungen habe ich")).say, "Du hast keine Erinnerungen.");
});

test("Erinnerung meldet sich mit Stimme", async (t) => {
  t.after(clearReminders);
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
  const { a, said } = setup({ answer: "tee" });
  await a.handle("erinnere mich in einer minute");
  t.mock.timers.tick(61 * 1000);
  assert.deepEqual(said, ["Erinnerung: tee"]);
});

test("Lautstärke je App", async () => {
  const { a, calls } = setup();
  assert.equal((await a.handle("spotify leiser")).say, "Spotify ist jetzt bei 40 Prozent.");
  assert.equal((await a.handle("mach discord stumm")).say, "Discord ist stumm.");
  assert.equal((await a.handle("disk kord nicht mehr stumm")).say, "Discord ist wieder an.");
  assert.equal((await a.handle("chrome auf dreißig prozent")).ok, true);
  assert.equal((await a.handle("wie laut ist der browser")).say, "Der browser ist bei 40 Prozent.".replace("Der browser", "Der Browser"));
  assert.equal((await a.handle("turn spotify down", "en")).say, "Spotify is now at 40 percent.");
  assert.deepEqual(calls, ["vol down spotify 0.2", "vol mute discord", "vol unmute discord|disk kord", "vol set chrome 0.3", "vol get chrome|msedge|firefox|brave|opera|browser", "vol down spotify 0.2"]);
  // Skript: Namen sicher eingesetzt
  assert.match(appVolumeScript("o'neil|spotify", "set", 0.5), /'o''neil\|spotify'.*'set', \[float\]0\.5/);
  assert.match(typeTextScript("50% (Rabatt)", 7), /\$text = '50% \(Rabatt\)'; \$skip = 7/);
});

test("Systeminfo", async () => {
  let { a } = setup();
  assert.equal((await a.handle("wie voll ist der arbeitsspeicher")).say, "Der Arbeitsspeicher ist zu 63 Prozent belegt – 6 von 16 GB sind frei.");
  assert.equal((await a.handle("wie viel akku habe ich")).say, "Dieser PC hat keinen Akku.");
  assert.equal((await a.handle("wie lange läuft der pc schon")).say, "Der PC läuft seit 3 Tagen und 4 Stunden.");
  assert.equal((await a.handle("wie warm ist die cpu")).say, "Die Temperatur gibt Windows ohne Zusatzprogramm leider nicht heraus.");
  // Systemstatus ohne Akku: den Akku-Satz weglassen
  assert.equal((await a.handle("systemstatus")).say, "Die CPU ist gerade zu 12 Prozent ausgelastet. Der Arbeitsspeicher ist zu 63 Prozent belegt – 6 von 16 GB sind frei. Auf dem Systemlaufwerk sind noch 120 von 500 GB frei.");
  ({ a } = setup({ info: { ok: true, memTotal: 1, memFree: 1, cpu: 1, uptime: 60, disk: null, battery: { percent: 80, charging: true }, temp: 55 } }));
  assert.equal((await a.handle("how much battery do i have", "en")).say, "The battery is at 80 percent and charging.");
  assert.equal((await a.handle("wie warm ist die cpu")).say, "Die CPU ist etwa 55 Grad warm.");
});
