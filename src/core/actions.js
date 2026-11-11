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
  const isUri = (t) => /^[a-z][a-z0-9+.-]*:/i.test(t) && !/^[a-z]:[\\/]/i.test(t); // https:, ms-settings:, mailto: – aber nicht C:\

  const actions = {
    async run({ target, args = [] }) {
      if (!target) throw new Error("run: target fehlt");
      if (isUri(target)) return actions.open({ target });
      const list = args.map(String);
      // erst direkt starten (kein Konsolenfenster); findet Windows das Programm so nicht (z. B. „winword“ aus den
      // App-Pfaden), über „start“ versuchen
      await new Promise((resolve, reject) => {
        const child = sp(target, list, { windowsHide: true, detached: true, stdio: "ignore" });
        let done = false;
        child.on?.("error", (e) => {
          if (done) return;
          done = true;
          if (e.code !== "ENOENT" || platform !== "win32") return reject(e);
          const viaStart = sp("cmd.exe", ["/d", "/s", "/c", "start", '""', target, ...list], { windowsHide: true, detached: true, stdio: "ignore" });
          viaStart.on?.("error", reject);
          viaStart.on?.("exit", (code) => (code === 0 ? resolve() : reject(new Error(`„${target}“ wurde nicht gefunden`))));
          viaStart.unref?.();
        });
        child.on?.("spawn", () => {
          if (!done) (done = true), resolve();
        });
        child.unref?.();
        if (!child.on) resolve();
      });
    },
    async open({ target }) {
      if (!target) throw new Error("open: target fehlt");
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
