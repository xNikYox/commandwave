// Brücke zwischen Fenster und Hauptprozess – nur diese Funktionen sind im Fenster erreichbar.
const { contextBridge, ipcRenderer } = require("electron");

const on = (ch) => (fn) => {
  const h = (_e, d) => fn(d);
  ipcRenderer.on(ch, h);
  return () => ipcRenderer.removeListener(ch, h);
};

contextBridge.exposeInMainWorld("cw", {
  state: () => ipcRenderer.invoke("state"),
  command: (text, lang) => ipcRenderer.invoke("command", text, lang),
  commandMulti: (cands, opts) => ipcRenderer.invoke("commandMulti", cands, opts),
  confirm: (text) => ipcRenderer.invoke("confirm", text),
  preview: (cands) => ipcRenderer.invoke("preview", cands),
  askAnswer: (id, text) => ipcRenderer.invoke("ask:answer", id, text),
  addAlias: (a) => ipcRenderer.invoke("alias:add", a),
  removeAlias: (a) => ipcRenderer.invoke("alias:remove", a),
  overlay: (d) => ipcRenderer.send("overlay", d),
  overlayTest: () => ipcRenderer.invoke("overlay:test"),
  saveSettings: (patch) => ipcRenderer.invoke("settings:save", patch),
  reloadMods: () => ipcRenderer.invoke("mods:reload"),
  openModsFolder: () => ipcRenderer.invoke("mods:folder"),
  checkUpdates: () => ipcRenderer.invoke("mods:check"),
  installMod: (id) => ipcRenderer.invoke("mods:install", id),
  hide: () => ipcRenderer.invoke("window:hide"),
  pauseHotkeys: () => ipcRenderer.invoke("hotkey:pause"),
  resumeHotkeys: () => ipcRenderer.invoke("hotkey:resume"),
  smoke: (data) => ipcRenderer.invoke("smoke", data),
  match: (text, lang) => ipcRenderer.invoke("match", text, lang),
  appUpdate: () => ipcRenderer.invoke("app:update"),
  checkAppUpdate: () => ipcRenderer.invoke("app:checkUpdate"),
  installAppUpdate: () => ipcRenderer.invoke("app:installUpdate"),
  downloadApp: () => ipcRenderer.invoke("app:download"),
  copyReport: () => ipcRenderer.invoke("report:copy"),
  openLogs: () => ipcRenderer.invoke("report:folder"),
  onSound: on("sound"),
  onAppUpdate: on("appUpdate"),
  onListen: on("listen"),
  onSpeak: on("speak"),
  onAsk: on("ask"),
  onMods: on("mods"),
});
