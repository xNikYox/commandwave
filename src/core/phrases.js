// CommandWave – Sätze aus Mods verstehen.
//
// Muster-Schreibweise für Mods:
//   öffne [die app] {app}      [ ... ]  = darf fehlen
//   (mach|mache) {app} auf      (a|b)    = eins davon
//   wie spät ist es             {name}   = Platzhalter, Werte kommen aus "slots" (z. B. App-Namen)
//
// Der Abgleich verzeiht kleine Hörfehler (ähnliche Wörter), Füllwörter wie „bitte“ und fehlende Kleinwörter.

/** Text vereinheitlichen: klein, ohne Satzzeichen, einfache Leerzeichen */
function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[.,!?;:"'„“”‚‘’()\[\]{}…–—-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Muster in Bausteine zerlegen: Wort, Platzhalter, Gruppe (Alternativen), optional */
function parse(pattern) {
  const src = normalizePattern(pattern);
  let i = 0;
  function seq(stop) {
    const out = [];
    let word = "";
    const flush = () => {
      if (word) out.push({ t: "w", v: word });
      word = "";
    };
    while (i < src.length) {
      const c = src[i];
      if (stop.includes(c)) break;
      i++;
      if (c === " ") flush();
      else if (c === "[") {
        flush();
        const inner = alts("]");
        out.push({ t: "opt", v: inner });
      } else if (c === "(") {
        flush();
        out.push({ t: "alt", v: alts(")") });
      } else if (c === "{") {
        flush();
        const end = src.indexOf("}", i);
        out.push({ t: "slot", v: src.slice(i, end).trim() });
        i = end + 1;
      } else word += c;
    }
    flush();
    return out;
  }
  function alts(close) {
    const options = [seq("|" + close)];
    while (src[i] === "|") {
      i++;
      options.push(seq("|" + close));
    }
    if (src[i] === close) i++;
    return options;
  }
  return seq("");
}

function normalizePattern(p) {
  return String(p).toLowerCase().replace(/\s+/g, " ").trim();
}

/** Alle Varianten eines Musters ausschreiben (für die Erkennung als Grammatik) → Listen aus Wörtern/Platzhaltern */
function expand(parts, limit = 500) {
  let acc = [[]];
  for (const p of parts) {
    let next = [];
    if (p.t === "w" || p.t === "slot") next = acc.map((a) => [...a, p]);
    else {
      const options = p.v.flatMap((o) => expand(o, limit));
      if (p.t === "opt") options.push([]);
      for (const a of acc) for (const o of options) next.push([...a, ...o]);
    }
    acc = next.slice(0, limit);
  }
  return acc;
}

/** Ähnlichkeit zweier Wörter 0..1 (Levenshtein), kurze Wörter müssen fast genau stimmen */
function similarity(a, b) {
  if (a === b) return 1;
  const strip = (s) => s.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
  a = strip(a);
  b = strip(b);
  if (a === b) return 0.98;
  const m = a.length;
  const n = b.length;
  if (!m || !n) return 0;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  const sim = 1 - d[m][n] / Math.max(m, n);
  // kurze Wörter: ein Buchstabe Unterschied („ap“/„app“) zählt noch knapp, mehr nicht
  if (Math.max(m, n) <= 3) return d[m][n] <= 1 && Math.min(m, n) >= 2 ? 0.75 : 0;
  return sim;
}

const WORD_MIN = 0.72; // ab hier zählt ein Wort als „gemeint“
const FILLER = new Set(["please", "the", "a", "an", "my", "me", "to", "hey", "can", "could", "you", "would", "just", "now",
  "bitte", "mal", "doch", "jetzt", "einmal", "kurz", "hey", "hallo", "ok", "okay", "äh", "ähm", "also",
  "der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem", "mir", "mich", "uns", "für"]);

/** Bester Platzhalter-Wert für 1–4 Wörter: { key, value, sim } */
function bestSlot(words, values) {
  const span = words.join(" ");
  let best = null;
  for (const key of Object.keys(values || {})) {
    const k = normalize(key);
    const sim = k.includes(" ") ? similarity(span, k) : words.length === 1 ? similarity(span, k) : similarity(span.replace(/ /g, ""), k);
    if (!best || sim > best.sim) best = { key, value: values[key], sim };
  }
  return best && best.sim >= WORD_MIN ? best : null;
}

/**
 * Eine Variante (Liste aus Wörtern/Platzhaltern) mit den gesprochenen Wörtern abgleichen.
 * Bewertung: getroffene Wörter zählen ihre Ähnlichkeit; Füllwörter kosten wenig, fehlende/zusätzliche Wörter mehr.
 * → { score 0..1, slots } oder null
 */
function matchSeq(seq, words, slotValues) {
  const memo = new Map();
  function go(i, j) {
    const key = i * 1000 + j;
    if (memo.has(key)) return memo.get(key);
    let best = null;
    const take = (r, gain, slot) => {
      if (!r) return;
      const cand = { gain: r.gain + gain, slots: slot ? { ...r.slots, ...slot } : r.slots };
      if (!best || cand.gain > best.gain) best = cand;
    };
    if (i === seq.length && j === words.length) best = { gain: 0, slots: {} };
    else {
      const p = seq[i];
      if (p && j < words.length) {
        if (p.t === "w") {
          const sim = similarity(p.v, words[j]);
          if (sim >= WORD_MIN) take(go(i + 1, j + 1), sim);
        } else if (p.t === "slot") {
          for (let len = 1; len <= 4 && j + len <= words.length; len++) {
            const s = bestSlot(words.slice(j, j + len), slotValues[p.v]);
            if (s) take(go(i + 1, j + len), s.sim * 1.5, { [p.v]: { key: s.key, value: s.value, heard: words.slice(j, j + len).join(" ") } });
          }
        }
      }
      // gesprochenes Wort überspringen (Füllwort billig, sonst teuer)
      if (j < words.length) take(go(i, j + 1), FILLER.has(words[j]) ? -0.12 : -0.6);
      // Musterwort fehlt (kurze Wörter wie „die“ eher verzeihlich); Platzhalter dürfen nicht fehlen
      if (p && p.t === "w") take(go(i + 1, j), p.v.length <= 3 ? -0.35 : -0.8);
    }
    memo.set(key, best);
    return best;
  }
  const r = go(0, 0);
  if (!r) return null;
  const max = seq.reduce((a, p) => a + (p.t === "slot" ? 1.5 : 1), 0);
  if (!max) return null;
  return { score: Math.max(0, Math.min(1, r.gain / max)), slots: r.slots };
}

/** Befehle vorbereiten: [{ id, phrases, ... }] → mit ausgeschriebenen Varianten */
function compile(commands) {
  return commands.map((c) => ({ ...c, variants: c.phrases.flatMap((ph) => expand(parse(ph))) }));
}

/**
 * Gesprochenen Text dem besten Befehl zuordnen. slotValues: { app: { editor: …, rechner: … } }
 * → { command, score, slots } oder null (dann: „Diesen Befehl kenne ich leider nicht.“)
 */
function match(text, compiled, slotValues = {}, threshold = 0.66) {
  const words = normalize(text).split(" ").filter(Boolean);
  if (!words.length) return null;
  let best = null;
  for (const c of compiled) {
    for (const v of c.variants) {
      if (v.length > words.length + 4) continue;
      const r = matchSeq(v, words, slotValues);
      if (r && (!best || r.score > best.score)) best = { command: c, score: r.score, slots: r.slots, variant: v };
    }
  }
  return best && best.score >= threshold ? best : null;
}

/** Grammatik für die Spracherkennung: alle Sätze mit eingesetzten Werten (+ „[unk]“ für Unbekanntes) */
function grammar(compiled, slotValues = {}, limit = 6000) {
  const out = new Set();
  for (const c of compiled) {
    for (const v of c.variants) {
      let texts = [""];
      for (const p of v) {
        if (p.t === "w") texts = texts.map((t) => t + " " + p.v);
        else texts = texts.flatMap((t) => Object.keys(slotValues[p.v] || {}).map((k) => t + " " + normalize(k)));
        if (texts.length > 400) texts = texts.slice(0, 400);
      }
      for (const t of texts) {
        out.add(t.trim());
        if (out.size >= limit) break;
      }
      // Füllwörter dürfen auch vorkommen
      for (const t of texts.slice(0, 20)) out.add(("bitte " + t.trim()).trim());
    }
  }
  return [...out, "[unk]"];
}

/** Ja/Nein-Antworten (für Rückfragen) */
const YES = { de: ["ja", "ja bitte", "genau", "richtig", "jawohl", "ja genau"], en: ["yes", "yes please", "yeah", "yep", "correct", "right"] };
const NO = { de: ["nein", "nein danke", "falsch", "abbrechen"], en: ["no", "nope", "no thanks", "cancel", "wrong"] };
/** Antwort → true (ja), false (nein) oder null (weder noch) */
function yesNo(text) {
  const w = normalize(text).split(" ");
  if (w.some((x) => ["nein", "no", "nope", "falsch", "abbrechen", "cancel", "wrong"].includes(x))) return false;
  if (w.some((x) => ["ja", "jawohl", "genau", "richtig", "yes", "yeah", "yep", "correct", "right"].includes(x))) return true;
  return null;
}

/**
 * Eigene Wörter in frei erkanntem Text einsetzen: words = { "deer balance": { key: "DoctorBenx" } }
 * (das Sprachmodell kennt Namen nicht und hört etwas Ähnliches – das wird durch das gelernte Wort ersetzt)
 */
function applyWords(text, words = {}) {
  let out = normalize(text);
  if (!out) return out;
  const list = Object.entries(words || {}).filter(([h, w]) => h && w?.key).sort((a, b) => b[0].length - a[0].length);
  for (const [heard, w] of list) {
    const re = new RegExp(`(^|\\s)${normalize(heard).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$)`, "g");
    out = out.replace(re, (_m, pre) => pre + "\u0000" + w.key + "\u0000");
  }
  return out.replace(/\u0000/g, "");
}

/** Gefundene Variante als sprechbarer Satz („öffne die app editor“) – für „Meintest du …?“ */
function sayable(m) {
  if (!m || !m.variant) return "";
  return m.variant.map((p) => (p.t === "w" ? p.v : m.slots[p.v]?.key || p.v)).join(" ");
}

/**
 * Kompakte Grammatik: jedes Befehlsmuster mit nur wenigen Beispielwerten für Platzhalter, dazu jeder Platzhalter-Wert
 * genau einmal. Vosk macht daraus eine Wortschleife, in der häufige Befehlswörter stärker zählen (wie bei der vollen
 * Satzliste), ohne dass jeder App-Name in jedem Muster wiederholt wird.
 */
function compactGrammar(compiled, slotValues = {}, perSlot = 2, lang = "") {
  const out = new Set();
  // Werte mit "lang" (z. B. „calculator“ nur Englisch) nur in die Grammatik ihrer Sprache – sonst stören sie die Erkennung
  const keysOf = (name) => Object.entries(slotValues[name] || {}).filter(([, v]) => !lang || !v || typeof v !== "object" || !v.lang || v.lang === lang).map(([k]) => k);
  for (const c of compiled) {
    for (const v of c.variants) {
      let texts = [""];
      for (const p of v) {
        if (p.t === "w") texts = texts.map((t) => t + " " + p.v);
        else {
          // kleine Wertelisten (Zahlen, Webseiten …) ganz – nur große (z. B. 100+ Apps) mit wenigen Beispielen
          const keys = keysOf(p.v);
          texts = texts.flatMap((t) => (keys.length <= 30 ? keys : keys.slice(0, perSlot)).map((k) => t + " " + normalize(k)));
        }
        if (texts.length > 400) texts = texts.slice(0, 400);
      }
      for (const t of texts) out.add(t.trim());
    }
  }
  const used = new Set(compiled.flatMap((c) => c.variants.flatMap((v) => v.filter((p) => p.t === "slot").map((p) => p.v))));
  for (const name of used) for (const key of keysOf(name)) out.add(normalize(key));
  out.add(lang === "en" ? "please" : "bitte");
  // Antworten auf „Meintest du …?“
  for (const w of lang === "en" ? YES.en.concat(NO.en) : YES.de.concat(NO.de)) out.add(w);
  return [...out, "[unk]"];
}

/**
 * Wortschatz für die Erkennung: jedes Wort genau einmal. Vosk macht aus der Grammatik ohnehin eine einfache
 * Wort-Schleife – jede Wiederholung eines Wortes wäre ein zusätzlicher Pfad, der nur Rechenzeit kostet.
 * Die Reihenfolge prüft danach der Satz-Abgleich (match).
 */
function vocabulary(compiled, slotValues = {}) {
  const words = new Set();
  const add = (t) => normalize(t).split(" ").forEach((w) => w && words.add(w));
  for (const c of compiled) for (const v of c.variants) for (const p of v) if (p.t === "w") add(p.v);
  const used = new Set(compiled.flatMap((c) => c.variants.flatMap((v) => v.filter((p) => p.t === "slot").map((p) => p.v))));
  for (const name of used) for (const key of Object.keys(slotValues[name] || {})) add(key);
  for (const f of ["bitte", "mal", "den", "die", "das", "der"]) words.add(f); // häufige Füllwörter, die der Abgleich überspringt
  return [...[...words].sort(), "[unk]"];
}

/**
 * Text mit {platzhalter} füllen: {app} → Anzeigename, {app.value} → Wert (bei Objekten target), {app.key} → Schlüssel,
 * {app.heard} → gehörtes Wort, {app.irgendwas} → Eigenschaft des Werts (z. B. {app.process})
 */
function fill(template, slots = {}, extra = {}, lang = "de") {
  return String(template || "").replace(/\{([\w-]+)(?:\.([\w-]+))?\}/g, (m, name, prop) => {
    if (name in extra && !prop) return extra[name];
    const s = slots[name];
    if (!s) return m;
    const v = s.value;
    const obj = typeof v === "object" && v ? v : null;
    if (prop === "value") return obj ? obj.target ?? obj.value ?? "" : v;
    if (prop === "key") return s.key;
    if (prop === "heard") return s.heard;
    if (prop && prop !== "label") return obj && prop in obj ? obj[prop] : m;
    // Anzeigename: auf Englisch label_en (sonst das gesprochene Wort), auf Deutsch label
    if (lang === "en") return obj?.label_en || capitalize(s.key);
    return obj?.label || capitalize(s.key);
  });
}

const capitalize = (s) => String(s).replace(/^\p{L}/u, (c) => c.toUpperCase());

module.exports = { YES, NO, yesNo, sayable, applyWords, normalize, parse, expand, similarity, match, matchSeq, compile, grammar, compactGrammar, vocabulary, fill };
