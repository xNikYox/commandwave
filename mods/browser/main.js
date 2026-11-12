// Browser-Tabs per Sprache (api.browser, ab CommandWave 1.1): Tastenkürzel an das oberste Browserfenster,
// Tabs nach Namen schließen über die Windows-Bedienungshilfe – auch wenn der Tab gerade nicht vorne ist.
module.exports = (api) => {
  const need = () => (!api.browser ? "Dafür brauche ich eine neuere CommandWave-Version." : null);
  const simple = (op, answer) => async () => {
    if (need()) return need();
    const r = await api.browser(op);
    return r.ok ? answer : r.error === "kein Browser" ? "Ich finde kein offenes Browserfenster." : "Das hat leider nicht geklappt.";
  };
  api.command(["(schließe|schließ) [den] [aktuellen] tab", "(mach|mache) [den] tab zu", "tab (schließen|zu)"], simple("close", "Tab geschlossen."));
  api.command(["(öffne|mach) [einen] neuen tab [auf]", "neuer tab"], simple("new", ""));
  api.command(["nächster tab", "(geh|gehe) [zum] nächsten tab", "tab (weiter|rechts)"], simple("next", ""));
  api.command(["vorheriger tab", "(geh|gehe) [zum] vorherigen tab", "tab (zurück|links)"], simple("previous", ""));
  api.command(["tab wiederherstellen", "(öffne|hol) [den] [letzten] geschlossenen tab [wieder]"], simple("reopen", ""));

  // Tabs nach Namen: Suchwort = match aus den Seiten-Werten, sonst das gesprochene Wort (youtube, amazon, …)
  const closeBy = (all) => async (ctx) => {
    if (need()) return need();
    const s = ctx.slots.seite;
    const term = s.value?.match || s.key;
    const label = (s.value?.label || s.key).replace(/^(die|das|der) /, "");
    const r = await api.browser("closeMatching", term, all);
    if (!r.ok) return "Das hat leider nicht geklappt.";
    if (!r.count) return `Ich habe keinen Tab mit ${label} gefunden.`;
    return r.count === 1 ? `${label}-Tab geschlossen.` : `${r.count} ${label}-Tabs geschlossen.`;
  };
  api.command(["(schließe|schließ) [den] {seite} tab", "(schließe|schließ) [den] tab (mit|von) {seite}", "{seite} tab (schließen|zu)"], closeBy(false));
  api.command(["(schließe|schließ) alle {seite} tabs", "alle {seite} tabs schließen", "(schließe|schließ) alle tabs (mit|von) {seite}"], closeBy(true));

  // English
  const en = { lang: "en" };
  const simpleEn = (op, answer) => async () => {
    if (!api.browser) return "Please update CommandWave for that.";
    const r = await api.browser(op);
    return r.ok ? answer : r.error === "kein Browser" ? "I can't find an open browser window." : "Sorry, that didn't work.";
  };
  api.command(["close [the] [current] tab", "close this tab"], simpleEn("close", "Tab closed."), en);
  api.command(["(open|new) [a] [new] tab"], simpleEn("new", ""), en);
  api.command(["next tab", "go to the next tab"], simpleEn("next", ""), en);
  api.command(["previous tab", "go to the previous tab", "last tab"], simpleEn("previous", ""), en);
  api.command(["reopen [the] [last] [closed] tab", "restore [the] tab"], simpleEn("reopen", ""), en);
  const closeByEn = (all) => async (ctx) => {
    if (!api.browser) return "Please update CommandWave for that.";
    const s = ctx.slots.seite;
    const term = s.value?.match || s.key;
    const label = s.value?.label_en || s.value?.label || s.key;
    const r = await api.browser("closeMatching", term, all);
    if (!r.ok) return "Sorry, that didn't work.";
    if (!r.count) return `I couldn't find a ${label} tab.`;
    return r.count === 1 ? `Closed the ${label} tab.` : `Closed ${r.count} ${label} tabs.`;
  };
  api.command(["close [the] {seite} tab", "close the tab (with|from) {seite}"], closeByEn(false), en);
  api.command(["close all [the] {seite} tabs", "close all tabs (with|from) {seite}"], closeByEn(true), en);
};
