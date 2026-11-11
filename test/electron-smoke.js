// Die echte App im Testmodus starten (--smoke): Fenster unsichtbar, Sprachmodell laden, Erkenner und Befehle prüfen.
const { spawn } = require("node:child_process");
const path = require("node:path");
const electron = require("electron");

const child = spawn(electron, [path.join(__dirname, ".."), "--smoke"], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" } });
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
  if (!r.ok) process.exit(1);
  console.log("App-Test bestanden: Modell geladen, Erkenner arbeitet, Befehle laufen.");
});
