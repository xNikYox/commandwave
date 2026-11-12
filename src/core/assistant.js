// CommandWave – der Assistent: Mods laden, gesprochenen Text verstehen, Aktion ausführen, Antwort liefern.
const P = require("./phrases");
const { loadAll } = require("./mods");

const UNKNOWN = "Diesen Befehl kenne ich leider nicht.";
const FAILED = "Das hat leider nicht geklappt.";
const NOTHING = "Ich habe nichts gehört.";
/** Antworten des Assistenten je Sprache */
const TEXT = {
  de: { unknown: UNKNOWN, failed: FAILED, nothing: NOTHING, unsure: "Das habe ich nicht sicher verstanden. Sag es bitte noch einmal." },
  en: { unknown: "Sorry, I don't know that command.", failed: "Sorry, that didn't work.", nothing: "I didn't hear anything.", unsure: "I'm not sure I understood that. Please say it again." },
};
const LANGS = ["de", "en"];

class Assistant {
  /** opts = { modsDir, actions, dataDir, say, notify, log, disabled: [] } */
  constructor(opts) {
    this.opts = opts;
    this.mods = [];
    this.errors = [];
    this.compiled = []; // alle Befehle (beide Sprachen)
    this.byLang = { de: [], en: [] };
    this.slots = {};
    this.grammar = ["[unk]"]; // Deutsch (wie bisher)
    this.grammars = { de: ["[unk]"], en: ["[unk]"] };
    this.extraSlots = {}; // z. B. installierte Apps für {app} – Werte aus Mods haben Vorrang
  }

  /** Zusätzliche Platzhalter-Werte (installierte Apps) setzen und Grammatik neu bauen */
  setExtraSlots(extra) {
    this.extraSlots = extra || {};
    return this.reload();
  }

  reload(disabled = this.opts.disabled || []) {
    const host = { actions: this.opts.actions, say: this.opts.say, notify: this.opts.notify, log: this.opts.log, dataDir: this.opts.dataDir };
    const r = loadAll(this.opts.modsDir, host, disabled);
    this.mods = r.mods;
    this.errors = r.errors;
    this.slots = { ...r.slots };
    for (const [name, values] of Object.entries(this.extraSlots)) if (this.slots[name]) this.slots[name] = { ...values, ...this.slots[name] };
    this.compiled = P.compile(r.commands);
    for (const l of LANGS) this.byLang[l] = this.compiled.filter((c) => (c.lang || "de") === l);
    // Grammatik je Sprache: jedes Muster mit wenigen Beispielwerten, jeder Wert einmal (Hörtest: gleich gut wie
    // alle Sätze, aber ein Bruchteil der Größe – und sie wächst nicht mit jeder installierten App mal jedem Befehl)
    for (const l of LANGS) this.grammars[l] = P.compactGrammar(this.byLang[l], this.slots, 2, l);
    this.grammar = this.grammars.de;
    return this.summary();
  }

  summary() {
    return { mods: this.mods, errors: this.errors, commands: this.compiled.length, grammarSize: this.grammar.length };
  }

  /** Nur zuordnen, nichts ausführen (für Tests) → { command, score, lang } | null */
  matchOnly(text, lang = "de") {
    const m = P.match(P.normalize(String(text || "").replace(/\[unk\]/gi, " ")), this.byLang[lang] || [], this.slots);
    return m ? { command: m.command.id, score: m.score, lang } : null;
  }

  /**
   * Mehrere Erkennungen (z. B. Deutsch + Englisch) → die, die am besten zu einem Befehl passt, ausführen.
   * cands = [{ lang, text, conf }] → Ergebnis wie handle(), plus lang
   */
  async handleMulti(cands, fallbackLang = "de") {
    const list = (cands || []).map((c) => ({ ...c, lang: LANGS.includes(c.lang) ? c.lang : "de", text: clean(c.text) })).filter((c) => c.text);
    if (!list.length) return { ok: false, say: TEXT[fallbackLang].nothing, heard: "", nothing: true, lang: fallbackLang };
    let best = null;
    for (const c of list) {
      const m = P.match(c.text, this.byLang[c.lang], this.slots);
      // Abgleich zählt am meisten, die Sicherheit der Erkennung entscheidet bei ähnlichen Treffern
      const rank = m ? m.score + 0.15 * (c.conf ?? 0.7) : -1;
      if (!best || rank > best.rank) best = { ...c, m, rank };
    }
    return this.run_(best.text, best.m, best.lang);
  }

  /** Gesprochenen Text verarbeiten → { ok, say, heard, command, mod, score, lang } */
  async handle(text, lang = "de") {
    const heard = clean(text);
    if (!heard) return { ok: false, say: TEXT[lang].nothing, heard, nothing: true, lang };
    return this.run_(heard, P.match(heard, this.byLang[lang], this.slots), lang);
  }

  async run_(heard, m, lang) {
    const T = TEXT[lang] || TEXT.de;
    if (!m) return { ok: false, say: T.unknown, heard, lang };
    const c = m.command;
    const ctx = { text: heard, slots: m.slots, score: m.score, lang, say: this.opts.say, fill: (t) => P.fill(t, m.slots, {}, lang) };
    try {
      let say = c.say != null ? P.fill(c.say, m.slots, {}, lang) : null;
      if (c.handler) {
        const r = await c.handler(ctx);
        if (typeof r === "string") say = r;
        else if (r && typeof r === "object" && "say" in r) say = r.say;
      } else if (c.action) {
        await this.run(fillDeep(c.action, m.slots));
      }
      return { ok: true, say: say ?? "", heard, command: c.id, mod: c.mod, score: m.score, lang };
    } catch (e) {
      this.opts.log?.("Fehler bei", c.id, e.message);
      return { ok: false, say: T.failed, heard, command: c.id, mod: c.mod, score: m.score, error: e.message, lang };
    }
  }

  async run(action) {
    const fn = this.opts.actions[action.type];
    if (!fn) throw new Error("Unbekannte Aktion " + action.type);
    return fn(action, (a) => this.run(a));
  }
}

const clean = (t) => P.normalize(String(t || "").replace(/\[unk\]/gi, " ")).trim(); // erst [unk] weg, dann Satzzeichen

/** Platzhalter in allen Texten einer Aktion einsetzen */
function fillDeep(v, slots) {
  if (typeof v === "string") return P.fill(v, slots);
  if (Array.isArray(v)) return v.map((x) => fillDeep(x, slots));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fillDeep(x, slots)]));
  return v;
}

module.exports = { Assistant, UNKNOWN, FAILED, NOTHING, TEXT, LANGS, fillDeep };
