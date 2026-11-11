// Musik gezielt steuern über die Windows-Mediensteuerung (api.mediaSession, ab CommandWave 1.1).
// Ohne Angabe einer App wird die aktuelle Wiedergabe gesteuert. Ältere CommandWave-Versionen: Medientasten als Ersatz.
module.exports = (api) => {
  const KEY = { next: "next", previous: "previous", toggle: "play_pause", play: "play_pause", pause: "play_pause" };
  const APP_NAMES = [[/amazon/i, "Amazon Music"], [/spotify/i, "Spotify"], [/msedge/i, "Edge"], [/chrome/i, "Chrome"], [/firefox|308046b0af4a39cb/i, "Firefox"], [/zune|mediaplayer/i, "der Medienwiedergabe"], [/vlc/i, "VLC"]];
  const appName = (id) => (APP_NAMES.find(([re]) => re.test(id || "")) || [null, ""])[1];

  async function control(cmd, ctx) {
    const p = ctx.slots.player?.value;
    if (!api.mediaSession) {
      await api.media(KEY[cmd]);
      return "";
    }
    const r = await api.mediaSession(cmd, p?.id || "");
    if (r.ok) return "";
    if (p) return `In ${p.label.replace(/^(dem|der) /, "")} läuft gerade nichts.`.replace("In Amazon Music", "Bei Amazon Music");
    // keine Wiedergabe gefunden: Medientaste als Ersatz (manche Player melden sich nicht bei Windows an)
    await api.media(KEY[cmd]);
    return "";
  }

  const at = "[(in|bei|auf) {player}]";
  api.command([`nächstes lied ${at}`, `nächster titel ${at}`, `(lied|titel) überspringen ${at}`, `(spring|springe) zum nächsten lied ${at}`, "{player} nächstes lied", `skip ${at}`], (ctx) => control("next", ctx));
  api.command([`(vorheriges|letztes) lied ${at}`, `vorheriger titel ${at}`, "{player} (vorheriges|letztes) lied", "lied (zurück|nochmal)"], (ctx) => control("previous", ctx));
  api.command([`pause ${at}`, `(pausiere|stoppe|stopp) [die] musik ${at}`, "musik (pausieren|anhalten|aus)", "{player} (pausieren|anhalten)"], (ctx) => control("pause", ctx));
  api.command([`(weiter|abspielen|fortsetzen) ${at}`, `musik (weiter|an|fortsetzen) ${at}`, "{player} (weiter|abspielen|fortsetzen)", "(spiel|spiele) weiter"], (ctx) => control("play", ctx));

  api.command(["was läuft [gerade|da]", "welches lied (ist das|läuft [gerade])", "was ist das für ein lied", "wie heißt das lied", `was läuft (in|bei|auf) {player}`], async (ctx) => {
    if (!api.mediaSession) return "Dafür brauche ich eine neuere CommandWave-Version.";
    const r = await api.mediaSession("info", ctx.slots.player?.value?.id || "");
    if (!r.ok || !r.title) return "Gerade läuft nichts.";
    const where = appName(r.app);
    return `Gerade läuft ${r.title}${r.artist ? " von " + r.artist : ""}${where ? " in " + where : ""}.`;
  });
};
