// Wecker: gespeichert (api.storage), nach Neustart wieder geplant. Zur Weckzeit: Musik fortsetzen (Amazon Music
// bevorzugt) und deren Lautstärke langsam hochdrehen – ohne Musik ein Weckton im Fenster, der lauter wird.
// Grenze: Im Ruhezustand laufen keine Zeitgeber – der PC muss an sein.
module.exports = (api) => {
  const N = api.numbers;
  const REG = (globalThis.__cwAlarms ||= { timers: new Map(), ringing: null });
  for (const t of REG.timers.values()) clearTimeout(t);
  REG.timers.clear();
  const MAX = 2 ** 31 - 1;
  const RING_MS = 15 * 60 * 1000;
  const SNOOZE_MIN = 9;
  const num = (lang, max) => Object.fromEntries(Object.entries(N ? N.slotValues(lang, max) : {}).map(([k, v]) => [k, { value: v, label: String(v), lang }]));
  api.slot("stunde", num("de", 23));
  api.slot("minute", num("de", 59));
  api.slot("hour", num("en", 12));
  api.slot("minute_en", num("en", 59));

  const load = () => (api.storage.get().alarms || []).filter((a) => a && a.at);
  const save = (alarms) => api.storage.set({ alarms });
  const clock = (at, lang) => {
    const d = new Date(at);
    const today = new Date().toDateString() === d.toDateString();
    if (lang === "en") return (today ? "today at " : "tomorrow at ") + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return (today ? "heute um " : "morgen um ") + `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")} Uhr`;
  };
  const T = {
    de: { set: (w) => `Okay, der Wecker klingelt ${w}.`, morning: (d) => `Guten Morgen! Es ist ${d.getHours()} Uhr${d.getMinutes() ? " " + d.getMinutes() : ""}.`, off: "Wecker aus. Einen schönen Tag!", noRing: "Gerade klingelt kein Wecker.",
      snooze: `Okay, ich wecke dich in ${SNOOZE_MIN} Minuten nochmal.`, list: (l) => (l.length ? `Du hast ${l.length} ${l.length === 1 ? "Wecker" : "Wecker"}: ${l.map((a) => clock(a.at, "de")).join(", ")}.` : "Du hast keinen Wecker gestellt."),
      cleared: (n) => (n ? `${n} ${n === 1 ? "Wecker" : "Wecker"} gelöscht.` : "Es war kein Wecker gestellt."), missed: (a) => `Der Wecker ${clock(a.at, "de").replace(/^heute /, "")} wurde verpasst – der PC war aus.`, title: "Wecker" },
    en: { set: (w) => `Okay, alarm set for ${w}.`, morning: (d) => `Good morning! It's ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.`, off: "Alarm off. Have a nice day!", noRing: "No alarm is ringing right now.",
      snooze: `Okay, I'll wake you again in ${SNOOZE_MIN} minutes.`, list: (l) => (l.length ? `You have ${l.length} ${l.length === 1 ? "alarm" : "alarms"}: ${l.map((a) => clock(a.at, "en")).join(", ")}.` : "You have no alarms set."),
      cleared: (n) => (n ? `Deleted ${n} ${n === 1 ? "alarm" : "alarms"}.` : "There was no alarm set."), missed: (a) => `Missed the alarm ${clock(a.at, "en").replace(/^today /, "")} – the PC was off.`, title: "Alarm" },
  };
  /** Prozessname für den Lautstärkemixer aus der Kennung der Wiedergabe */
  const proc = (app) => (/amazon/i.test(app) ? "amazon music" : /spotify/i.test(app) ? "spotify" : String(app || "").toLowerCase().replace(/\.exe$/, "").split("!")[0].split("_")[0]);

  function stopRing() {
    const r = REG.ringing;
    if (!r) return false;
    REG.ringing = null;
    clearInterval(r.ramp);
    clearTimeout(r.end);
    if (r.tone) api.sound("alarm", false);
    return r;
  }
  async function ring(a) {
    stopRing();
    REG.timers.delete(a.id);
    save(load().filter((x) => x.id !== a.id));
    const t = T[a.lang === "en" ? "en" : "de"];
    const r = { id: a.id, lang: a.lang, ramp: null, end: null, tone: false };
    REG.ringing = r;
    api.notify(t.title, t.morning(new Date()));
    // Musik fortsetzen: erst leise stellen, dann abspielen, dann langsam lauter
    let target = "";
    if (api.mediaSession && api.appVolume) {
      for (const app of ["amazon", ""]) {
        const info = await api.mediaSession("info", app).catch(() => null);
        if (!info || !info.ok) continue;
        target = proc(info.app);
        await api.appVolume(target, "set", 0.1).catch(() => null);
        const p = await api.mediaSession("play", app).catch(() => null);
        if (p && p.ok) break;
        target = "";
      }
    }
    if (target) {
      let v = 0.1;
      r.ramp = setInterval(() => {
        v = Math.min(0.8, v + 0.07);
        api.appVolume(target, "set", v).catch(() => null);
        if (v >= 0.8) clearInterval(r.ramp);
      }, 15000);
    } else {
      r.tone = true;
      api.sound("alarm", true); // Weckton im Fenster, wird von selbst lauter
    }
    api.say(t.morning(new Date()));
    r.end = setTimeout(stopRing, RING_MS);
  }
  function schedule(a) {
    const ms = a.at - Date.now();
    const timer = setTimeout(() => (ms > MAX ? schedule(a) : ring(a)), Math.max(0, Math.min(ms, MAX)));
    timer.unref?.();
    REG.timers.set(a.id, timer);
  }
  // beim Laden planen; knapp verpasste (bis 2 Minuten) klingeln, ältere melden
  const keep = [];
  for (const a of load()) {
    if (a.at > Date.now() - 2 * 60 * 1000) {
      keep.push(a);
      schedule(a);
    } else {
      const t = setTimeout(() => api.notify(T[a.lang === "en" ? "en" : "de"].title, T[a.lang === "en" ? "en" : "de"].missed(a)), 15000);
      t.unref?.();
    }
  }
  if (keep.length !== load().length) save(keep);

  const next = (h, m) => {
    const d = new Date();
    d.setHours(h, m, 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    return d.getTime();
  };
  const add = (lang, at) => {
    const a = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at, lang };
    save([...load(), a]);
    schedule(a);
    return T[lang].set(clock(at, lang));
  };
  const setDe = (ctx) => add("de", next(Number(ctx.slots.stunde.value.value), Number(ctx.slots.minute?.value.value || 0)));
  const setEn = (ctx) => {
    let h = Number(ctx.slots.hour.value.value) % 12;
    if (/\bpm\b|evening|afternoon/.test(ctx.text)) h += 12;
    else if (!/\bam\b|morning/.test(ctx.text) && next(h, 0) - Date.now() > 12 * 3600e3) h += 12;
    return add("en", next(h, Number(ctx.slots.minute_en?.value.value || 0)));
  };
  const off = (ctx) => (stopRing() ? T[ctx.lang].off : T[ctx.lang].noRing);
  const snooze = async (ctx) => {
    const r = stopRing();
    if (!r) return T[ctx.lang].noRing;
    if (!r.tone && api.mediaSession) await api.mediaSession("pause", "").catch(() => null);
    const a = { id: r.id + "s", at: Date.now() + SNOOZE_MIN * 60e3, lang: ctx.lang };
    save([...load(), a]);
    schedule(a);
    return T[ctx.lang].snooze;
  };
  const list = (ctx) => T[ctx.lang].list(load().sort((x, y) => x.at - y.at));
  const clear = (ctx) => {
    const n = load().length;
    for (const t of REG.timers.values()) clearTimeout(t);
    REG.timers.clear();
    save([]);
    return T[ctx.lang].cleared(n);
  };
  api.ring = ring; // für Tests

  // wenige Satzvarianten: jede wird mit allen 24 Stunden kombiniert (Grammatik bleibt klein)
  api.command(["(weck|wecke) mich um {stunde} uhr", "wecker (auf|um) {stunde} uhr"], setDe);
  api.command(["(weck|wecke) mich um {stunde} uhr {minute}", "wecker (auf|um) {stunde} uhr {minute}"], setDe);
  api.command(["wecker (aus|stopp)", "alarm aus", "ich bin wach", "(stoppe|stopp) den wecker"], off);
  api.command(["schlummern", "noch (fünf|ein paar) minuten", "später wecken"], snooze);
  api.command(["welche wecker [habe ich]", "(zeige|zeig) [mir] [meine] wecker", "wann klingelt [der|mein] wecker"], list);
  api.command(["(lösche|entferne) [alle] [den|die|meine] wecker", "wecker löschen"], clear);
  api.command(["wake me up at {hour} [am|pm]", "set an alarm for {hour} [am|pm]"], setEn, { lang: "en" });
  api.command(["wake me up at {hour} {minute_en} [am|pm]", "set an alarm for {hour} {minute_en} [am|pm]"], setEn, { lang: "en" });
  api.command(["(stop|turn off) the alarm", "alarm off", "i'm awake", "i am awake"], off, { lang: "en" });
  api.command(["snooze", "five more minutes"], snooze, { lang: "en" });
  api.command(["what alarms do i have", "(show|list) [my] alarms", "when is my alarm"], list, { lang: "en" });
  api.command(["(delete|clear|remove) [all] [my] alarms", "delete the alarm"], clear, { lang: "en" });
};
