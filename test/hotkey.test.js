const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../src/renderer/hotkey");

// Tastendrücke wie Chromium sie unter Windows mit deutscher Tastatur meldet (keyCode = Windows-Tastencode)
const ev = (o) => ({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, key: "", code: "", keyCode: 0, ...o });

test("Strg + # (deutsche Tastatur) und weitere Satzzeichen", () => {
  assert.deepEqual(H.fromEvent(ev({ ctrlKey: true, key: "#", code: "Backslash", keyCode: 0xbf })), { acc: "Control+/", label: "Strg + #" });
  assert.deepEqual(H.fromEvent(ev({ ctrlKey: true, key: "+", code: "BracketRight", keyCode: 0xbb })), { acc: "Control+=", label: "Strg + +" });
  assert.deepEqual(H.fromEvent(ev({ ctrlKey: true, key: "ü", code: "BracketLeft", keyCode: 0xba })), { acc: "Control+;", label: "Strg + Ü" });
  assert.deepEqual(H.fromEvent(ev({ ctrlKey: true, key: "-", code: "Slash", keyCode: 0xbd })), { acc: "Control+-", label: "Strg + -" });
});

test("Ziffernblock: mit Strg/Alt und allein", () => {
  assert.deepEqual(H.fromEvent(ev({ ctrlKey: true, key: "1", code: "Numpad1", keyCode: 0x61 })), { acc: "Control+num1", label: "Strg + Num 1" });
  assert.deepEqual(H.fromEvent(ev({ key: "5", code: "Numpad5", keyCode: 0x65 })), { acc: "num5", label: "Num 5" });
  assert.deepEqual(H.fromEvent(ev({ ctrlKey: true, altKey: true, key: "+", code: "NumpadAdd", keyCode: 0x6b })), { acc: "Control+Alt+numadd", label: "Strg + Alt + Num +" });
  assert.deepEqual(H.fromEvent(ev({ key: "/", code: "NumpadDivide", keyCode: 0x6f })), { acc: "numdiv", label: "Num ÷" });
});

test("Ziffernblock bei ausgeschaltetem Num-Lock (Windows meldet „Ende“ bzw. „Clear“)", () => {
  assert.deepEqual(H.fromEvent(ev({ ctrlKey: true, key: "End", code: "Numpad1", keyCode: 0x23 })), { acc: "Control+num1", label: "Strg + Num 1" });
  assert.deepEqual(H.fromEvent(ev({ key: "Clear", code: "Numpad5", keyCode: 0x0c })), { acc: "num5", label: "Num 5" });
  assert.deepEqual(H.fromEvent(ev({ ctrlKey: true, key: "Delete", code: "NumpadDecimal", keyCode: 0x2e })), { acc: "Control+numdec", label: "Strg + Num ," });
  // „Ende“ auf dem normalen Tastenblock bleibt „Ende“
  assert.deepEqual(H.fromEvent(ev({ ctrlKey: true, key: "End", code: "End", keyCode: 0x23 })), { acc: "Control+End", label: "Strg + Ende" });
});

test("Standard, F-Tasten, Pfeile; Unbrauchbares wird abgelehnt", () => {
  assert.deepEqual(H.fromEvent(ev({ ctrlKey: true, key: " ", code: "Space", keyCode: 0x20 })), { acc: "Control+Space", label: "Strg + Leertaste" });
  assert.deepEqual(H.fromEvent(ev({ key: "F9", code: "F9", keyCode: 0x78 })), { acc: "F9", label: "F9" });
  assert.deepEqual(H.fromEvent(ev({ altKey: true, key: "ArrowUp", code: "ArrowUp", keyCode: 0x26 })), { acc: "Alt+Up", label: "Alt + ↑" });
  assert.deepEqual(H.fromEvent(ev({ ctrlKey: true, shiftKey: true, key: "K", code: "KeyK", keyCode: 0x4b })), { acc: "Control+Shift+K", label: "Strg + Umschalt + K" });
  assert.equal(H.fromEvent(ev({ key: "a", code: "KeyA", keyCode: 0x41 })), null, "Buchstabe allein würde Tippen blockieren");
  assert.equal(H.fromEvent(ev({ shiftKey: true, key: "A", code: "KeyA", keyCode: 0x41 })), null, "Umschalt + Buchstabe = Großbuchstabe");
  assert.equal(H.fromEvent(ev({ ctrlKey: true, key: "Dead", keyCode: 0xdc })).acc, "Control+\\"); // ^-Taste
  assert.deepEqual(H.fromEvent(ev({ ctrlKey: true, key: "Control", code: "ControlLeft", keyCode: 0x11 })), { partial: "Strg + …" });
  assert.equal(H.fromEvent(ev({ key: "Shift", keyCode: 0x10 })), null);
});

test("Anzeige gespeicherter Kombinationen", () => {
  assert.equal(H.pretty("Control+Space"), "Strg + Leertaste");
  assert.equal(H.pretty("Control+num1"), "Strg + Num 1");
  assert.equal(H.pretty("Control+Alt+numadd"), "Strg + Alt + Num +");
  assert.equal(H.pretty(""), "keine");
});
