// Die echte App im Testmodus starten (--smoke): Fenster unsichtbar, Sprachmodell laden, Erkenner und Befehle prüfen.
const { spawn } = require("node:child_process");
const path = require("node:path");
const electron = require("electron");

// CW_EXE gesetzt → die fertig gebaute App testen (dist/win-unpacked/CommandWave.exe), sonst aus dem Quellcode
const exe = process.env.CW_EXE ? path.resolve(process.env.CW_EXE) : electron;
const args = process.env.CW_EXE ? ["--smoke"] : [path.join(__dirname, ".."), "--smoke"];
console.log("Teste:", exe);
const child = spawn(exe, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" } });
let out = "";
child.stdout.on("data", (d) => (out += d));
child.stderr.on("data", (d) => (out += d));
const timer = setTimeout(() => {
  console.error("Zeitüberschreitung\n" + out.slice(-3000));
  child.kill();
  process.exit(1);
}, 180000);
child.on("exit", (code) => {
  clearTimeout(timer);
  const line = out.split(/\r?\n/).find((l) => l.includes("SMOKE "));
  if (!line) {
    console.error("Keine SMOKE-Ausgabe (Code " + code + ")\n" + out.slice(-3000));
    process.exit(1);
  }
  const r = JSON.parse(line.slice(line.indexOf("SMOKE ") + 6));
  console.log(JSON.stringify(r, null, 2));
  if (!r.ok) {
    console.log("--- Protokoll der App ---\n" + out.split(/\r?\n/).filter((l) => !/SMOKE /.test(l)).slice(-80).join("\n"));
    process.exit(1);
  }
  console.log("App-Test bestanden: Modell geladen, Erkenner arbeitet, Befehle laufen.");
});
