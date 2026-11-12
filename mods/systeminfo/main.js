// Systeminfo: Akku, Arbeitsspeicher, Laufwerk, CPU-Auslastung und -Temperatur, Laufzeit.
module.exports = (api) => {
  const gb = (b, lang) => (b / 1024 ** 3).toLocaleString(lang === "en" ? "en-US" : "de-DE", { maximumFractionDigits: b < 10 * 1024 ** 3 ? 1 : 0 });
  const dur = (sec, lang) => {
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const de = lang !== "en";
    const part = (n, one, many) => (n ? `${n} ${n === 1 ? one : many}` : "");
    const parts = d ? [part(d, de ? "Tag" : "day", de ? "Tagen" : "days"), part(h, de ? "Stunde" : "hour", de ? "Stunden" : "hours")]
      : [part(h, de ? "Stunde" : "hour", de ? "Stunden" : "hours"), part(m, de ? "Minute" : "minute", de ? "Minuten" : "minutes")];
    return parts.filter(Boolean).join(de ? " und " : " and ") || (de ? "weniger als einer Minute" : "less than a minute");
  };
  const S = {
    de: {
      battery: (i) => (!i.battery ? "Dieser PC hat keinen Akku." : `Der Akku ist bei ${i.battery.percent} Prozent${i.battery.charging ? " und lädt" : i.battery.remaining ? `, das reicht noch etwa ${dur(i.battery.remaining, "de")}` : ""}.`),
      memory: (i) => `Der Arbeitsspeicher ist zu ${Math.round((1 - i.memFree / i.memTotal) * 100)} Prozent belegt – ${gb(i.memFree, "de")} von ${gb(i.memTotal, "de")} GB sind frei.`,
      disk: (i) => (i.disk ? `Auf dem Systemlaufwerk sind noch ${gb(i.disk.free, "de")} von ${gb(i.disk.total, "de")} GB frei.` : "Den Speicherplatz konnte ich nicht lesen."),
      cpu: (i) => `Die CPU ist gerade zu ${i.cpu} Prozent ausgelastet.`,
      temp: (i) => (i.temp != null ? `Die CPU ist etwa ${i.temp} Grad warm.` : "Die Temperatur gibt Windows ohne Zusatzprogramm leider nicht heraus."),
      uptime: (i) => `Der PC läuft seit ${dur(i.uptime, "de")}.`,
    },
    en: {
      battery: (i) => (!i.battery ? "This PC has no battery." : `The battery is at ${i.battery.percent} percent${i.battery.charging ? " and charging" : i.battery.remaining ? `, about ${dur(i.battery.remaining, "en")} left` : ""}.`),
      memory: (i) => `Memory is ${Math.round((1 - i.memFree / i.memTotal) * 100)} percent full, ${gb(i.memFree, "en")} of ${gb(i.memTotal, "en")} GB free.`,
      disk: (i) => (i.disk ? `The system drive has ${gb(i.disk.free, "en")} of ${gb(i.disk.total, "en")} GB free.` : "I couldn't read the disk space."),
      cpu: (i) => `The CPU is at ${i.cpu} percent.`,
      temp: (i) => (i.temp != null ? `The CPU is about ${i.temp} degrees.` : "Windows doesn't report the temperature without an extra tool, sorry."),
      uptime: (i) => `The PC has been running for ${dur(i.uptime, "en")}.`,
    },
  };
  api.helpers = { dur, S }; // für Tests
  const ask = (...keys) => async (ctx) => {
    if (!api.systemInfo) return ctx.lang === "en" ? "Please update CommandWave for that." : "Dafür brauche ich eine neuere CommandWave-Version.";
    const i = await api.systemInfo();
    return keys.map((k) => S[ctx.lang][k](i)).filter((x) => !(keys.length > 1 && /keinen Akku|no battery/.test(x))).join(" ");
  };
  api.command(["wie viel akku [habe ich] [noch]", "wie voll ist [der] akku", "(akku|akku stand|batterie|batterie stand)"], ask("battery"));
  api.command(["wie voll ist [der|mein] (arbeitsspeicher|ram)", "wie viel (arbeitsspeicher|ram) ist frei", "(arbeitsspeicher|ram) auslastung"], ask("memory"));
  api.command(["wie viel (speicherplatz|platz) ist [noch] frei", "wie voll ist [die|meine] festplatte", "(festplatte|speicherplatz)"], ask("disk"));
  api.command(["wie ausgelastet ist [die|der] (cpu|prozessor)", "(cpu|prozessor) auslastung"], ask("cpu"));
  api.command(["wie warm ist [die|der|mein] (cpu|prozessor|pc|computer)", "(cpu|prozessor) temperatur"], ask("temp"));
  api.command(["wie lange läuft [der|mein] (pc|computer) [schon]"], ask("uptime"));
  api.command(["(system info|systemstatus|system status)", "wie geht es [dem|meinem] (pc|computer)"], ask("cpu", "memory", "disk", "battery"));
  api.command(["how much battery [do i have] [left]", "battery [level|status]"], ask("battery"), { lang: "en" });
  api.command(["how full is [the|my] (memory|ram)", "how much (memory|ram) is free", "(memory|ram) usage"], ask("memory"), { lang: "en" });
  api.command(["how much (disk|storage) space is [left|free]", "how full is [my|the] (disk|drive)", "disk space"], ask("disk"), { lang: "en" });
  api.command(["how busy is [the] (cpu|processor)", "(cpu|processor) (usage|load)"], ask("cpu"), { lang: "en" });
  api.command(["how hot is [the|my] (cpu|processor|computer|pc)", "(cpu|processor) temperature"], ask("temp"), { lang: "en" });
  api.command(["how long has [my|the] (pc|computer) been (on|running)", "uptime"], ask("uptime"), { lang: "en" });
  api.command(["system (info|status)", "how is my (pc|computer) doing"], ask("cpu", "memory", "disk", "battery"), { lang: "en" });
};
