// Diktieren: frei erkannten Text ins vorderste Fenster tippen. Eigene Wörter (Einstellungen → Aussprache lernen)
// werden eingesetzt; gesprochene Satzzeichen werden zu Zeichen, Satzanfänge groß geschrieben.
module.exports = (api) => {
  const MARKS = {
    de: [["neuer absatz", "\n\n"], ["neue zeile", "\n"], ["fragezeichen", "?"], ["ausrufezeichen", "!"], ["doppelpunkt", ":"], ["semikolon", ";"], ["bindestrich", "-"], ["komma", ","], ["punkt", "."]],
    en: [["new paragraph", "\n\n"], ["new line", "\n"], ["question mark", "?"], ["exclamation (?:mark|point)", "!"], ["colon", ":"], ["semicolon", ";"], ["hyphen", "-"], ["dash", "-"], ["comma", ","], ["full stop", "."], ["period", "."]],
  };
  /** „hallo komma wie geht's fragezeichen“ → „Hallo, wie geht's?“ */
  function format(text, lang) {
    let t = ` ${text} `;
    for (const [w, c] of MARKS[lang]) t = t.replace(new RegExp(`\\s${w}(?=\\s)`, "gi"), c === "-" ? " -" : c);
    t = t.replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").trim();
    t = t.replace(/(^|[.!?]\s+|\n)(\p{Ll})/gu, (_m, pre, ch) => pre + ch.toUpperCase());
    // englisches „i“ immer groß
    if (lang === "en") t = t.replace(/\bi\b/g, "I");
    return t;
  }
  api.format = format; // für Tests
  const T = {
    de: { ask: "Was soll ich schreiben?", none: "Okay, nichts geschrieben.", noWin: "Ich habe kein Fenster zum Schreiben gefunden.", old: "Dafür brauche ich eine neuere CommandWave-Version." },
    en: { ask: "What should I type?", none: "Okay, nothing typed.", noWin: "I couldn't find a window to type into.", old: "Please update CommandWave for that." },
  };
  const dictate = async (ctx) => {
    const t = T[ctx.lang];
    if (!api.typeText) return t.old;
    const heard = String((await ctx.ask(t.ask)) || "").trim();
    if (!heard) return t.none;
    const r = await api.typeText(format(heard, ctx.lang));
    return r && r.ok ? "" : t.noWin;
  };
  api.command(["(schreib|schreibe) [mal] [was|etwas] [für mich]", "diktieren", "diktat [starten]", "text (diktieren|schreiben)", "(tippe|tipp) [mal] [was|etwas]"], dictate);
  api.command(["type [something] [for me]", "dictate [something]", "start dictation", "write [something] [for me]"], dictate, { lang: "en" });
};
