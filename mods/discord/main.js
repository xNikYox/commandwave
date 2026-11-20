// Discord per Sprache: drückt die globalen Tastenkürzel, die man in Discord einmal festlegt
// (Einstellungen → Tastenbelegung → „Stummschaltung umschalten“ / „Ein- und Ausgabe stummschalten umschalten“).
// Discord kennt dafür nur Umschalter – „stumm“ und „Stummschaltung aufheben“ drücken also dieselbe Taste.
// „Discord“ kennt das deutsche Sprachmodell nicht – in den Sätzen steht es so, wie es klingt („disk kord“).
module.exports = (api) => {
  const T = {
    de: { mute: "Okay, Discord-Mikro umgeschaltet.", deafen: "Okay, Discord-Ton umgeschaltet.", none: "Für Discord ist keine Taste eingestellt – bitte unter Einstellungen eintragen." },
    en: { mute: "Okay, toggled your Discord mic.", deafen: "Okay, toggled Discord sound.", none: "No Discord key is set – please add one in the settings." },
  };
  const press = (which) => async (ctx) => {
    const t = T[ctx.lang] || T.de;
    const keys = String(api.settings()[which] || "").trim();
    if (!keys) return t.none;
    await api.keys(keys);
    return t[which];
  };
  const dc = "(in|bei) disk kord";
  api.command(["(mikro|mikrofon) stumm [schalten]", `stumm schalten ${dc}`, "disk kord mikro (stumm|aus)", `(mikro|mikrofon) aus ${dc}`], press("mute"));
  api.command(["stumm schaltung aufheben", `stumm schaltung ${dc} aufheben`, "(mikro|mikrofon) wieder an", "disk kord mikro (an|wieder an)"], press("mute"));
  api.command(["taub schalten", `taub schalten ${dc}`, "disk kord taub [schalten]"], press("deafen"));
  api.command(["taub (aufheben|ausschalten)", "taub schaltung aufheben", "disk kord nicht mehr taub"], press("deafen"));
  api.command(["mute [my] (mic|microphone) [on|in] discord", "discord mute", "discord mute off"], press("mute"), { lang: "en" });
  api.command(["deafen [me] [on|in] discord", "discord deafen [off]", "un deafen discord"], press("deafen"), { lang: "en" });
};
