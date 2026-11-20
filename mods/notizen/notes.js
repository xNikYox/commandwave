// Notizen: Liste aus { id, text, at } (älteste zuerst, Nummer 1 = älteste) – reine Logik, ohne Speicher.
const MAX = 500;

/** Text aufräumen: „merke dir dass …“ → „…“, erster Buchstabe groß */
function cleanText(t) {
  let s = String(t || "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/^(dass|das|bitte|folgendes|that|to)\s+/i, "").replace(/^[:,-]\s*/, "");
  return s ? (s.charAt(0).toUpperCase() + s.slice(1)).slice(0, 500) : "";
}

function add(list, text, now = Date.now()) {
  const t = cleanText(text);
  if (!t) return { list, note: null };
  const note = { id: now.toString(36) + Math.random().toString(36).slice(2, 6), text: t, at: now };
  return { list: [...list, note].slice(-MAX), note };
}

/** Nummer n (1 = älteste) löschen → { list, removed } */
function remove(list, n) {
  if (!Number.isInteger(n) || n < 1 || n > list.length) return { list, removed: null };
  return { list: list.filter((_, i) => i !== n - 1), removed: list[n - 1] };
}

/** Die letzten k mit ihrer Nummer: [{ n, text }] (älteste zuerst) */
function last(list, k = 5) {
  return list.map((x, i) => ({ n: i + 1, text: x.text })).slice(-k);
}

/** Anzeige-Liste fürs Fenster/Overlay: „1. Milch kaufen“ */
const lines = (list) => list.map((x, i) => `${i + 1}. ${x.text}`);

/** Vorlesen: die letzten fünf */
function readOut(list, lang = "de") {
  if (!list.length) return lang === "en" ? "You don't have any notes." : "Du hast keine Notizen.";
  const items = last(list, 5).map((x) => (lang === "en" ? `Number ${x.n}: ${x.text}` : `Nummer ${x.n}: ${x.text}`)).join(". ");
  if (lang === "en") return list.length <= 5 ? `You have ${list.length} ${list.length === 1 ? "note" : "notes"}. ${items}.` : `You have ${list.length} notes, here are the last five. ${items}.`;
  return list.length <= 5 ? `Du hast ${list.length === 1 ? "eine Notiz" : list.length + " Notizen"}. ${items}.` : `Du hast ${list.length} Notizen, hier die letzten fünf. ${items}.`;
}

module.exports = { add, remove, last, lines, readOut, cleanText, MAX };
