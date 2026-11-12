// Lautstärke einzelner Programme (Windows-Lautstärkemixer). Programme aus „tonquelle“ (Discord, Spotify, Browser …)
// Weitere Programme: in mod.json unter slots → tonquelle ergänzen (process = Prozessname ohne .exe).
module.exports = (api) => {
  const T = {
    de: { now: (n, v) => `${n} ist jetzt bei ${v} Prozent.`, muted: (n) => `${n} ist stumm.`, unmuted: (n) => `${n} ist wieder an.`, get: (n, v, m) => `${n} ist bei ${v} Prozent${m ? ", aber stumm" : ""}.`,
      silent: (n) => `${n} spielt gerade keinen Ton.`, device: "Ich finde kein Audiogerät.", fail: "Das hat leider nicht geklappt.", old: "Dafür brauche ich eine neuere CommandWave-Version." },
    en: { now: (n, v) => `${n} is now at ${v} percent.`, muted: (n) => `${n} is muted.`, unmuted: (n) => `${n} is unmuted.`, get: (n, v, m) => `${n} is at ${v} percent${m ? ", but muted" : ""}.`,
      silent: (n) => `${n} isn't playing any sound right now.`, device: "I can't find an audio device.", fail: "Sorry, that didn't work.", old: "Please update CommandWave for that." },
  };
  const num = (lang) => Object.fromEntries(Object.entries(api.numbers ? api.numbers.slotValues(lang, 100) : {}).map(([k, v]) => [k, { value: v, label: String(v), lang }]));
  api.slot("prozent", num("de"));
  api.slot("percent", num("en"));
  /** Suchwörter (Prozessnamen) für ein Programm */
  const terms = (s) => {
    const v = s.value && typeof s.value === "object" ? s.value : {};
    const base = (f) => String(f || "").split(/[\\/]/).pop().replace(/\.exe$/i, "");
    const uri = /^[a-z][a-z0-9+.-]*:(?![\\/])/i.test(v.target || "");
    return [...String(v.process || "").split("|").map(base), uri ? "" : base(v.target), v.label, s.key]
      .map((x) => String(x || "").toLowerCase().replace(/^(der|die|das|the) /, "").trim()).filter((x, i, a) => x && a.indexOf(x) === i).join("|");
  };
  const name = (s, lang) => {
    const v = s.value && typeof s.value === "object" ? s.value : {};
    const n = (lang === "en" && v.label_en) || v.label || s.key;
    return n.charAt(0).toUpperCase() + n.slice(1);
  };
  const run = (op, value) => async (ctx) => {
    const t = T[ctx.lang];
    if (!api.appVolume) return t.old;
    const s = ctx.slots.tonquelle || ctx.slots.app;
    const v = op === "set" ? Number((ctx.slots.prozent || ctx.slots.percent).value.value) / 100 : value;
    const r = await api.appVolume(terms(s), op, v);
    const n = name(s, ctx.lang);
    if (!r || !r.ok) return r?.error === "keine Wiedergabe" ? t.silent(n) : r?.error === "kein Audiogerät" ? t.device : t.fail;
    if (op === "mute") return t.muted(n);
    if (op === "unmute") return t.unmuted(n);
    if (op === "get") return t.get(n, r.volume, r.muted);
    return t.now(n, r.volume);
  };
  // Platzhalter {tonquelle} (Programme, die Ton machen) – nicht alle Apps, das würde die Erkennung aufblähen
  const both = (list) => list.map((p) => p.replace(/\{s\}/g, "{tonquelle}"));
  api.command(both(["{s} leiser", "mach {s} leiser", "{s} (etwas|ein bisschen) leiser"]), run("down", 0.2));
  api.command(both(["{s} lauter", "mach {s} lauter", "{s} (etwas|ein bisschen) lauter"]), run("up", 0.2));
  api.command(both(["{s} stumm [schalten]", "(schalte|schalt|mach) {s} stumm"]), run("mute"));
  api.command(both(["{s} (wieder an|ton an)", "{s} nicht mehr stumm", "(schalte|schalt) {s} wieder (an|laut)"]), run("unmute"));
  api.command(both(["{s} auf {prozent} prozent", "(stelle|stell|mach) {s} auf {prozent} prozent", "lautstärke von {s} auf {prozent} [prozent]"]), run("set"));
  api.command(both(["wie laut ist {s}", "lautstärke von {s}"]), run("get"));
  api.command(both(["turn {s} (down|lower)", "{s} quieter", "make {s} quieter", "lower [the] volume of {s}"]), run("down", 0.2), { lang: "en" });
  api.command(both(["turn {s} up", "{s} louder", "make {s} louder", "raise [the] volume of {s}"]), run("up", 0.2), { lang: "en" });
  api.command(both(["mute {s}"]), run("mute"), { lang: "en" });
  api.command(both(["turn {s} back on", "{s} sound on"]), run("unmute"), { lang: "en" });
  api.command(both(["set {s} [volume] to {percent} percent", "{s} to {percent} percent", "set [the] volume of {s} to {percent} [percent]"]), run("set"), { lang: "en" });
  api.command(both(["how loud is {s}", "volume of {s}"]), run("get"), { lang: "en" });
};
