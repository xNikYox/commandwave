// Dateien per Sprache öffnen: „Öffne die Datei Bewerbung“. Suche über den Windows-Suchindex (api.powershell, ab 2.0),
// sonst selbst durch Dokumente, Desktop, Downloads, Bilder, Musik. Ein klarer Treffer wird gleich geöffnet,
// sonst zeigt CommandWave die besten fünf und fragt nach der Nummer (ctx.choose – antworten oder anklicken).
const { rank, decide, label, spoken, MIN } = require("./rank");
const { indexScript, defaultRoots, walk, withDates } = require("./search");

module.exports = (api) => {
  const T = {
    de: { ask: "Welche Datei soll ich suchen?", none: (q) => `Ich habe keine Datei „${q}“ gefunden.`, which: "Welche Datei meinst du? Sag die Nummer.",
      open: (n) => `${n} wird geöffnet`, cancel: "Okay, dann nicht.", failed: "Die Datei konnte ich nicht öffnen.", nothing: "Okay, keine Suche." },
    en: { ask: "Which file should I look for?", none: (q) => `I couldn't find a file called "${q}".`, which: "Which file do you mean? Say the number.",
      open: (n) => `Opening ${n}`, cancel: "Okay, never mind.", failed: "I couldn't open that file.", nothing: "Okay, no search." },
  };

  /** Kandidaten suchen: Index, und wenn der nichts Brauchbares hat, selbst durch die Ordner */
  async function find(query) {
    let r = null;
    try {
      r = await api.powershell(indexScript(query));
    } catch (e) {
      api.log("Suchindex nicht erreichbar:", e.message);
    }
    if (r && !r.ok && r.error) api.log("Suchindex:", r.error);
    const roots = r && Array.isArray(r.roots) && r.roots.length ? r.roots : defaultRoots();
    let ranked = rank(query, r && r.ok ? [].concat(r.files || []) : []);
    if (!ranked.length) ranked = rank(query, withDates(rank(query, walk(roots))));
    else if (ranked.some((f) => !f.modified)) ranked = rank(query, withDates(ranked));
    return ranked.filter((f) => f.score >= MIN);
  }

  const open = async (f, t) => {
    try {
      await api.open(f.path);
    } catch (e) {
      api.log("Öffnen fehlgeschlagen:", f.path, e.message);
      return t.failed;
    }
    return t.open(spoken(f.name));
  };

  const run = async (ctx) => {
    const t = T[ctx.lang] || T.de;
    const q = String(ctx.slots.frei?.key || (await ctx.ask(t.ask)) || "").trim();
    if (!q) return t.nothing;
    const d = decide(await find(q));
    if (d.none) return t.none(q);
    if (d.open) return open(d.open, t);
    const i = await ctx.choose(t.which, d.choose.map(label));
    if (i == null || !d.choose[i]) return t.cancel;
    return open(d.choose[i], t);
  };

  api.command(["öffne [die|meine] datei {frei}", "(suche|such|finde) [mir] [die|meine] datei {frei}", "wo ist [die|meine] datei {frei}"], run);
  api.command(["(öffne|suche|finde) [eine] datei"], run);
  api.command(["open [the|my] file {frei}", "(find|search for) [the|my] file {frei}", "where is [the|my] file {frei}"], run, { lang: "en" });
  api.command(["(open|find) a file"], run, { lang: "en" });
};
