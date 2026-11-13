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

  // English
  const controlEn = async (cmd, ctx) => {
    const p = ctx.slots.player?.value;
    if (!api.mediaSession) {
      await api.media(KEY[cmd]);
      return "";
    }
    const r = await api.mediaSession(cmd, p?.id || "");
    if (r.ok) return "";
    if (p) return `Nothing is playing on ${p.label_en || p.label}.`;
    await api.media(KEY[cmd]);
    return "";
  };
  const on = "[(in|on) {player}]";
  api.command([`next (song|track) ${on}`, `skip [the] (song|track) ${on}`, "{player} next (song|track)", `skip ${on}`], (ctx) => controlEn("next", ctx), { lang: "en" });
  api.command([`previous (song|track) ${on}`, `last (song|track) ${on}`, "go back [a song]"], (ctx) => controlEn("previous", ctx), { lang: "en" });
  api.command([`pause [the] [music] ${on}`, `stop the music ${on}`, "{player} pause"], (ctx) => controlEn("pause", ctx), { lang: "en" });
  api.command([`(play|resume|continue) [the] [music] ${on}`, "{player} (play|resume)"], (ctx) => controlEn("play", ctx), { lang: "en" });
  api.command(["what is playing [right now]", "what song is (this|playing)", "what is this song", `what is playing on {player}`], async (ctx) => {
    if (!api.mediaSession) return "Please update CommandWave for that.";
    const r = await api.mediaSession("info", ctx.slots.player?.value?.id || "");
    if (!r.ok || !r.title) return "Nothing is playing right now.";
    const where = appName(r.app).replace(/^(dem|der) /, "").replace("Medienwiedergabe", "Media Player");
    return `Now playing: ${r.title}${r.artist ? " by " + r.artist : ""}${where ? " on " + where : ""}.`;
  }, { lang: "en" });

  // Bestimmte Lieder, Künstler, Playlists, Sender in Amazon Music: fragen „Was soll ich spielen?“, dann suchen und
  // das erste Ergebnis abspielen (ab CommandWave 1.5 – Amazon Music hat keine Schnittstelle dafür, die App wird bedient)
  const AM = {
    de: { ask: { song: "Was soll ich auf Amazon Music spielen?", playlist: "Welche Playlist?", station: "Welchen Sender?" }, none: "Okay, dann nicht.",
      playing: (t, a) => `Ich spiele ${t}${a ? " von " + a : ""}.`, started: (q) => `Ich spiele „${q}“ auf Amazon Music.`,
      web: (q) => `Amazon Music ist nicht installiert – ich habe die Suche nach „${q}“ im Browser geöffnet.`,
      searched: (q) => `Ich habe „${q}“ bei Amazon Music gesucht, konnte es aber nicht starten. Klick bitte auf Abspielen.`,
      failed: "Amazon Music konnte ich gerade nicht steuern.", old: "Dafür brauche ich eine neuere CommandWave-Version." },
    en: { ask: { song: "What should I play on Amazon Music?", playlist: "Which playlist?", station: "Which station?" }, none: "Okay, never mind.",
      playing: (t, a) => `Playing ${t}${a ? " by " + a : ""}.`, started: (q) => `Playing "${q}" on Amazon Music.`,
      web: (q) => `Amazon Music isn't installed, so I opened the search for "${q}" in your browser.`,
      searched: (q) => `I searched Amazon Music for "${q}" but couldn't start it. Please click play.`,
      failed: "I couldn't control Amazon Music right now.", old: "Please update CommandWave for that." },
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const playAmazon = (kind) => async (ctx) => {
    const t = AM[ctx.lang];
    if (!api.amazonMusic) return t.old;
    // „spiel lieder von SDP“: Name kommt gleich mit (freier Rest), sonst nachfragen
    const said = ctx.slots.frei?.key && String(ctx.slots.frei.key).replace(/\s*\b(auf|bei|in|on|with)\s+amazon(\s+(music|musik))?\s*$/i, "").trim();
    const q = String(said || (await ctx.ask(t.ask[kind])) || "").trim();
    if (!q) return t.none;
    const before = await api.mediaSession("info", "amazon").catch(() => null);
    const r = await api.amazonMusic(q);
    if (r && r.ok) {
      // kurz warten und nachsehen, ob jetzt etwas Neues läuft
      for (let i = 0; i < 4; i++) {
        await wait(1500);
        const now = await api.mediaSession("info", "amazon").catch(() => null);
        if (now && now.ok && now.title && (now.title !== before?.title || now.status === "Playing" && before?.status !== "Playing")) return t.playing(now.title, now.artist);
      }
      return t.started(q);
    }
    if (r && r.error === "nicht installiert") {
      await api.open("https://music.amazon.de/search/" + encodeURIComponent(q));
      return t.web(q);
    }
    if (r && r.searched) return t.searched(q);
    api.log("Amazon Music:", JSON.stringify(r));
    return t.failed;
  };
  const am = "amazon [music|musik]";
  api.command([`(spiele|spiel) [etwas|was|musik|ein lied|einen song] (auf|bei|in|mit) ${am}`, `(spiele|spiel) [einen] (künstler|interpreten|album) (auf|bei|in) ${am}`, `${am} (spiele|spiel) [etwas|was]`, `lied (auf|bei) ${am} (spielen|abspielen)`], playAmazon("song"));
  api.command([`(spiele|spiel) [eine|meine] playlist (auf|bei|in|mit) ${am}`, `playlist (auf|bei) ${am} (spielen|abspielen)`], playAmazon("playlist"));
  api.command([`(spiele|spiel) [einen] (sender|radiosender|radio) (auf|bei|in|mit) ${am}`], playAmazon("station"));
  // in einem Satz – der Name wird danach frei erkannt (CommandWave 1.8)
  api.command(["(spiel|spiele) [mir] [lieder|musik|songs|etwas|was|einen song|ein lied] von {frei}", "(spiel|spiele) [mir] (das lied|den song|das album|den titel) {frei}"], playAmazon("song"));
  api.command(["(spiel|spiele) [meine|die] playlist {frei}"], playAmazon("playlist"));
  api.command(["(spiel|spiele) [den] sender {frei}"], playAmazon("station"));
  api.command(["play [songs|music|something] by {frei}", "play the (song|album|track) {frei}"], playAmazon("song"), { lang: "en" });
  api.command(["play [my|the] playlist {frei}"], playAmazon("playlist"), { lang: "en" });
  api.command(["play [the] station {frei}"], playAmazon("station"), { lang: "en" });
  api.command(["play (something|a song|music|an artist|an album) on amazon [music]", "play on amazon [music]", "amazon [music] play something"], playAmazon("song"), { lang: "en" });
  api.command(["play [a|my] playlist on amazon [music]"], playAmazon("playlist"), { lang: "en" });
  api.command(["play [a] (station|radio) on amazon [music]"], playAmazon("station"), { lang: "en" });

  api.command(["was läuft [gerade|da]", "welches lied (ist das|läuft [gerade])", "was ist das für ein lied", "wie heißt das lied", `was läuft (in|bei|auf) {player}`], async (ctx) => {
    if (!api.mediaSession) return "Dafür brauche ich eine neuere CommandWave-Version.";
    const r = await api.mediaSession("info", ctx.slots.player?.value?.id || "");
    if (!r.ok || !r.title) return "Gerade läuft nichts.";
    const where = appName(r.app);
    return `Gerade läuft ${r.title}${r.artist ? " von " + r.artist : ""}${where ? " in " + where : ""}.`;
  });
};
