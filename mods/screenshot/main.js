// Bildschirmfotos: ganzer Bildschirm oder nur das vorderste Fenster (CommandWave selbst wird übersprungen).
module.exports = (api) => {
  const T = {
    de: { saved: "Screenshot gespeichert unter Bilder, Screenshots.", win: (n) => `Screenshot ${n ? "von " + n + " " : "vom Fenster "}gespeichert.`, fail: "Der Screenshot hat leider nicht geklappt.",
      none: "Ich habe noch keinen Screenshot gemacht.", old: "Dafür brauche ich eine neuere CommandWave-Version." },
    en: { saved: "Screenshot saved to Pictures, Screenshots.", win: (n) => `Saved a screenshot ${n ? "of " + n : "of the window"}.`, fail: "Sorry, the screenshot didn't work.",
      none: "I haven't taken a screenshot yet.", old: "Please update CommandWave for that." },
  };
  // Prozessname → Name in der Antwort (Deutsch, Englisch)
  const NICE = { msedge: ["Edge", "Edge"], chrome: ["Chrome", "Chrome"], firefox: ["Firefox", "Firefox"], notepad: ["dem Editor", "Notepad"], explorer: ["dem Explorer", "File Explorer"],
    spotify: ["Spotify", "Spotify"], discord: ["Discord", "Discord"], javaw: ["Minecraft", "Minecraft"] };
  const shot = (mode) => async (ctx) => {
    const t = T[ctx.lang];
    if (!api.screenshot) return t.old;
    const r = await api.screenshot(mode);
    if (!r || !r.ok) return t.fail;
    api.storage.set({ last: r.file });
    const nice = r.name && NICE[r.name.toLowerCase()];
    const n = nice ? nice[ctx.lang === "en" ? 1 : 0] : r.name || "";
    return mode === "window" ? t.win(n) : t.saved;
  };
  const last = (folder) => async (ctx) => {
    const f = api.storage.get().last;
    if (!f) return T[ctx.lang].none;
    if (folder && api.reveal) api.reveal(f);
    else await api.open(f);
    return "";
  };
  api.command(["(mach|mache) [einen|ein] (screenshot|bildschirmfoto)", "screenshot [machen]", "bildschirmfoto [machen]", "foto vom bildschirm"], shot("screen"));
  api.command(["(mach|mache) [einen|ein] (screenshot|bildschirmfoto) vom fenster", "fenster screenshot", "screenshot vom fenster"], shot("window"));
  api.command(["(zeige|zeig|öffne) [mir] [den] letzten screenshot", "(zeige|zeig|öffne) [mir] [das] letzte bildschirmfoto"], last(false));
  api.command(["(zeige|zeig|öffne) [mir] [die|meine] screenshots", "screenshots (zeigen|öffnen)"], last(true));
  api.command(["take a screenshot", "screenshot", "capture the screen"], shot("screen"), { lang: "en" });
  api.command(["take a screenshot of [the] window", "screenshot [of] [the] window"], shot("window"), { lang: "en" });
  api.command(["show [me] [the] last screenshot", "open [the] last screenshot"], last(false), { lang: "en" });
  api.command(["(show|open) [me] [my] screenshots"], last(true), { lang: "en" });
};
