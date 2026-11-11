// CommandWave – Aktionen, die Mods auslösen können (ohne eigenen Code):
//   run      Programm starten           { "type": "run", "target": "notepad.exe", "args": ["datei.txt"] }
//   open     Webseite/Ordner/Datei/      { "type": "open", "target": "https://www.youtube.com" }
//            Windows-Einstellung         { "type": "open", "target": "ms-settings:display" }
//   media    Lautstärke & Musik          { "type": "media", "key": "volume_up", "times": 5 }
//   keys     Tasten drücken              { "type": "keys", "keys": "^c" }   (Schreibweise wie SendKeys)
//   shell    PowerShell-Befehl           { "type": "shell", "command": "Stop-Computer" }   ← mächtig, nur eigene Mods
//   sequence mehrere Schritte            { "type": "sequence", "steps": [ {…}, {…} ] }
//   say/none nur antworten
const { spawn } = require("node:child_process");
const path = require("node:path");

/** Virtuelle Tasten für Lautstärke und Musik */
const MEDIA = { volume_up: 0xaf, volume_down: 0xae, mute: 0xad, play_pause: 0xb3, next: 0xb0, previous: 0xb1, stop: 0xb2 };

/** PowerShell-Befehl, der virtuelle Tasten drückt (keybd_event) */
function mediaScript(key, times = 1) {
  const vk = MEDIA[key];
  if (vk == null) throw new Error("Unbekannte Taste: " + key + " (erlaubt: " + Object.keys(MEDIA).join(", ") + ")");
  const n = Math.max(1, Math.min(50, times | 0));
  return "Add-Type -Namespace CW -Name K -MemberDefinition '[DllImport(\"user32.dll\")] public static extern void keybd_event(byte v, byte s, int f, int e);'; " +
    `for($i=0;$i -lt ${n};$i++){ [CW.K]::keybd_event(${vk},0,0,0); [CW.K]::keybd_event(${vk},0,2,0); Start-Sleep -Milliseconds 30 }`;
}

const psq = (s) => "'" + String(s).replace(/'/g, "''") + "'";

/**
 * Aktionen ausführen. env = { spawn, openExternal, openPath, platform } – austauschbar für Tests.
 */
function createActions(env = {}) {
  const sp = env.spawn || spawn;
  const platform = env.platform || process.platform;
  const powershell = (command) => new Promise((resolve, reject) => {
    const child = sp("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command", command], { windowsHide: true, stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("PowerShell beendet mit Code " + code))));
  });
  /** Programm losgelöst starten → Promise (Fehler z. B. ENOENT) */
  const launch = (file, list) => new Promise((resolve, reject) => {
    // windowsHide NICHT setzen: sonst startet Windows Programme mit verstecktem Fenster
    const child = sp(file, list, { detached: true, stdio: "ignore" });
    let done = false;
    child.on?.("error", (e) => !done && ((done = true), reject(e)));
    child.on?.("spawn", () => !done && ((done = true), resolve()));
    child.unref?.();
    if (!child.on) resolve();
  });
  /** Pfad aus HKCU/HKLM\…\App Paths\<name>.exe (dort tragen sich Word, Excel, Chrome & Co. ein) */
  const appPath = async (name) => {
    if (env.appPath) return env.appPath(name);
    const exe = /\.exe$/i.test(name) ? name : name + ".exe";
    if (/[\\/:]/.test(exe)) return null;
    for (const hive of ["HKCU", "HKLM"]) {
      const out = await new Promise((resolve) => {
        let text = "";
        const c = sp("reg.exe", ["query", `${hive}\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}`, "/ve"], { windowsHide: true });
        c.stdout?.on("data", (d) => (text += d));
        c.on?.("error", () => resolve(""));
        c.on?.("exit", (code) => resolve(code === 0 ? text : ""));
      });
      const m = /REG_(?:EXPAND_)?SZ\s+(.+)/.exec(out);
      if (m) return m[1].trim().replace(/^"|"$/g, "").replace(/%([^%]+)%/g, (x, v) => process.env[v] ?? x);
    }
    return null;
  };
  const isUri = (t) => /^[a-z][a-z0-9+.-]*:/i.test(t) && !/^[a-z]:[\\/]/i.test(t); // https:, ms-settings:, mailto: – aber nicht C:\

  const actions = {
    async run({ target, args = [] }) {
      if (!target) throw new Error("run: target fehlt");
      // Startmenü-/Store-Apps (shell:AppsFolder\…) öffnet der Explorer wie ein Klick im Startmenü
      if (/^shell:/i.test(target)) return launch("explorer.exe", [target]);
      if (isUri(target)) return actions.open({ target });
      const list = args.map(String);
      // erst direkt starten (kein Konsolenfenster); findet Windows das Programm so nicht (z. B. „winword“),
      // in den „App-Pfaden“ der Registry nachsehen – kein „start“, das bei Fehlern ein Fenster aufmacht
      try {
        await launch(target, list);
      } catch (e) {
        if (e.code !== "ENOENT" || platform !== "win32") throw e;
        const found = await appPath(target);
        if (!found) throw new Error(`„${target}“ wurde nicht gefunden`);
        await launch(found, list);
      }
    },
    async open({ target }) {
      if (!target) throw new Error("open: target fehlt");
      if (/^shell:/i.test(target)) return launch("explorer.exe", [target]);
      if (isUri(target)) return env.openExternal ? env.openExternal(target) : actions.run({ target: "explorer.exe", args: [target] });
      const p = target.replace(/%([^%]+)%/g, (m, v) => process.env[v] ?? m); // %USERPROFILE%\Downloads
      const err = env.openPath ? await env.openPath(path.normalize(p)) : "";
      if (err) throw new Error(err);
    },
    async media({ key, times = 1 }) {
      return powershell(mediaScript(key, times));
    },
    async keys({ keys }) {
      if (!keys) throw new Error("keys: keys fehlt");
      return powershell(`(New-Object -ComObject WScript.Shell).SendKeys(${psq(keys)})`);
    },
    async shell({ command }) {
      if (!command) throw new Error("shell: command fehlt");
      return powershell(command);
    },
    async sequence({ steps = [] }, run) {
      for (const s of steps) {
        if (s.type === "wait") await new Promise((r) => setTimeout(r, Math.min(10000, s.ms || 500)));
        else await run(s);
      }
    },
    async say() {},
    async none() {},
  };
  return actions;
}

module.exports = { createActions, mediaScript, MEDIA };
