// Dateinamen nach Ähnlichkeit zum gesprochenen Suchbegriff ordnen – ohne Windows, gut testbar.
// Die Erkennung schreibt Namen oft anders („bewerbung mueller“, „muller“ für „Bewerbung_Müller_2024.docx“):
// verglichen wird Wort für Wort mit Tippfehler-Toleranz, Umlaute in beiden Schreibweisen, Endung egal.
const path = require("node:path");

const MIN = 0.45; // darunter zählt eine Datei nicht als Treffer
const SURE = 0.6; // ab hier und mit klarem Abstand: gleich öffnen
const MARGIN = 0.15; // so viel besser als der Zweite muss der Beste sein
const RECENT = 0.03; // fast gleich gut: die neuere Datei gewinnt

/** Name ohne Endung („Bericht.final.docx“ → „Bericht.final“) */
const stem = (name) => String(name || "").replace(/\.[a-z0-9]{1,5}$/i, "");

/** Text → Wörter in zwei Schreibweisen: ä → ae und ä → a (ß → ss), klein, an _ - . und Leerzeichen getrennt */
function tokens(text) {
  const base = String(text || "").toLowerCase().replace(/ß/g, "ss");
  const split = (t) => t.normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter(Boolean);
  const ae = split(base.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue"));
  const plain = split(base);
  return { ae, plain };
}

/** Ähnlichkeit zweier Wörter 0..1 (Levenshtein); Wortanfang („rech“ → „rechnung“) zählt auch */
function wordSim(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  if (a.length >= 4 && b.startsWith(a)) return 0.9;
  if (b.length >= 4 && a.startsWith(b)) return 0.85;
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  const sim = 1 - prev[n] / Math.max(m, n);
  return Math.max(m, n) <= 3 ? (prev[n] === 0 ? 1 : 0) : sim;
}

/** Wortliste q gegen Wortliste f: jedes Suchwort sein bestes Gegenstück; zusätzliche Wörter im Namen kosten etwas */
function listScore(q, f) {
  if (!q.length || !f.length) return 0;
  const used = new Set();
  let sum = 0;
  for (const w of q) {
    let best = 0;
    let at = -1;
    f.forEach((x, i) => {
      const s = wordSim(w, x);
      if (s > best) (best = s), (at = i);
    });
    if (best >= 0.6) (sum += best), used.add(at);
  }
  const cover = sum / q.length;
  // Zahlen im Namen (2024, 03) sind meist Beiwerk und kosten nichts
  const words = f.filter((x) => !/^\d+$/.test(x)).length || 1;
  return cover * 0.85 + 0.15 * Math.min(1, [...used].filter((i) => !/^\d+$/.test(f[i])).length / words);
}

/** Wie gut passt der Dateiname zum Suchbegriff? → 0..1 */
function score(query, name) {
  const q = tokens(query);
  const f = tokens(stem(name));
  let s = Math.max(listScore(q.ae, f.ae), listScore(q.plain, f.plain));
  // zusammengeschrieben vs. getrennt („bewerbungs schreiben“ ↔ „Bewerbungsschreiben“)
  const qj = q.ae.join("");
  const fj = f.ae.join("");
  if (qj.length >= 6) s = Math.max(s, wordSim(qj, fj) * 0.95);
  return Math.round(s * 1000) / 1000;
}

/** Suchbegriff aufräumen: Füllwörter weg, „punkt pdf“ / „.pdf“ am Ende als gewünschte Endung → { text, ext } */
function parseQuery(text) {
  let t = String(text || "").toLowerCase().replace(/[„“"!?]/g, " ").replace(/\s+/g, " ").trim();
  let ext = null;
  const m = /(?:\s+(?:punkt|dot)\s+|\.)([a-z0-9]{2,5})$/.exec(t);
  if (m) (ext = m[1]), (t = t.slice(0, m.index).trim());
  t = t.replace(/^(die|meine|der|das|the|my)\s+/, "").replace(/\s+(bitte|please)$/, "").trim();
  return { text: t, ext };
}

/**
 * Dateien ordnen: files = [{ path, name, modified }] → [{ …, score }] (beste zuerst, nur ab MIN).
 * Fast gleich gut → die zuletzt geänderte zuerst. Passende Endung („punkt pdf“) gibt einen kleinen Vorsprung.
 */
function rank(query, files) {
  const { text, ext } = parseQuery(query);
  if (!text) return [];
  const seen = new Set();
  const out = [];
  for (const f of files || []) {
    if (!f || !f.path || seen.has(String(f.path).toLowerCase())) continue;
    seen.add(String(f.path).toLowerCase());
    const name = f.name || path.win32.basename(f.path);
    let s = score(text, name);
    if (ext && path.extname(name).toLowerCase() === "." + ext) s += 0.1;
    if (s >= MIN) out.push({ ...f, name, score: s });
  }
  const time = (f) => (f.modified ? new Date(f.modified).getTime() || 0 : 0);
  return out.sort((a, b) => (Math.abs(a.score - b.score) < RECENT ? time(b) - time(a) : b.score - a.score));
}

/** Klarer Treffer? → { open } | { choose: [bis zu 5] } | { none: true } */
function decide(ranked) {
  if (!ranked || !ranked.length) return { none: true };
  const [a, b] = ranked;
  if (a.score >= SURE && (!b || a.score - b.score >= MARGIN)) return { open: a };
  return { choose: ranked.slice(0, 5) };
}

/** Anzeige in der Liste: „Bewerbung Müller 2024.docx – Dokumente“ */
const label = (f) => `${f.name} – ${f.folder || path.win32.basename(path.win32.dirname(f.path)) || f.path}`;

/** Sprechbarer Name: ohne Endung, _ und - als Leerzeichen, höchstens 40 Zeichen */
function spoken(name) {
  const t = stem(name).replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return t.length > 40 ? t.slice(0, 40).replace(/\s+\S*$/, "") : t;
}

module.exports = { MIN, SURE, MARGIN, tokens, wordSim, score, parseQuery, rank, decide, label, spoken, stem };
