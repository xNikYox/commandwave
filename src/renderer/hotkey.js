// CommandWave – Tastenkombination aus einem Tastendruck bilden.
// Gespeichert wird die Schreibweise von Electron (nach Tastencode, damit es auch mit deutschem Layout klappt),
// angezeigt der Name der Taste auf DEINER Tastatur (z. B. „Strg + #“, „Num 1“).
(function () {
  "use strict";

  /** Windows-Tastencode (event.keyCode) → Electron-Name */
  const OEM = { 0xba: ";", 0xbb: "=", 0xbc: ",", 0xbd: "-", 0xbe: ".", 0xbf: "/", 0xc0: "`", 0xdb: "[", 0xdc: "\\", 0xdd: "]", 0xde: "'" };
  const NUM = { 0x6a: "nummult", 0x6b: "numadd", 0x6d: "numsub", 0x6e: "numdec", 0x6f: "numdiv" };
  const NUM_LABEL = { nummult: "Num ×", numadd: "Num +", numsub: "Num −", numdec: "Num ,", numdiv: "Num ÷" };
  const SPECIAL = { 0x20: ["Space", "Leertaste"], 0x09: ["Tab", "Tab"], 0x0d: ["Enter", "Enter"], 0x26: ["Up", "↑"], 0x28: ["Down", "↓"], 0x25: ["Left", "←"], 0x27: ["Right", "→"],
    0x24: ["Home", "Pos1"], 0x23: ["End", "Ende"], 0x21: ["PageUp", "Bild ↑"], 0x22: ["PageDown", "Bild ↓"], 0x2d: ["Insert", "Einfg"], 0x2e: ["Delete", "Entf"], 0x13: ["Pause", "Pause"] };
  const MOD_LABEL = { Control: "Strg", Alt: "Alt", Shift: "Umschalt", Super: "Win" };
  const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "AltGraph", "OS"]);

  /** Taste (ohne Umschalter) → { acc, label, alone } – alone = darf auch ohne Strg/Alt benutzt werden */
  function keyOf(e) {
    const c = e.keyCode;
    // Ziffernblock nach Position erkennen: bei ausgeschaltetem Num-Lock meldet Windows sonst „Ende“, „Pfeil“ …
    const np = /^Numpad(\d|Add|Subtract|Multiply|Divide|Decimal)$/.exec(e.code || "");
    if (np) {
      const acc = /\d/.test(np[1]) ? "num" + np[1] : { Add: "numadd", Subtract: "numsub", Multiply: "nummult", Divide: "numdiv", Decimal: "numdec" }[np[1]];
      return { acc, label: NUM_LABEL[acc] || "Num " + np[1], alone: true, numpad: true };
    }
    if (c >= 0x41 && c <= 0x5a) return { acc: String.fromCharCode(c), label: String.fromCharCode(c) };
    if (c >= 0x30 && c <= 0x39) return { acc: String.fromCharCode(c), label: String.fromCharCode(c) };
    if (c >= 0x70 && c <= 0x87) return { acc: "F" + (c - 0x6f), label: "F" + (c - 0x6f), alone: true };
    if (c >= 0x60 && c <= 0x69) return { acc: "num" + (c - 0x60), label: "Num " + (c - 0x60), alone: true };
    if (NUM[c]) return { acc: NUM[c], label: NUM_LABEL[NUM[c]], alone: true };
    if (SPECIAL[c]) return { acc: SPECIAL[c][0], label: SPECIAL[c][1], alone: c === 0x13 };
    if (OEM[c]) {
      // Anzeige: das Zeichen, das die Taste auf dieser Tastatur schreibt (deutsch: # ü ö ä + …)
      const shown = e.key && e.key.length === 1 ? e.key : OEM[c];
      return { acc: OEM[c], label: shown.toUpperCase() };
    }
    return null;
  }

  /**
   * Tastendruck → { acc, label } | { partial: "Strg + …" } (nur Umschalter gedrückt) | null (Taste nicht nutzbar)
   * Erlaubt: Umschalter + Taste (z. B. Strg + #, Strg + Num 1), oder allein F-Tasten, Ziffernblock, Pause.
   */
  function fromEvent(e) {
    const mods = [e.ctrlKey && "Control", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(Boolean);
    if (MODIFIER_KEYS.has(e.key)) return mods.length ? { partial: mods.map((m) => MOD_LABEL[m]).join(" + ") + " + …" } : null;
    const k = keyOf(e);
    if (!k) return null;
    if (!mods.length && !k.alone) return null;
    // Strg/Alt/Win + Taste; nur Umschalt + Buchstabe würde Großschreibung blockieren
    if (mods.length === 1 && mods[0] === "Shift" && !k.alone) return null;
    return { acc: [...mods, k.acc].join("+"), label: [...mods.map((m) => MOD_LABEL[m]), k.label].join(" + ") };
  }

  /** Gespeicherte Kombination lesbar machen (für alte Einstellungen ohne gespeicherten Anzeigenamen) */
  function pretty(acc) {
    if (!acc) return "keine";
    return acc.split("+").map((p) => MOD_LABEL[p] || (p === "Space" ? "Leertaste" : /^num\d$/.test(p) ? "Num " + p.slice(3) : NUM_LABEL[p] || p)).join(" + ");
  }

  const api = { fromEvent, pretty, keyOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.Hotkey = api;
})();
