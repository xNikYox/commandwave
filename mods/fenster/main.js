// Fenster steuern. Gemeint ist immer das vorderste Fenster – CommandWave selbst wird dabei übersprungen.
// „Wechsle zu {app}“ nutzt die Apps aus der Mod „Apps starten“ (und alle gefundenen Startmenü-Apps).
module.exports = (api) => {
  const T = {
    de: { none: "Ich habe kein Fenster gefunden.", focus: (n) => `Wechsle zu ${n}.`, notOpen: (n) => `${n} ist gerade nicht offen.` },
    en: { none: "I couldn't find a window.", focus: (n) => `Switching to ${n}.`, notOpen: (n) => `${n} isn't open right now.` },
  };
  const simple = (op) => async (ctx) => {
    const r = await api.window(op);
    return r && r.ok ? "" : T[ctx.lang].none;
  };
  /** Suchwörter für eine App: Prozessname, Programmdatei, Anzeigename, gesprochener Name */
  const terms = (slot) => {
    const v = slot.value && typeof slot.value === "object" ? slot.value : {};
    const base = (f) => String(f || "").split(/[\\/]/).pop().replace(/\.exe$/i, "");
    const uri = /^[a-z][a-z0-9+.-]*:(?![\\/])/i.test(v.target || ""); // shell:…, spotify:, ms-settings: – kein Programm
    return [base(v.process), uri ? "" : base(v.target), v.label, slot.key]
      .map((x) => String(x || "").toLowerCase().trim()).filter((x, i, a) => x && a.indexOf(x) === i).join("|");
  };
  const focus = async (ctx) => {
    const s = ctx.slots.app;
    const name = (ctx.lang === "en" && s.value?.label_en) || s.value?.label || s.key;
    const r = await api.window("focus", terms(s));
    return r && r.ok ? T[ctx.lang].focus(name) : T[ctx.lang].notOpen(name);
  };

  api.command(["minimiere [das] fenster", "fenster (minimieren|verkleinern)", "fenster runter"], simple("minimize"));
  api.command(["maximiere [das] fenster", "fenster (maximieren|vergrößern)", "fenster groß"], simple("maximize"));
  api.command(["fenster wiederherstellen", "[das] fenster normal"], simple("restore"));
  api.command(["[schiebe] [das] fenster [nach] links", "fenster links"], simple("left"));
  api.command(["[schiebe] [das] fenster [nach] rechts", "fenster rechts"], simple("right"));
  api.command(["(zeige|zeig) [den] desktop", "alles minimieren", "alle fenster minimieren"], simple("desktop"));
  api.command(["(wechsle|wechsel|geh) zu {app}", "hol {app} nach vorne", "(zeige|zeig) [mir] {app}"], focus);

  api.command(["minimize [the] window", "minimize this"], simple("minimize"), { lang: "en" });
  api.command(["maximize [the] window", "make [the] window bigger"], simple("maximize"), { lang: "en" });
  api.command(["restore [the] window"], simple("restore"), { lang: "en" });
  api.command(["(move|snap) [the] window [to the] left", "window left"], simple("left"), { lang: "en" });
  api.command(["(move|snap) [the] window [to the] right", "window right"], simple("right"), { lang: "en" });
  api.command(["show [the] desktop", "minimize (everything|all windows)"], simple("desktop"), { lang: "en" });
  api.command(["switch to {app}", "bring up {app}", "show me {app}"], focus, { lang: "en" });
};
