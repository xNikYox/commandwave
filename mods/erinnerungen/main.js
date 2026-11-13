// Erinnerungen mit Text: werden gespeichert (api.storage) und nach einem Neustart wieder geplant.
// Verpasste (PC war aus) kommen kurz nach dem Start. Die Zeitgeber liegen global, damit „Mods neu laden“
// keine doppelten Erinnerungen erzeugt.
module.exports = (api) => {
  const N = api.numbers;
  const REG = (globalThis.__cwReminders ||= new Map());
  for (const t of REG.values()) clearTimeout(t);
  REG.clear();
  const MAX = 2 ** 31 - 1;

  const num = (lang, max) => Object.fromEntries(Object.entries(N ? N.slotValues(lang, max) : {}).map(([k, v]) => [k, { value: v, label: String(v), lang }]));
  api.slot("zahl100", num("de", 100));
  api.slot("number100", num("en", 100));
  api.slot("stunde", num("de", 23));
  api.slot("minute", num("de", 59));
  api.slot("hour", num("en", 12));
  api.slot("minute_en", num("en", 59));

  const load = () => (api.storage.get().list || []).filter((r) => r && r.at && r.text);
  const save = (list) => api.storage.set({ list });
  const clock = (at, lang) => {
    const d = new Date(at);
    const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
    const today = new Date().toDateString() === d.toDateString();
    if (lang === "en") return (today ? "at " : "tomorrow at ") + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return (today ? "um " : "morgen um ") + hm + " Uhr";
  };
  const T = {
    de: { ask: "Woran soll ich dich erinnern?", none: "Okay, keine Erinnerung.", set: (w, x) => `Okay, ich erinnere dich ${w} an: ${x}.`, fire: (x) => `Erinnerung: ${x}`, missed: (x) => `Verpasste Erinnerung: ${x}`,
      list: (l) => (l.length ? `Du hast ${l.length} ${l.length === 1 ? "Erinnerung" : "Erinnerungen"}: ` + l.map((r) => `${clock(r.at, "de")} ${r.text}`).join(", ") + "." : "Du hast keine Erinnerungen."),
      cleared: (n) => (n ? `${n} ${n === 1 ? "Erinnerung" : "Erinnerungen"} gelöscht.` : "Es gab keine Erinnerungen."), inMin: (n, u) => `in ${n} ${u}` },
    en: { ask: "What should I remind you about?", none: "Okay, no reminder.", set: (w, x) => `Okay, I'll remind you ${w}: ${x}.`, fire: (x) => `Reminder: ${x}`, missed: (x) => `Missed reminder: ${x}`,
      list: (l) => (l.length ? `You have ${l.length} ${l.length === 1 ? "reminder" : "reminders"}: ` + l.map((r) => `${clock(r.at, "en")} ${r.text}`).join(", ") + "." : "You have no reminders."),
      cleared: (n) => (n ? `Deleted ${n} ${n === 1 ? "reminder" : "reminders"}.` : "There were no reminders."), inMin: (n, u) => `in ${n} ${u}` },
  };

  function fire(r, missed = false) {
    REG.delete(r.id);
    save(load().filter((x) => x.id !== r.id));
    const t = T[r.lang === "en" ? "en" : "de"];
    api.say(missed ? t.missed(r.text) : t.fire(r.text));
    api.notify(r.lang === "en" ? "Reminder" : "Erinnerung", r.text);
  }
  function schedule(r) {
    const ms = r.at - Date.now();
    // länger als ~24 Tage: später neu planen (Grenze von setTimeout)
    const t = setTimeout(() => (ms > MAX ? schedule(r) : fire(r)), Math.max(0, Math.min(ms, MAX)));
    t.unref?.();
    REG.set(r.id, t);
  }
  // beim Laden: gespeicherte planen, verpasste kurz nach dem Start melden (dann ist das Fenster bereit)
  for (const r of load()) {
    if (r.at > Date.now()) schedule(r);
    else {
      const t = setTimeout(() => fire(r, true), 15000);
      t.unref?.();
      REG.set(r.id, t);
    }
  }

  async function add(ctx, at, when) {
    const t = T[ctx.lang];
    const text = String((await ctx.ask(t.ask)) || "").trim();
    if (!text) return t.none;
    const r = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at, text, lang: ctx.lang };
    save([...load(), r]);
    schedule(r);
    return t.set(when, text);
  }
  const unitDe = (n, h) => (h ? (n === 1 ? "Stunde" : "Stunden") : n === 1 ? "Minute" : "Minuten");
  const unitEn = (n, h) => (h ? (n === 1 ? "hour" : "hours") : n === 1 ? "minute" : "minutes");
  const inDe = (ctx) => {
    const n = Number(ctx.slots.zahl100.value.value);
    const h = /stunde/.test(ctx.text);
    return add(ctx, Date.now() + n * (h ? 3600e3 : 60e3), T.de.inMin(n, unitDe(n, h)));
  };
  const inEn = (ctx) => {
    const n = Number(ctx.slots.number100.value.value);
    const h = /hour/.test(ctx.text);
    return add(ctx, Date.now() + n * (h ? 3600e3 : 60e3), T.en.inMin(n, unitEn(n, h)));
  };
  /** nächster Zeitpunkt mit dieser Uhrzeit (heute oder morgen) */
  const next = (h, m) => {
    const d = new Date();
    d.setHours(h, m, 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    return d.getTime();
  };
  const atDe = (ctx) => {
    const at = next(Number(ctx.slots.stunde.value.value), Number(ctx.slots.minute?.value.value || 0));
    return add(ctx, at, clock(at, "de"));
  };
  const atEn = (ctx) => {
    let h = Number(ctx.slots.hour.value.value) % 12;
    if (/\bpm\b|evening|afternoon|tonight/.test(ctx.text)) h += 12;
    else if (!/\bam\b|morning/.test(ctx.text) && next(h, 0) - Date.now() > 12 * 3600e3) h += 12; // ohne am/pm: das nächste Mal
    const at = next(h, Number(ctx.slots.minute_en?.value.value || 0));
    return add(ctx, at, clock(at, "en"));
  };

  api.command(["erinnere mich in {zahl100} (minute|minuten|stunde|stunden)", "erinnerung in {zahl100} (minute|minuten|stunde|stunden)"], inDe);
  api.command(["erinnere mich um {stunde} uhr", "erinnerung um {stunde} uhr"], atDe);
  api.command(["erinnere mich um {stunde} uhr {minute}", "erinnerung um {stunde} uhr {minute}"], atDe);
  api.command(["welche erinnerungen [habe ich]", "(zeige|zeig) [mir] [meine] erinnerungen", "meine erinnerungen"], () => T.de.list(load().sort((a, b) => a.at - b.at)));
  api.command(["(lösche|entferne) [alle] [meine] erinnerungen", "erinnerungen löschen"], () => {
    const n = load().length;
    for (const t of REG.values()) clearTimeout(t);
    REG.clear();
    save([]);
    return T.de.cleared(n);
  });
  api.command(["remind me in {number100} (minute|minutes|hour|hours)", "reminder in {number100} (minute|minutes|hour|hours)"], inEn, { lang: "en" });
  api.command(["remind me at {hour} [am|pm]", "remind me at {hour} {minute_en} [am|pm]"], atEn, { lang: "en" });
  api.command(["what reminders do i have", "(show|list) [my] reminders", "my reminders"], () => T.en.list(load().sort((a, b) => a.at - b.at)), { lang: "en" });
  api.command(["(delete|clear|remove) [all] [my] reminders"], () => {
    const n = load().length;
    for (const t of REG.values()) clearTimeout(t);
    REG.clear();
    save([]);
    return T.en.cleared(n);
  }, { lang: "en" });
};
