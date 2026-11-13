// Suchen in zwei Schritten: erst die Seite („Suche auf YouTube“), dann fragt CommandWave nach dem Suchbegriff.
// Der Suchbegriff wird frei erkannt (ohne Befehlsliste) – deshalb geht hier jedes Wort, das das Sprachmodell kennt.
module.exports = (api) => {
  const T = {
    de: { ask: (s) => `Was soll ich auf ${s} suchen?`, askWeb: "Was soll ich suchen?", none: "Okay, keine Suche.", go: (q, s) => `Ich suche „${q}“ auf ${s}.` },
    en: { ask: (s) => `What should I search for on ${s}?`, askWeb: "What should I search for?", none: "Okay, no search.", go: (q, s) => `Searching ${s} for "${q}".` },
  };
  const GOOGLE = { key: "google", value: { url: "https://www.google.com/search?q=", label: "Google" } };
  const search = (fixed) => async (ctx) => {
    const s = fixed || ctx.slots.suchseite || GOOGLE;
    const t = T[ctx.lang];
    // „suche nach katzenvideos“: Begriff kommt gleich mit (freier Rest), sonst nachfragen
    const q = String(ctx.slots.frei?.key || (await ctx.ask(s === GOOGLE && !ctx.slots.suchseite ? t.askWeb : t.ask(s.value.label))) || "").trim();
    if (!q) return t.none;
    const base = (ctx.lang === "en" && s.value.url_en) || s.value.url;
    await api.open(base + encodeURIComponent(q));
    return t.go(q, s.value.label);
  };

  api.command(["(suche|such) (auf|bei|in|mit) {suchseite}", "{suchseite} (suche|suchen|durchsuchen)", "auf {suchseite} suchen", "(suche|such) [etwas] [bei] {suchseite}"], search());
  api.command(["(suche|such) [etwas] [im internet]", "(google|googel) [etwas] [für mich]", "im internet suchen"], search(GOOGLE));

  api.command(["(suche|such) (auf|bei|in) {suchseite} nach {frei}", "{suchseite} nach {frei} durchsuchen"], search());
  api.command(["(suche|such) [im internet] nach {frei}", "google [nach] {frei}"], search(GOOGLE));
  api.command(["search {suchseite} for {frei}", "search for {frei} on {suchseite}"], search(), { lang: "en" });
  api.command(["search [the web] for {frei}", "google {frei}", "look up {frei}"], search(GOOGLE), { lang: "en" });
  api.command(["search (on|in|with) {suchseite}", "{suchseite} search", "search {suchseite}", "search for something on {suchseite}"], search(), { lang: "en" });
  api.command(["search [the] (web|internet)", "search for something", "google something", "look something up"], search(GOOGLE), { lang: "en" });
};
