// Praxistest auf echtem Windows (GitHub Actions): Programme starten/schließen, Medientasten, Ordner öffnen.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const { createActions } = require("../src/core/actions");
const { Assistant } = require("../src/core/assistant");
const { START_APPS_CMD, toSlots } = require("../src/core/apps");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Hat der Prozess ein sichtbares Fenster? (früher startete CommandWave Programme versteckt) */
const visibleWindow = (name) => execFileSync("powershell.exe", ["-NoProfile", "-Command",
  "Add-Type -Namespace W -Name U -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool IsWindowVisible(IntPtr h);'; " +
  `$p = Get-Process -Name ${name} -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }; if ($p -and [W.U]::IsWindowVisible($p[0].MainWindowHandle)) { 'ja' } else { 'nein' }`]).toString().trim();
const running = (exe) => execFileSync("tasklist", ["/FI", `IMAGENAME eq ${exe}`, "/NH"]).toString().toLowerCase().includes(exe.toLowerCase());

(async () => {
  const opened = [];
  const actions = createActions({ openExternal: async (u) => opened.push(u), openPath: async (p) => (opened.push(p), "") });
  const a = new Assistant({ modsDir: path.join(__dirname, "..", "mods"), actions, dataDir: os.tmpdir() });
  a.reload();
  assert.deepEqual(a.errors, []);

  let r = await a.handle("Öffne die App Editor");
  assert.equal(r.say, "Editor wird gestartet");
  await wait(2500);
  assert.ok(running("notepad.exe"), "Editor läuft nicht");
  assert.equal(visibleWindow("notepad"), "ja", "Editor läuft, aber ohne sichtbares Fenster");
  console.log("„Öffne die App Editor“ → Editor läuft mit sichtbarem Fenster: ok");

  r = await a.handle("schließe den editor");
  assert.equal(r.say, "Editor wird geschlossen");
  await wait(2500);
  assert.ok(!running("notepad.exe"), "Editor läuft noch");
  console.log("„Schließe den Editor“ → beendet: ok");

  // Installierte Apps aus dem Startmenü (Get-StartApps) und Start über shell:AppsFolder
  const list = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command", START_APPS_CMD]).toString() || "[]");
  const slots = toSlots(list);
  console.log(`Get-StartApps: ${[].concat(list).length} Einträge → ${Object.keys(slots).length} sprechbare Apps, z. B. ${Object.keys(slots).slice(0, 12).join(", ")}`);
  assert.ok(Object.keys(slots).length >= 5, "zu wenige Apps gefunden");
  a.setExtraSlots({ app: slots });
  const np = Object.entries(slots).find(([, v]) => /notepad/i.test(v.target));
  if (np) {
    await actions.run({ target: np[1].target });
    await wait(3000);
    assert.ok(running("notepad.exe"), "Start über shell:AppsFolder hat nicht geklappt: " + np[1].target);
    console.log(`Start über das Startmenü (${np[1].target}): ok`);
    execFileSync("taskkill", ["/IM", "notepad.exe", "/F"]);
  } else console.log("Editor nicht im Startmenü gefunden – Start über shell:AppsFolder nicht geprüft");

  // Programm, das Windows nur über „start“ findet (App-Pfade), und eines mit Pfad + Argumenten
  await actions.run({ target: "cmd.exe", args: ["/c", "exit", "0"] });
  await assert.rejects(actions.run({ target: "gibt-es-nicht-cw.exe" }), /nicht gefunden|ENOENT/);
  console.log("Unbekanntes Programm → Fehler statt Absturz: ok");

  r = await a.handle("mach lauter");
  assert.equal(r.ok, true, "Medientaste: " + r.error);
  r = await a.handle("mach leiser");
  assert.equal(r.ok, true);
  console.log("Lautstärke-Tasten (PowerShell keybd_event): ok");

  r = await a.handle("öffne downloads");
  assert.equal(r.say, "Downloads wird geöffnet");
  assert.match(opened.at(-1), /\\Downloads$/);
  assert.ok(!opened.at(-1).includes("%"), "Umgebungsvariable nicht ersetzt: " + opened.at(-1));
  console.log("„Öffne Downloads“ →", opened.at(-1));

  assert.match((await a.handle("wie spät ist es")).say, /Uhr/);

  // Windows-Mediensteuerung (Amazon Music, Spotify …): Abfrage muss laufen – auf dem Testrechner spielt nichts
  const ms = await actions.mediaSession({ command: "info" });
  console.log("Mediensteuerung:", JSON.stringify(ms));
  assert.ok(ms.ok || ms.error === "keine Wiedergabe", "Mediensteuerung nicht erreichbar: " + ms.error);
  assert.equal((await a.handle("was läuft gerade")).say, "Gerade läuft nichts.");
  console.log("„Was läuft gerade?“ ohne Wiedergabe: ok");

  // Browser-Tabs: Edge mit zwei Tabs öffnen, gezielt „Alpha“ schließen
  const edge = ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"].find((p) => require("node:fs").existsSync(p));
  if (edge) {
    const prof = require("node:fs").mkdtempSync(path.join(os.tmpdir(), "cw-edge-"));
    require("node:child_process").spawn(edge, ["--no-first-run", "--no-default-browser-check", "--user-data-dir=" + prof, "--new-window",
      "data:text/html,<title>Alpha Testseite</title>alpha", "data:text/html,<title>Beta Testseite</title>beta"], { detached: true, stdio: "ignore" }).unref();
    let tabs = [];
    for (let i = 0; i < 20 && !(tabs.some((t) => /Alpha/.test(t)) && tabs.some((t) => /Beta/.test(t))); i++) {
      await wait(1000);
      tabs = (await actions.browser({ op: "list" })).tabs || [];
    }
    console.log("Edge-Tabs:", JSON.stringify(tabs));
    assert.ok(tabs.some((t) => /Alpha/.test(t)) && tabs.some((t) => /Beta/.test(t)), "Tabs nicht gefunden");
    const r = await actions.browser({ op: "closeMatching", match: "alpha" });
    console.log("Schließe „alpha“:", JSON.stringify(r));
    assert.equal(r.count, 1);
    await wait(1500);
    tabs = (await actions.browser({ op: "list" })).tabs || [];
    assert.ok(!tabs.some((t) => /Alpha/.test(t)), "Alpha-Tab noch offen: " + JSON.stringify(tabs));
    assert.ok(tabs.some((t) => /Beta/.test(t)), "Beta-Tab fehlt");
    console.log("Tab nach Namen schließen: ok");
    const before = tabs.length;
    const n = await actions.browser({ op: "new" });
    await wait(1500);
    const after = ((await actions.browser({ op: "list" })).tabs || []).length;
    console.log(`Neuer Tab per Tastenkürzel: ${JSON.stringify(n)}, Tabs ${before} → ${after}`);
    try {
      execFileSync("taskkill", ["/IM", "msedge.exe", "/F"], { stdio: "ignore" });
    } catch {
      // schon zu
    }
  } else console.log("Edge nicht installiert – Tabs nicht geprüft");
  // Fenster: Editor nach vorne holen, minimieren, wiederherstellen, maximieren, andocken
  await actions.run({ target: "notepad.exe" });
  await wait(2500);
  let w = await actions.window({ op: "focus", match: "notepad|editor" });
  console.log("Fenster nach vorne:", JSON.stringify(w));
  assert.equal(w.ok, true, "Editor-Fenster nicht gefunden: " + w.error);
  await wait(500);
  w = await actions.window({ op: "minimize" });
  console.log("Minimieren:", JSON.stringify(w));
  assert.equal(w.ok, true, w.error);
  if (w.name === "notepad") assert.equal(w.minimized, true, "Editor nicht minimiert");
  w = await actions.window({ op: "focus", match: "notepad" });
  await wait(500);
  w = await actions.window({ op: "maximize" });
  console.log("Maximieren:", JSON.stringify(w));
  assert.equal(w.ok, true, w.error);
  if (w.name === "notepad") assert.equal(w.maximized, true, "Editor nicht maximiert");
  for (const op of ["restore", "left", "right"]) {
    w = await actions.window({ op });
    console.log(op + ":", JSON.stringify(w));
    assert.equal(w.ok, true, op + ": " + w.error);
  }
  const wins = await actions.window({ op: "list" });
  console.log("Offene Fenster:", JSON.stringify(wins).slice(0, 300));
  assert.equal((await actions.window({ op: "focus", match: "gibt-es-nicht-cw" })).ok, false);
  assert.equal((await actions.window({ op: "desktop" })).ok, true);
  r = await a.handle("wechsle zu editor");
  assert.equal(r.say, "Wechsle zu Editor.");
  execFileSync("taskkill", ["/IM", "notepad.exe", "/F"]);
  r = await a.handle("wechsle zu editor");
  assert.equal(r.say, "Editor ist gerade nicht offen.");
  console.log("Fenster steuern: ok");

  // Diktieren: Text in den Editor tippen und über die Bedienungshilfe zurücklesen
  await actions.run({ target: "notepad.exe" });
  await wait(2500);
  await actions.window({ op: "focus", match: "notepad" });
  await wait(500);
  const typed = await actions.typeText({ text: "Hallo Welt, 50% (Test)!\nZweite Zeile äöü" });
  console.log("Tippen:", JSON.stringify(typed));
  assert.equal(typed.ok, true, typed.error);
  await wait(800);
  // zurücklesen: Editor nach vorne, alles markieren und kopieren, Zwischenablage lesen
  await actions.window({ op: "focus", match: "notepad" });
  await wait(400);
  const content = execFileSync("powershell.exe", ["-NoProfile", "-STA", "-Command",
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^a'); Start-Sleep -Milliseconds 200; [System.Windows.Forms.SendKeys]::SendWait('^c'); Start-Sleep -Milliseconds 400; Get-Clipboard -Raw"]).toString();
  console.log("Im Editor steht:", JSON.stringify(content.trim()));
  assert.match(content, /Hallo Welt, 50% \(Test\)!/);
  assert.match(content, /Zweite Zeile äöü/);
  execFileSync("taskkill", ["/IM", "notepad.exe", "/F"]);
  console.log("Diktieren (Text tippen): ok");

  // Lautstärke je App: Mixer-Code muss sich übersetzen lassen; ohne Ton/Audiogerät sauber melden
  const vol = await actions.appVolume({ match: "gibt-es-nicht-cw", op: "get" });
  console.log("Lautstärkemixer:", JSON.stringify(vol));
  assert.ok(["keine Wiedergabe", "kein Audiogerät"].includes(vol.error), "Mixer: " + vol.error);
  // Systeminfo
  const si = await actions.systemInfo();
  console.log("Systeminfo:", JSON.stringify(si));
  assert.ok(si.memTotal > 0 && si.disk && si.disk.total > 0 && si.cpu >= 0 && si.cpu <= 100);
  console.log(`„Systemstatus“ → ${(await a.handle("systemstatus")).say}`);

  // Alle PowerShell-Skripte müssen sich fehlerfrei einlesen lassen (auch Teile, die hier nicht laufen)
  const ws = require("../src/core/winscripts");
  const scripts = { media: ws.mediaSessionScript("info", "amazon"), browser: ws.browserScript("closeMatching", "youtube"), window: ws.windowScript("focus", "notepad"), amazon: ws.amazonMusicScript("blinding lights (live)"),
    type: ws.typeTextScript("hallo (welt)", 1), volume: ws.appVolumeScript("spotify", "down", 0.2), system: ws.systemScript() };
  for (const [name, sc] of Object.entries(scripts)) {
    const f = path.join(os.tmpdir(), `cw-${name}.ps1`);
    require("node:fs").writeFileSync(f, "\ufeff" + sc);
    const out = execFileSync("powershell.exe", ["-NoProfile", "-Command", `$e = $null; $null = [System.Management.Automation.Language.Parser]::ParseFile('${f}', [ref]$null, [ref]$e); if ($e) { $e | ForEach-Object { $_.Message } } else { 'ok' }`]).toString().trim();
    assert.equal(out, "ok", `Skript ${name}: ${out}`);
  }
  console.log("PowerShell-Skripte fehlerfrei:", Object.keys(scripts).join(", "));
  // Amazon Music ist auf dem Testrechner nicht installiert → sauber „nicht installiert“
  const am = await actions.amazonMusic({ query: "blinding lights" });
  console.log("Amazon Music:", JSON.stringify(am));
  assert.equal(am.error, "nicht installiert");

  console.log("Windows-Praxistest bestanden.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
