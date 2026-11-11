// Beispiel-Mod mit eigener Logik. CommandWave ruft diese Funktion beim Laden auf und übergibt die Mod-Schnittstelle „api“:
//   api.command(sätze, handler)  Befehl anlegen; handler bekommt ctx (ctx.slots, ctx.text) und gibt den Antworttext zurück
//   api.slot(name, werte)        Platzhalter-Werte ergänzen
//   api.say(text)                später etwas sagen (z. B. wenn der Timer abläuft)
//   api.notify(titel, text)      Windows-Benachrichtigung
//   api.run(programm, args) · api.open(adresse) · api.media(taste) · api.storage.get()/set() · api.log(...)
module.exports = (api) => {
  const TAGE = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
  const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

  api.command(["wie spät ist es", "wie viel uhr ist es", "sag mir die uhrzeit", "uhrzeit"], () => {
    const d = new Date();
    const m = d.getMinutes();
    return `Es ist ${d.getHours()} Uhr${m ? " " + m : ""}.`;
  });

  api.command(["welcher tag ist heute", "welches datum (ist|haben wir) heute", "datum"], () => {
    const d = new Date();
    return `Heute ist ${TAGE[d.getDay()]}, der ${d.getDate()}. ${MONATE[d.getMonth()]} ${d.getFullYear()}.`;
  });

  // Timer: „stelle einen Timer auf fünf Minuten“ – {zahl} kommt aus den slots in mod.json
  const timers = [];
  api.command(["(stelle|stell) [einen] timer (auf|für) {zahl} (minute|minuten)", "timer {zahl} (minute|minuten)", "erinnere mich in {zahl} (minute|minuten)"], (ctx) => {
    const min = Number(ctx.slots.zahl.value);
    const t = setTimeout(() => {
      api.say(`Der Timer über ${min} ${min === 1 ? "Minute" : "Minuten"} ist abgelaufen.`);
      api.notify("CommandWave", `Timer abgelaufen (${min} min)`);
      timers.splice(timers.indexOf(t), 1);
    }, min * 60 * 1000);
    timers.push(t);
    return `Timer auf ${min} ${min === 1 ? "Minute" : "Minuten"} gestellt.`;
  });

  api.command(["(lösche|stoppe) [alle] timer", "timer (aus|stopp)"], () => {
    const n = timers.length;
    timers.splice(0).forEach(clearTimeout);
    return n ? `${n} ${n === 1 ? "Timer" : "Timer"} gelöscht.` : "Es läuft gerade kein Timer.";
  });
};
