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
};
