// CommandWave – der Assistent: Mods laden, gesprochenen Text verstehen, Aktion ausführen, Antwort liefern.
const P = require("./phrases");
const { loadAll } = require("./mods");

const UNKNOWN = "Diesen Befehl kenne ich leider nicht.";
const FAILED = "Das hat leider nicht geklappt.";
const NOTHING = "Ich habe nichts gehört.";
/** Antworten des Assistenten je Sprache */
const TEXT = {
  de: { unknown: UNKNOWN, failed: FAILED, nothing: NOTHING, unsure: "Das habe ich nicht sicher verstanden. Sag es bitte noch einmal.",
    didYouMean: (t) => `Meintest du „${t}“?`, cancel: "Okay, dann nicht." },
  en: { unknown: "Sorry, I don't know that command.", failed: "Sorry, that didn't work.", nothing: "I didn't hear anything.", unsure: "I'm not sure I understood that. Please say it again.",
    didYouMean: (t) => `Did you mean "${t}"?`, cancel: "Okay, never mind." },
};
const LANGS = ["de", "en"];
const SURE = 0.66; // ab hier wird ein Befehl direkt ausgeführt
const NEAR = 0.45; // darunter: unbekannt; dazwischen: „Meintest du …?“
const PENDING_MS = 30000;
const WORDS = "_woerter"; // gelernte eigene Wörter (für frei erkannten Text, z. B. Suchbegriffe)

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
    this.aliases = {}; // gelernte Aussprache: { app: { "note pad": { key: "editor", lang: "de" } } }
    this.pending = null; // Befehl, der auf „ja“ wartet
  }

  /** Gelernte Aussprache setzen und Grammatik neu bauen */
  setAliases(aliases) {
    this.aliases = aliases || {};
    return this.reload();
  }

  /** Zusätzliche Platzhalter-Werte (installierte Apps) setzen und Grammatik neu bauen */
  setExtraSlots(extra) {
    this.extraSlots = extra || {};
    return this.reload();
  }

  reload(disabled = this.opts.disabled || []) {
    const host = { actions: this.opts.actions, say: this.opts.say, notify: this.opts.notify, log: this.opts.log, dataDir: this.opts.dataDir, sound: this.opts.sound, reveal: this.opts.reveal };
    const r = loadAll(this.opts.modsDir, host, disabled);
    this.mods = r.mods;
    this.errors = r.errors;
    this.slots = { ...r.slots };
    for (const [name, values] of Object.entries(this.extraSlots)) if (this.slots[name]) this.slots[name] = { ...values, ...this.slots[name] };
    // gelernte Aussprache: weiterer Name für einen vorhandenen Wert (nur in der Grammatik der Sprache, in der er gelernt wurde)
    for (const [name, list] of Object.entries(this.aliases)) {
      const values = this.slots[name];
      if (!values) continue;
      for (const [heard, a] of Object.entries(list || {})) {
        const v = values[a?.key];
        if (v === undefined || values[heard] !== undefined) continue;
        values[heard] = v && typeof v === "object" ? { ...v, lang: a.lang || v.lang } : { value: v, label: a.key, lang: a.lang };
      }
    }
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
  /**
   * opts: unsure (Erkennung unsicher → nachfragen), confirm:false (eingetippt → nie nachfragen),
   *       free: "<Befehl>" (Text kommt aus der freien Erkennung derselben Aufnahme – nur gegen diesen Befehl abgleichen),
   *       noFree (keine Aufnahme da → freien Rest weglassen, der Befehl fragt dann nach)
   */
  async handleMulti(cands, fallbackLang = "de", opts = {}) {
    if (opts.free) return this.handleFree_(cands, opts.free, fallbackLang);
    const best = this.best_(cands);
    if (!best) return { ok: false, say: TEXT[fallbackLang].nothing, heard: "", nothing: true, lang: fallbackLang };
    const T = TEXT[best.lang];
    // Befehl mit freiem Rest („spiel lieder von {frei}“): Die Befehls-Erkennung kennt Namen nicht und hört etwas
    // Falsches – das Fenster soll dieselbe Aufnahme frei erkennen lassen und den Text nochmal schicken
    if (best.m && best.m.score >= SURE && P.hasFree(best.m.command) && best.m.slots[P.FREE]) {
      if (opts.confirm === false) return this.run_(best.text, this.withWords_(best.m), best.lang); // eingetippt: Text stimmt
      if (!opts.noFree) return { ok: false, needFree: true, command: best.m.command.id, heard: best.text, lang: best.lang };
      const m = { ...best.m, slots: { ...best.m.slots } };
      delete m.slots[P.FREE];
      return this.run_(best.text, m, best.lang);
    }
    // knapp daneben (oder die Erkennung war unsicher): nachfragen statt raten – „ja“ führt ihn dann aus
    if (best.m && opts.confirm !== false && (best.m.score < SURE || opts.unsure)) {
      const text = P.sayable(best.m);
      this.pending = { heard: best.text, m: best.m, lang: best.lang, at: Date.now() };
      return { ok: false, confirm: true, say: T.didYouMean(text), suggestion: text, heard: best.text, command: best.m.command.id, lang: best.lang };
    }
    if (opts.unsure && !best.m) return { ok: false, say: T.unsure, heard: best.text, lang: best.lang };
    return this.run_(best.text, best.m && best.m.score >= SURE ? best.m : null, best.lang);
  }

  /** Freier Text derselben Aufnahme → nur gegen den Befehl abgleichen, der den freien Rest braucht */
  async handleFree_(cands, id, fallbackLang) {
    const c = (cands || []).find((x) => clean(x.text)) || null;
    const cmd = this.compiled.find((x) => x.id === id);
    if (!c || !cmd) return { ok: false, say: TEXT[fallbackLang].unknown, heard: "", lang: fallbackLang };
    const lang = cmd.lang || "de";
    const text = clean(c.text);
    // die freie Erkennung hört den Befehlsanfang manchmal leicht anders („spiel lieder vom …“) – großzügig abgleichen
    let m = P.match(text, [cmd], this.slots, NEAR);
    if (!m || !m.slots[P.FREE]) {
      // Notlösung: Wörter nach dem letzten bekannten Befehlswort als freien Rest nehmen
      const known = new Set(cmd.variants.flat().filter((p) => p.t === "w").map((p) => p.v));
      const words = text.split(" ");
      let k = 0;
      for (let i = 0; i < Math.min(words.length, 6); i++) if (known.has(words[i])) k = i + 1;
      const rest = words.slice(k).join(" ");
      if (!rest) return { ok: false, say: TEXT[lang].unsure, heard: text, lang };
      m = { command: cmd, score: NEAR, slots: { [P.FREE]: { key: rest, value: rest, heard: rest } } };
    }
    return this.run_(text, this.withWords_(m), lang);
  }

  /** Eigene Wörter (DoctorBenx, SDP …) im freien Rest einsetzen */
  withWords_(m) {
    const f = m.slots[P.FREE];
    if (!f) return m;
    // erst gelernte Wörter, dann einzeln gehörte Buchstaben zur Abkürzung: „s d p“ → „SDP“
    const t = P.applyWords(f.key, this.aliases[WORDS]).replace(/\b\p{L}(?: \p{L}\b)+/gu, (m) => m.replace(/ /g, "").toUpperCase());
    return { ...m, slots: { ...m.slots, [P.FREE]: { ...f, key: t, value: t } } };
  }

  /** Beste Erkennung: Abgleich zählt am meisten, die Sicherheit der Erkennung entscheidet bei ähnlichen Treffern */
  best_(cands) {
    const list = (cands || []).map((c) => ({ ...c, lang: LANGS.includes(c.lang) ? c.lang : "de", text: clean(c.text) })).filter((c) => c.text);
    let best = null;
    for (const c of list) {
      const m = P.match(c.text, this.byLang[c.lang], this.slots, NEAR);
      const rank = m ? m.score + 0.15 * (c.conf ?? 0.7) : -1;
      if (!best || rank > best.rank) best = { ...c, m, rank };
    }
    return best;
  }

  /** Antwort auf „Meintest du …?“: text = was gesagt wurde (ja/nein) → Ergebnis */
  async answerConfirm(text) {
    const p = this.pending;
    this.pending = null;
    const lang = p?.lang || "de";
    if (!p || Date.now() - p.at > PENDING_MS) return { ok: false, say: "", heard: clean(text), lang };
    const yes = P.yesNo(text);
    if (yes === true) return this.run_(p.heard, p.m, lang);
    return { ok: false, say: TEXT[lang].cancel, heard: clean(text), lang, cancelled: true };
  }

  /** Nur zeigen, was verstanden würde (Mikrofon-Test) – nichts ausführen */
  preview(cands) {
    const best = this.best_(cands);
    if (!best) return { heard: "", lang: null, command: null };
    const m = best.m;
    const mod = m && this.mods.find((x) => x.id === m.command.mod);
    return { heard: best.text, lang: best.lang, conf: best.conf ?? null, command: m?.command.id || null, mod: mod?.name || null, score: m ? Math.round(m.score * 100) / 100 : 0,
      sure: !!m && m.score >= SURE, suggestion: m ? P.sayable(m) : "" };
  }

  /** Gesprochenen Text verarbeiten → { ok, say, heard, command, mod, score, lang } */
  async handle(text, lang = "de") {
    const heard = clean(text);
    if (!heard) return { ok: false, say: TEXT[lang].nothing, heard, nothing: true, lang };
    return this.run_(heard, P.match(heard, this.byLang[lang], this.slots, SURE), lang);
  }

  async run_(heard, m, lang) {
    const T = TEXT[lang] || TEXT.de;
    if (!m) return { ok: false, say: T.unknown, heard, lang };
    const c = m.command;
    const ctx = { text: heard, slots: m.slots, score: m.score, lang, say: this.opts.say, fill: (t) => P.fill(t, m.slots, {}, lang),
      // Rückfrage mit freier Antwort (z. B. „Was soll ich suchen?“) → Promise<Text | null>
      // eigene Wörter (Namen wie „DoctorBenx“) werden in der Antwort eingesetzt
      ask: async (question) => {
        const t = this.opts.ask ? await this.opts.ask(String(question), lang) : null;
        return t ? P.applyWords(t, this.aliases[WORDS]) : t;
      } };
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

module.exports = { Assistant, UNKNOWN, FAILED, NOTHING, TEXT, LANGS, SURE, NEAR, WORDS, fillDeep };
