// Spotify (Windows-App): suchen über spotify:search:…, dann den ersten Abspielen-Knopf per Bedienungshilfe drücken
// (api.playInApp, ab CommandWave 2.0). Ist Spotify nicht installiert, öffnet sich die Suche im Browser.
// Weiter/Pause/nächstes Lied und „Was läuft gerade?“ macht die Mod „Musik steuern“.
module.exports = (api) => {
  const T = {
    de: { playing: (t, a) => `Ich spiele ${t}${a ? " von " + a : ""} auf Spotify.`, started: (q) => `Ich spiele „${q}“ auf Spotify.`,
      web: (q) => `Spotify ist nicht installiert – ich habe die Suche nach „${q}“ im Browser geöffnet.`,
      searched: (q) => `Ich habe „${q}“ bei Spotify gesucht – klick bitte auf Abspielen.`, none: "Was soll ich auf Spotify spielen?",
      liked: "Okay, das Lied gefällt dir – gespeichert.", noApp: "Spotify läuft gerade nicht." },
    en: { playing: (t, a) => `Playing ${t}${a ? " by " + a : ""} on Spotify.`, started: (q) => `Playing "${q}" on Spotify.`,
      web: (q) => `Spotify isn't installed, so I opened the search for "${q}" in your browser.`,
      searched: (q) => `I searched Spotify for "${q}" – please click play.`, none: "What should I play on Spotify?",
      liked: "Okay, saved the song to your liked songs.", noApp: "Spotify isn't running." },
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const play = (kind) => async (ctx) => {
    const t = T[ctx.lang] || T.de;
    let q = String(ctx.slots.frei?.key || "").trim();
    if (!q) q = String((await ctx.ask(t.none)) || "").trim();
    if (!q) return "";
    const search = kind === "playlist" ? "playlist " + q : q;
    const before = await api.mediaSession("info", "spotify").catch(() => null);
    const r = await api.playInApp("Spotify*", "spotify:search:" + encodeURIComponent(search));
    if (r && r.ok) {
      // kurz warten und nachsehen, ob jetzt etwas Neues läuft
      for (let i = 0; i < 4; i++) {
        await wait(1500);
        const now = await api.mediaSession("info", "spotify").catch(() => null);
        if (now && now.ok && now.title && (now.title !== before?.title || (now.status === "Playing" && before?.status !== "Playing"))) return t.playing(now.title, now.artist);
      }
      return t.started(q);
    }
    if (r && r.error === "nicht installiert") {
      await api.open("https://open.spotify.com/search/" + encodeURIComponent(search));
      return t.web(q);
    }
    api.log("Spotify:", JSON.stringify(r));
    return t.searched(q);
  };

  api.command(["(spiel|spiele) [lieder|musik|songs] von {frei} auf spotify", "(spiel|spiele) {frei} auf spotify", "spotify (spiel|spiele) {frei}"], play("song"));
  api.command(["(spiel|spiele) [die|meine] playlist {frei} auf spotify", "spotify (spiel|spiele) [die|meine] playlist {frei}"], play("playlist"));
  api.command(["play [songs|music] by {frei} on spotify", "play {frei} on spotify"], play("song"), { lang: "en" });
  api.command(["play [the|my] playlist {frei} on spotify"], play("playlist"), { lang: "en" });

  // Lied speichern: Alt + Umschalt + B in der Spotify-App
  const like = async (ctx) => {
    const t = T[ctx.lang] || T.de;
    const w = await api.window("focus", "spotify");
    if (w && w.ok === false) return t.noApp;
    await api.keys("%+b");
    return t.liked;
  };
  api.command(["(lied|song) gefällt mir", "(dieses|das) lied gefällt mir", "(lied|song) (speichern|merken) [(auf|bei|in) spotify]", "like das lied"], like);
  api.command(["like this song", "save this song [on spotify]", "i like this song"], like, { lang: "en" });
};
