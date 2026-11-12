// CommandWave – Zahlen und Rechnen aus gesprochenem Text (Deutsch + Englisch), komplett offline.
//   „fünfzehn prozent von achtzig“ → 12 · „drei komma fünf mal zwei“ → 7 · „fünf meilen in kilometer“ → 8,05 km
const DE_ONES = { null: 0, ein: 1, eins: 1, eine: 1, einen: 1, einer: 1, zwei: 2, zwo: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9 };
const DE_TEENS = { zehn: 10, elf: 11, zwölf: 12, dreizehn: 13, vierzehn: 14, fünfzehn: 15, sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19 };
const DE_TENS = { zwanzig: 20, dreißig: 30, dreissig: 30, vierzig: 40, fünfzig: 50, sechzig: 60, siebzig: 70, achtzig: 80, neunzig: 90 };
const EN_SMALL = { zero: 0, oh: 0, a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const EN_SCALE = { hundred: 100, thousand: 1000, million: 1e6, billion: 1e9 };
const DE_SCALE = { hundert: 100, tausend: 1000, million: 1e6, millionen: 1e6, milliarde: 1e9, milliarden: 1e9 };

/** Ein deutsches Zahlwort (auch zusammengesetzt: „zweihundertfünfundzwanzig“) → Zahl oder null */
function deWord(w) {
  if (!w) return null;
  if (/^\d+([.,]\d+)?$/.test(w)) return Number(w.replace(",", "."));
  if (w in DE_ONES) return DE_ONES[w];
  if (w in DE_TEENS) return DE_TEENS[w];
  if (w in DE_TENS) return DE_TENS[w];
  if (w in DE_SCALE) return DE_SCALE[w];
  for (const [s, f] of [["millionen", 1e6], ["million", 1e6], ["tausend", 1000], ["hundert", 100]]) {
    const i = w.indexOf(s);
    if (i < 0) continue;
    const head = w.slice(0, i);
    const tail = w.slice(i + s.length);
    const h = head ? deWord(head) : 1;
    const t = tail ? deWord(tail.replace(/^und/, "")) : 0;
    if (h == null || t == null) return null;
    return h * f + t;
  }
  const m = /^(.+?)und(.+)$/.exec(w); // „fünfundzwanzig“
  if (m && m[2] in DE_TENS) {
    const o = DE_ONES[m[1]] ?? null;
    return o != null && o > 0 ? DE_TENS[m[2]] + o : null;
  }
  return null;
}

/**
 * Zahl am Anfang einer Wortliste lesen → { value, used } oder null.
 * Deutsch: „ein und zwanzig“, „zwei hundert“, „drei komma fünf“ · Englisch: „twenty five“, „a hundred“, „three point five“
 */
function readNumber(words, i = 0, lang = "de") {
  let total = 0;
  let cur = 0;
  let j = i;
  let any = false;
  const isWord = (w) => (lang === "en" ? w in EN_SMALL || w in EN_SCALE || /^\d/.test(w) : deWord(w) != null);
  while (j < words.length) {
    const w = words[j];
    if (lang === "en") {
      if (w === "a" && !(words[j + 1] in EN_SCALE)) break; // „a“ nur in „a hundred“
      if (w === "and" && any && isWord(words[j + 1] || "")) {
        j++;
        continue;
      }
      if (/^\d+([.,]\d+)?$/.test(w)) cur += Number(w.replace(",", "."));
      else if (w in EN_SMALL) cur += EN_SMALL[w];
      else if (w in EN_SCALE) {
        const f = EN_SCALE[w];
        if (f === 100) cur = (cur || 1) * 100;
        else (total += (cur || 1) * f), (cur = 0);
      } else break;
    } else {
      // „ein und zwanzig“ (getrennt erkannt)
      if (w === "und" && any && words[j + 1] in DE_TENS) {
        cur += DE_TENS[words[j + 1]];
        j += 2;
        continue;
      }
      const v = deWord(w);
      if (v == null) break;
      if (w in DE_SCALE) {
        if (v === 100) cur = (cur || 1) * 100;
        else (total += (cur || 1) * v), (cur = 0);
      } else cur += v;
    }
    any = true;
    j++;
  }
  if (!any) return null;
  let value = total + cur;
  // Nachkommastellen: „komma fünf“, „point two five“
  if ((words[j] === "komma" || words[j] === "point") && j + 1 < words.length) {
    let digits = "";
    let k = j + 1;
    while (k < words.length) {
      const d = lang === "en" ? EN_SMALL[words[k]] : DE_ONES[words[k]];
      if (d == null || d > 9 || (words[k] === "a" && lang === "en")) break;
      digits += d;
      k++;
    }
    if (!digits && k < words.length) {
      const r = readNumber(words, j + 1, lang);
      if (r) (digits = String(r.value)), (k = j + 1 + r.used);
    }
    if (digits) (value = Number(value + "." + digits)), (j = k);
  }
  return { value, used: j - i };
}

/** Zahlwort für 0..999 (für Platzhalter-Werte in der Grammatik) */
function toWords(n, lang = "de") {
  if (lang === "en") {
    const names = Object.entries(EN_SMALL).filter(([k]) => !["oh", "a"].includes(k)).reduce((m, [k, v]) => ((m[v] = k), m), {});
    if (n < 20) return names[n];
    if (n < 100) return names[n - (n % 10)] + (n % 10 ? " " + names[n % 10] : "");
    return names[Math.floor(n / 100)] + " hundred" + (n % 100 ? " " + toWords(n % 100, "en") : "");
  }
  const ones = ["null", "eins", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun"];
  const tens = ["", "", "zwanzig", "dreißig", "vierzig", "fünfzig", "sechzig", "siebzig", "achtzig", "neunzig"];
  const teens = ["zehn", "elf", "zwölf", "dreizehn", "vierzehn", "fünfzehn", "sechzehn", "siebzehn", "achtzehn", "neunzehn"];
  if (n < 10) return ones[n];
  if (n < 20) return teens[n - 10];
  if (n < 100) return (n % 10 ? (n % 10 === 1 ? "ein" : ones[n % 10]) + "und" : "") + tens[Math.floor(n / 10)];
  const h = Math.floor(n / 100);
  return (h === 1 ? "ein" : ones[h]) + "hundert" + (n % 100 ? toWords(n % 100, "de").replace(/^eins$/, "eins") : "");
}

/** Platzhalter-Werte { "fünfundzwanzig": 25, … } für 0..max */
function slotValues(lang = "de", max = 100) {
  const out = {};
  for (let n = 0; n <= max; n++) out[toWords(n, lang)] = n;
  if (lang === "de") Object.assign(out, { ein: 1, eine: 1, einen: 1 });
  return out;
}

/* ---------------- Einheiten ---------------- */
// Faktor zur Basiseinheit (Länge: Meter, Gewicht: Kilogramm, Volumen: Liter, Tempo: m/s, Fläche: m²); Temperatur extra
const UNITS = [
  { kind: "len", f: 1000, de: "Kilometer", en: "kilometers", names: ["kilometer", "kilometern", "kilometers", "kilometre", "kilometres", "km"] },
  { kind: "len", f: 1, de: "Meter", en: "meters", names: ["meter", "metern", "meters", "metre", "metres"] },
  { kind: "len", f: 0.01, de: "Zentimeter", en: "centimeters", names: ["zentimeter", "zentimetern", "centimeter", "centimeters", "cm"] },
  { kind: "len", f: 0.001, de: "Millimeter", en: "millimeters", names: ["millimeter", "millimetern", "millimeters"] },
  { kind: "len", f: 1609.344, de: "Meilen", en: "miles", names: ["meile", "meilen", "mile", "miles"] },
  { kind: "len", f: 0.3048, de: "Fuß", en: "feet", names: ["fuß", "fuss", "feet", "foot"] },
  { kind: "len", f: 0.0254, de: "Zoll", en: "inches", names: ["zoll", "inch", "inches"] },
  { kind: "len", f: 0.9144, de: "Yards", en: "yards", names: ["yard", "yards"] },
  { kind: "mass", f: 1, de: "Kilogramm", en: "kilograms", names: ["kilogramm", "kilo", "kilos", "kilogram", "kilograms"] },
  { kind: "mass", f: 0.001, de: "Gramm", en: "grams", names: ["gramm", "gram", "grams"] },
  { kind: "mass", f: 1000, de: "Tonnen", en: "tons", names: ["tonne", "tonnen", "ton", "tons", "tonnes"] },
  { kind: "mass", f: 0.45359237, de: "Pfund", en: "pounds", names: ["pfund", "pound", "pounds", "lbs"] },
  { kind: "mass", f: 0.028349523125, de: "Unzen", en: "ounces", names: ["unze", "unzen", "ounce", "ounces"] },
  { kind: "vol", f: 1, de: "Liter", en: "liters", names: ["liter", "litern", "liters", "litre", "litres"] },
  { kind: "vol", f: 0.001, de: "Milliliter", en: "milliliters", names: ["milliliter", "millilitern", "milliliters"] },
  { kind: "vol", f: 3.785411784, de: "Gallonen", en: "gallons", names: ["gallone", "gallonen", "gallon", "gallons"] },
  { kind: "speed", f: 1 / 3.6, de: "Kilometer pro Stunde", en: "kilometers per hour", names: ["stundenkilometer", "kilometer pro stunde", "kilometers per hour", "km/h", "kmh"] },
  { kind: "speed", f: 0.44704, de: "Meilen pro Stunde", en: "miles per hour", names: ["meilen pro stunde", "miles per hour", "mph"] },
  { kind: "speed", f: 1, de: "Meter pro Sekunde", en: "meters per second", names: ["meter pro sekunde", "meters per second"] },
  { kind: "speed", f: 0.514444, de: "Knoten", en: "knots", names: ["knoten", "knots"] },
  { kind: "temp", t: "c", de: "Grad Celsius", en: "degrees Celsius", names: ["grad celsius", "celsius", "grad", "degrees celsius"] },
  { kind: "temp", t: "f", de: "Grad Fahrenheit", en: "degrees Fahrenheit", names: ["grad fahrenheit", "fahrenheit", "degrees fahrenheit"] },
  { kind: "temp", t: "k", de: "Kelvin", en: "kelvin", names: ["kelvin"] },
];
/** Einheit am Anfang der Wortliste → { unit, used } (längster Name gewinnt) */
function readUnit(words, i) {
  let best = null;
  for (const u of UNITS) for (const n of u.names) {
    const parts = n.split(" ");
    if (parts.every((p, k) => words[i + k] === p) && (!best || parts.length > best.used)) best = { unit: u, used: parts.length };
  }
  return best;
}
const toC = (v, t) => (t === "c" ? v : t === "f" ? ((v - 32) * 5) / 9 : v - 273.15);
const fromC = (c, t) => (t === "c" ? c : t === "f" ? (c * 9) / 5 + 32 : c + 273.15);

/* ---------------- Rechnen ---------------- */
const OPS = [
  // [Wörter, Zeichen] – längste zuerst prüfen
  [["geteilt durch"], "/"], [["dividiert durch"], "/"], [["divided by"], "/"], [["multipliziert mit"], "*"], [["multiplied by"], "*"],
  [["prozent von"], "%of"], [["percent of"], "%of"], [["to the power of"], "^"], [["hoch"], "^"], [["durch"], "/"], [["over"], "/"],
  [["plus"], "+"], [["und"], "+"], [["minus"], "-"], [["weniger"], "-"], [["mal"], "*"], [["times"], "*"], [["x"], "*"],
];
const PRE = { "wurzel aus": "sqrt", "die wurzel aus": "sqrt", "quadratwurzel aus": "sqrt", "square root of": "sqrt", "the square root of": "sqrt" };
const FILL = new Set(["was", "ist", "sind", "wie", "viel", "rechne", "berechne", "bitte", "mal", "what", "is", "whats", "how", "much", "calculate", "please", "the", "das", "ergebnis", "von", "gleich", "equals"]);

/**
 * Gesprochene Rechnung/Umrechnung → { kind: "calc"|"convert", value, text } oder null.
 * text = fertige Antwort in der Sprache lang.
 */
function evaluate(input, lang = "de") {
  const words = String(input || "").toLowerCase().replace(/[?!.]/g, " ").replace(/(\d),(\d)/g, "$1.$2").replace(/[,]/g, " ").replace(/%/g, " prozent ").replace(/\+/g, " plus ").replace(/\*/g, " mal ").replace(/(\d)\s*-\s*(\d)/g, "$1 minus $2").split(/\s+/).filter(Boolean);
  // Füllwörter am Anfang weg („was ist“, „rechne mal“, „what is“)
  let i = 0;
  while (i < words.length && FILL.has(words[i]) && !readNumber(words, i, lang)) i++;
  const conv = convert(words.slice(i), lang);
  if (conv) return conv;
  // Ausdruck einlesen: Zahl (op Zahl)*
  const toks = [];
  while (i < words.length) {
    const pre = Object.keys(PRE).find((p) => p.split(" ").every((x, k) => words[i + k] === x));
    if (pre) {
      toks.push({ fn: PRE[pre] });
      i += pre.split(" ").length;
      continue;
    }
    const n = readNumber(words, i, lang) || readNumber(words, i, lang === "de" ? "en" : "de");
    if (n) {
      toks.push({ num: n.value });
      i += n.used;
      if (words[i] === "prozent" || words[i] === "percent") {
        if (!(words[i + 1] === "von" || words[i + 1] === "of")) {
          toks[toks.length - 1].num /= 100;
          i++;
        }
      }
      if (words[i] === "quadrat" || words[i] === "squared") (toks.push({ op: "^" }, { num: 2 }), i++);
      continue;
    }
    const op = OPS.find(([w]) => w[0].split(" ").every((x, k) => words[i + k] === x));
    if (op && toks.length && toks[toks.length - 1].num != null) {
      toks.push({ op: op[1] });
      i += op[0][0].split(" ").length;
      continue;
    }
    if (FILL.has(words[i]) || words[i] === "von" || words[i] === "of") {
      i++;
      continue;
    }
    return null; // unbekanntes Wort
  }
  const value = calc(toks);
  if (value != null && !Number.isFinite(value)) return { kind: "calc", value: null, text: lang === "en" ? "You can't divide by zero." : "Durch null kann man nicht teilen." };
  if (value == null || Number.isNaN(value)) return null;
  return { kind: "calc", value, text: (lang === "en" ? "That's " : "Das ergibt ") + fmt(value, lang) + "." };
}

/** Tokens mit Punkt-vor-Strich ausrechnen */
function calc(toks) {
  // Funktionen (Wurzel) auf die folgende Zahl anwenden
  const t = [];
  for (let k = 0; k < toks.length; k++) {
    if (toks[k].fn) {
      if (toks[k + 1]?.num == null) return null;
      t.push({ num: Math.sqrt(toks[k + 1].num) });
      k++;
    } else t.push(toks[k]);
  }
  if (!t.length || t[0].num == null) return null;
  for (let k = 1; k < t.length; k += 2) if (!t[k].op || t[k + 1]?.num == null) return null;
  const apply = (ops, f) => {
    for (let k = 1; k < t.length; ) {
      if (ops.includes(t[k].op)) t.splice(k - 1, 3, { num: f(t[k - 1].num, t[k].op, t[k + 1].num) });
      else k += 2;
    }
  };
  apply(["^"], (a, _o, b) => a ** b);
  apply(["*", "/", "%of"], (a, o, b) => (o === "*" ? a * b : o === "/" ? a / b : (a / 100) * b));
  apply(["+", "-"], (a, o, b) => (o === "+" ? a + b : a - b));
  return t.length === 1 ? t[0].num : null;
}

/** „fünf meilen in kilometer“, „zwanzig grad in fahrenheit“ → Antwort */
function convert(words, lang) {
  const n = readNumber(words, 0, lang) || readNumber(words, 0, lang === "de" ? "en" : "de");
  if (!n) return null;
  let i = n.used;
  const from = readUnit(words, i);
  if (!from) return null;
  i += from.used;
  if (!["in", "nach", "zu", "to", "into"].includes(words[i])) return null;
  i++;
  if (["die", "den", "der"].includes(words[i])) i++;
  const to = readUnit(words, i);
  if (!to || to.unit.kind !== from.unit.kind) return null;
  const a = from.unit;
  const b = to.unit;
  const value = a.kind === "temp" ? fromC(toC(n.value, a.t), b.t) : (n.value * a.f) / b.f;
  const name = (u) => (lang === "en" ? u.en : u.de);
  const text = lang === "en" ? `${fmt(n.value, lang)} ${name(a)} is ${fmt(value, lang)} ${name(b)}.` : `${fmt(n.value, lang)} ${name(a)} sind ${fmt(value, lang)} ${name(b)}.`;
  return { kind: "convert", value, text };
}

/** Zahl zum Vorlesen: höchstens 2 Nachkommastellen (bei sehr kleinen Zahlen mehr) */
function fmt(v, lang = "de") {
  const digits = Math.abs(v) < 0.01 && v !== 0 ? 6 : 2;
  return v.toLocaleString(lang === "en" ? "en-US" : "de-DE", { maximumFractionDigits: digits, useGrouping: false });
}

module.exports = { readNumber, deWord, toWords, slotValues, evaluate, convert, calc, fmt, UNITS };
