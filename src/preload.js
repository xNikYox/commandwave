// Brücke zwischen Fenster und Hauptprozess – nur diese Funktionen sind im Fenster erreichbar.
const { contextBridge, ipcRenderer } = require("electron");

const on = (ch) => (fn) => {
  const h = (_e, d) => fn(d);
  ipcRenderer.on(ch, h);
  return () => ipcRenderer.removeListener(ch, h);
};

contextBridge.exposeInMainWorld("cw", {
  state: () => ipcRenderer.invoke("state"),
  command: (text) => ipcRenderer.invoke("command", text),
  saveSettings: (patch) => ipcRenderer.invoke("settings:save", patch),
  reloadMods: () => ipcRenderer.invoke("mods:reload"),
  openModsFolder: () => ipcRenderer.invoke("mods:folder"),
  checkUpdates: () => ipcRenderer.invoke("mods:check"),
  installMod: (id) => ipcRenderer.invoke("mods:install", id),
  hide: () => ipcRenderer.invoke("window:hide"),
  pauseHotkeys: () => ipcRenderer.invoke("hotkey:pause"),
  resumeHotkeys: () => ipcRenderer.invoke("hotkey:resume"),
  smoke: (data) => ipcRenderer.invoke("smoke", data),
  match: (text) => ipcRenderer.invoke("match", text),
  appUpdate: () => ipcRenderer.invoke("app:update"),
  checkAppUpdate: () => ipcRenderer.invoke("app:checkUpdate"),
  installAppUpdate: () => ipcRenderer.invoke("app:installUpdate"),
  onAppUpdate: on("appUpdate"),
  onListen: on("listen"),
  onSpeak: on("speak"),
  onMods: on("mods"),
});
