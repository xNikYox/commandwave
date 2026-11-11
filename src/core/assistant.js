// CommandWave – der Assistent: Mods laden, gesprochenen Text verstehen, Aktion ausführen, Antwort liefern.
const P = require("./phrases");
const { loadAll } = require("./mods");

const UNKNOWN = "Diesen Befehl kenne ich leider nicht.";
const FAILED = "Das hat leider nicht geklappt.";
const NOTHING = "Ich habe nichts gehört.";

class Assistant {
  /** opts = { modsDir, actions, dataDir, say, notify, log, disabled: [] } */
  constructor(opts) {
    this.opts = opts;
    this.mods = [];
    this.errors = [];
    this.compiled = [];
    this.slots = {};
    this.grammar = ["[unk]"];
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
    this.grammar = P.grammar(this.compiled, this.slots);
    return this.summary();
  }

  summary() {
    return { mods: this.mods, errors: this.errors, commands: this.compiled.length, grammarSize: this.grammar.length };
  }

  /** Gesprochenen Text verarbeiten → { ok, say, heard, command, mod, score } */
  async handle(text) {
    const heard = P.normalize(String(text || "").replace(/\[unk\]/gi, " ")).trim(); // erst [unk] weg, dann Satzzeichen
    if (!heard) return { ok: false, say: NOTHING, heard, nothing: true };
    const m = P.match(heard, this.compiled, this.slots);
    if (!m) return { ok: false, say: UNKNOWN, heard };
    const c = m.command;
    const ctx = { text: heard, slots: m.slots, score: m.score, say: this.opts.say, fill: (t) => P.fill(t, m.slots) };
    try {
      let say = c.say != null ? P.fill(c.say, m.slots) : null;
      if (c.handler) {
        const r = await c.handler(ctx);
        if (typeof r === "string") say = r;
        else if (r && typeof r === "object" && "say" in r) say = r.say;
      } else if (c.action) {
        await this.run(fillDeep(c.action, m.slots));
      }
      return { ok: true, say: say ?? "", heard, command: c.id, mod: c.mod, score: m.score };
    } catch (e) {
      this.opts.log?.("Fehler bei", c.id, e.message);
      return { ok: false, say: FAILED, heard, command: c.id, mod: c.mod, score: m.score, error: e.message };
    }
  }

  async run(action) {
    const fn = this.opts.actions[action.type];
    if (!fn) throw new Error("Unbekannte Aktion " + action.type);
    return fn(action, (a) => this.run(a));
  }
}

/** Platzhalter in allen Texten einer Aktion einsetzen */
function fillDeep(v, slots) {
  if (typeof v === "string") return P.fill(v, slots);
  if (Array.isArray(v)) return v.map((x) => fillDeep(x, slots));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fillDeep(x, slots)]));
  return v;
}

module.exports = { Assistant, UNKNOWN, FAILED, NOTHING, fillDeep };
