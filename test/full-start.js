// Normaler Start der fertigen App (Tray, App-Updater, Mod-Updates aus dem offiziellen Repo, App-Suche) – 45 s.
// Schlägt fehl, wenn ein Fehler im Hauptprozess auftritt.
const { spawn } = require("node:child_process");
const path = require("node:path");

const exe = path.resolve(process.env.CW_EXE || "dist/win-unpacked/CommandWave.exe");
const child = spawn(exe, ["--fulltest"], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" } });
let out = "";
child.stdout.on("data", (d) => (out += d));
child.stderr.on("data", (d) => (out += d));
const timer = setTimeout(() => {
  console.error("Zeitüberschreitung\n" + out.slice(-4000));
  child.kill();
  process.exit(1);
}, 120000);
child.on("exit", (code) => {
  clearTimeout(timer);
  const lines = out.split(/\r?\n/);
  const errors = lines.filter((l) => l.includes("FEHLER ") || /Uncaught|TypeError|ReferenceError|Cannot find module/.test(l));
  const res = lines.find((l) => l.includes("FULLTEST "));
  console.log(res ? JSON.stringify(JSON.parse(res.slice(res.indexOf("FULLTEST ") + 9)), null, 2) : "keine FULLTEST-Ausgabe (Code " + code + ")");
  if (errors.length || !res) {
    console.log("--- Fehler / Protokoll ---\n" + (errors.length ? errors.join("\n") : lines.slice(-60).join("\n")));
    process.exit(1);
  }
  console.log("Voller Start ohne Fehler.");
});
