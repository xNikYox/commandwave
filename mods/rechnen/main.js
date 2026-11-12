// Rechnen und Einheiten umrechnen – offline. Kurze Rechnungen gehen direkt („was ist fünf mal sieben“),
// alles andere mit Rückfrage („rechne etwas“ → „fünf meilen in kilometer“), die frei erkannt wird.
module.exports = (api) => {
  const N = api.numbers;
  if (!N) return; // ältere CommandWave-Version
  const num = (lang) => Object.fromEntries(Object.entries(N.slotValues(lang, 100)).map(([k, v]) => [k, { value: v, label: String(v), lang }]));
  api.slot("zahl_a", num("de"));
  api.slot("zahl_b", num("de"));
  api.slot("number_a", num("en"));
  api.slot("number_b", num("en"));
  const T = {
    de: { ask: "Was soll ich rechnen?", none: "Okay, dann nicht.", fail: (q) => `Das konnte ich nicht ausrechnen: „${q}“.` },
    en: { ask: "What should I calculate?", none: "Okay, never mind.", fail: (q) => `I couldn't work that out: "${q}".` },
  };
  const direct = (ctx) => N.evaluate(ctx.text, ctx.lang)?.text || T[ctx.lang].fail(ctx.text);
  const asked = async (ctx) => {
    const t = T[ctx.lang];
    const q = String((await ctx.ask(t.ask)) || "").trim();
    if (!q) return t.none;
    return N.evaluate(q, ctx.lang)?.text || t.fail(q);
  };
  api.command(["was ist {zahl_a} (plus|minus|mal|geteilt durch|hoch) {zahl_b}", "{zahl_a} (plus|minus|mal|geteilt durch) {zahl_b}", "[was sind] {zahl_a} prozent von {zahl_b}", "[was ist die] wurzel aus {zahl_a}"], direct);
  api.command(["(rechne|berechne) [mal] [etwas|was] [für mich]", "rechnen", "(rechne|rechnen) [etwas|was] um", "[einheiten] umrechnen"], asked);
  api.command(["what is {number_a} (plus|minus|times|divided by) {number_b}", "{number_a} (plus|minus|times|divided by) {number_b}", "[what is] {number_a} percent of {number_b}", "[what is the] square root of {number_a}"], direct, { lang: "en" });
  api.command(["calculate [something]", "do [some] (math|a calculation)", "convert [something]", "unit conversion"], asked, { lang: "en" });
};
