// Notizen per Sprache – gespeichert im Datenordner (api.storage: mod-data/notizen.json), im Fenster unter „Notizen“.
const N = require("./notes");

module.exports = (api) => {
  const load = () => (api.storage.get().notes || []).filter((x) => x && x.text);
  const save = (notes) => api.storage.set({ notes });
  const num = (lang) => Object.fromEntries(Object.entries(api.numbers.slotValues(lang, 50)).filter(([, v]) => v >= 1).map(([k, v]) => [k, { value: v, label: String(v), lang }]));
  api.slot("notiznummer", num("de"));
  api.slot("notenumber", num("en"));
  const T = {
    de: { ask: "Was soll ich mir merken?", none: "Okay, dann nicht.", saved: (t) => `Ich habe mir gemerkt: ${t}`, title: "Deine Notizen", gone: (n) => `Notiz Nummer ${n} gibt es nicht.`,
      removed: (n, t) => `Notiz Nummer ${n} gelöscht: ${t}`, empty: "Du hast keine Notizen.", sure: (n) => `Soll ich wirklich ${n === 1 ? "die Notiz" : "alle " + n + " Notizen"} löschen?`,
      cleared: (n) => `${n === 1 ? "Eine Notiz" : n + " Notizen"} gelöscht.`, kept: "Okay, die Notizen bleiben." },
    en: { ask: "What should I remember?", none: "Okay, never mind.", saved: (t) => `Got it, I'll remember: ${t}`, title: "Your notes", gone: (n) => `There is no note number ${n}.`,
      removed: (n, t) => `Deleted note number ${n}: ${t}`, empty: "You don't have any notes.", sure: (n) => `Do you really want to delete ${n === 1 ? "the note" : "all " + n + " notes"}?`,
      cleared: (n) => `Deleted ${n === 1 ? "one note" : n + " notes"}.`, kept: "Okay, I'll keep your notes." },
  };

  const remember = async (ctx) => {
    const t = T[ctx.lang];
    // „merke dir milch kaufen“: Text kommt gleich mit (freier Rest), sonst nachfragen
    const text = ctx.slots.frei?.key || (await ctx.ask(t.ask));
    const r = N.add(load(), text);
    if (!r.note) return t.none;
    save(r.list);
    return t.saved(r.note.text);
  };
  const read = (ctx) => {
    const notes = load();
    if (notes.length) api.showList(T[ctx.lang].title, N.lines(notes));
    return N.readOut(notes, ctx.lang);
  };
  const del = (ctx) => {
    const t = T[ctx.lang];
    const n = (ctx.slots.notiznummer || ctx.slots.notenumber)?.value?.value;
    const r = N.remove(load(), n);
    if (!r.removed) return t.gone(n);
    save(r.list);
    return t.removed(n, r.removed.text);
  };
  const clear = async (ctx) => {
    const t = T[ctx.lang];
    const notes = load();
    if (!notes.length) return t.empty;
    const answer = String((await ctx.ask(t.sure(notes.length))) || "").toLowerCase();
    if (!/\b(ja|jawohl|genau|klar|yes|yeah|yep|sure)\b/.test(answer) || /\b(nein|nicht|no)\b/.test(answer)) return t.kept;
    save([]);
    return t.cleared(notes.length);
  };

  api.command(["merke dir {frei}", "(notiere|notier) [mir] {frei}", "(schreib|schreibe) dir auf {frei}"], remember);
  api.command(["merke dir [etwas|was]", "(notiere|notier) [etwas|was]", "neue notiz"], remember);
  api.command(["was habe ich mir gemerkt", "was hast du dir gemerkt", "(welche|meine) notizen [habe ich]", "(lies|zeig) [mir] [meine] notizen [vor]"], read);
  api.command(["(lösche|lösch) [die] notiz [nummer] {notiznummer}", "notiz [nummer] {notiznummer} löschen"], del);
  api.command(["(lösche|lösch) alle notizen", "alle notizen löschen"], clear);
  api.command(["remember {frei}", "(take|make) a note {frei}", "note {frei}"], remember, { lang: "en" });
  api.command(["remember something", "take a note", "new note"], remember, { lang: "en" });
  api.command(["what did i ask you to remember", "(read|show) [me] my notes", "what are my notes"], read, { lang: "en" });
  api.command(["delete note [number] {notenumber}"], del, { lang: "en" });
  api.command(["delete all [my] notes", "clear [all] [my] notes"], clear, { lang: "en" });
};
