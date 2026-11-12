// Brücke für das Overlay: nur Meldungen empfangen (und im Testmodus bestätigen).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ov", {
  onUpdate: (fn) => ipcRenderer.on("update", (_e, d) => fn(d)),
  shown: (text) => ipcRenderer.send("overlay:shown", text),
});
