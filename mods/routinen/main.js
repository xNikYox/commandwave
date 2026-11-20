// Routinen per Sprache starten. Die Routinen selbst (Schritte, Uhrzeiten, Start) verwaltet CommandWave im Fenster
// unter „Routinen“ (api.routines, ab CommandWave 2.0) – diese Mod macht ihre Sätze und Namen sprechbar.
module.exports = (api) => {
  const R = api.routines;
  if (!R) return; // ältere CommandWave-Version
  const list = () => R.list().filter((r) => r.enabled);
  const names = (lang) => {
    const l = list().map((r) => r.name);
    if (!l.length) return lang === "en" ? "You don't have any routines yet. You can create them in the window under Routinen." : "Du hast noch keine Routinen. Leg sie im Fenster unter Routinen an.";
    const and = lang === "en" ? " and " : " und ";
    const all = l.length === 1 ? l[0] : l.slice(0, -1).join(", ") + and + l.at(-1);
    return lang === "en" ? `Your routines: ${all}.` : `Deine Routinen: ${all}.`;
  };
  // im Hintergrund starten: die Antwort kommt sofort, die Routine meldet sich am Ende selbst
  const start = (r, lang) => {
    if (!r) return lang === "en" ? "I don't know that routine." : "Diese Routine kenne ich nicht.";
    if (!r.steps) return lang === "en" ? `The routine ${r.name} has no steps yet.` : `Die Routine ${r.name} hat noch keine Schritte.`;
    setTimeout(() => R.run(r.id).catch((e) => api.log("Routine", r.name, e.message)), 400);
    return lang === "en" ? `Starting the routine ${r.name}.` : `Ich starte die Routine ${r.name}.`;
  };

  // Namen als Platzhalter („starte routine arbeitsmodus“) – so geschrieben, wie man sie spricht
  const slot = {};
  for (const r of list()) {
    const key = r.name.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();
    if (key) slot[key] = { id: r.id, label: r.name };
  }
  api.slot("routine", slot);
  const byId = (id) => list().find((r) => r.id === id);
  api.command(["(starte|start) [die] routine {routine}", "routine {routine} (starten|ausführen)", "(führe|führ) [die] routine {routine} aus"], (ctx) => start(byId(ctx.slots.routine?.value?.id), "de"));
  api.command(["welche routinen (gibt es|habe ich|hast du)", "zeig [mir] [meine] routinen"], () => names("de"));
  api.command(["(start|run) [the] routine {routine}", "(start|run) {routine} routine"], (ctx) => start(byId(ctx.slots.routine?.value?.id), "en"), { lang: "en" });
  api.command(["what routines (are there|do i have)", "list [my] routines"], () => names("en"), { lang: "en" });

  // eigene Sätze je Routine („arbeitsmodus“, „gaming modus“)
  for (const r of list()) if (r.phrases.length) api.command(r.phrases, () => start(byId(r.id), "de"));
};
