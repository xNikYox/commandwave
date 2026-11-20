// CommandWave – Routinen: mehrere Schritte auf ein Wort, zu einer Uhrzeit oder beim Start.
//
// Gespeichert in routinen.json im Datenordner:
//   { "routines": [ {
//       "id": "r1", "name": "Arbeitsmodus", "enabled": true,
//       "phrases": ["arbeitsmodus"],                              ← Auslöser: Satz (kommt in die Erkennung)
//       "times": [ { "time": "08:00", "days": [1, 2, 3, 4, 5] } ],  ← Auslöser: Uhrzeit an Wochentagen (0 = Sonntag … 6 = Samstag)
//       "onStart": false,                                         ← Auslöser: beim Start von CommandWave (nach dem Anmelden)
//       "steps": [ { "type": "command", "text": "öffne die app editor" }, { "type": "app", "target": "spotify" },
//                  { "type": "website", "url": "https://…" }, { "type": "volume", "value": 30 },
//                  { "type": "wait", "seconds": 5 }, { "type": "say", "text": "Los geht's!" } ] } ] }
//
// Schritte laufen nacheinander; klappt einer nicht, geht es trotzdem weiter – am Ende kommt eine Zusammenfassung.
const STEP_TYPES = ["command", "app", "website", "volume", "wait", "say"];
const MAX_WAIT = 3600; // Sekunden
const MAX_STEPS = 50;
const DAY_NAMES = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

/** Satz für die Erkennung: klein, nur Buchstaben/Ziffern (keine Muster-Zeichen wie [ ] ( ) |) */
const cleanPhrase = (t) => String(t || "").toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80);

/** Routine prüfen und aufräumen (aus dem Fenster oder aus der Datei) → Routine oder null */
function normalize(r, makeId = () => "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)) {
  if (!r || typeof r !== "object") return null;
  const name = String(r.name || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 60);
  if (!name) return null;
  const phrases = [...new Set([].concat(r.phrases || []).map(cleanPhrase).filter((p) => p && p.split(" ").length <= 8))].slice(0, 5);
  const times = [].concat(r.times || []).map((t) => ({ time: /^([01]?\d|2[0-3]):[0-5]\d$/.test(String(t?.time || "")) ? String(t.time).padStart(5, "0") : null,
    days: [...new Set([].concat(t?.days ?? [0, 1, 2, 3, 4, 5, 6]).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() }))
    .filter((t) => t.time && t.days.length).slice(0, 10);
  const steps = [].concat(r.steps || []).map(normalizeStep).filter(Boolean).slice(0, MAX_STEPS);
  return { id: /^[\w-]{1,40}$/.test(r.id || "") ? r.id : makeId(), name, enabled: r.enabled !== false, phrases, times, onStart: !!r.onStart, steps };
}

function normalizeStep(s) {
  if (!s || !STEP_TYPES.includes(s.type)) return null;
  const text = (v) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 300);
  switch (s.type) {
    case "command":
    case "say":
      return text(s.text) ? { type: s.type, text: text(s.text) } : null;
    case "app":
      return text(s.target) ? { type: "app", target: text(s.target) } : null;
    case "website": {
      let url = text(s.url);
      if (url && !/^[a-z][a-z0-9+.-]*:/i.test(url)) url = "https://" + url; // „youtube.com“ → https://youtube.com
      return /^https?:\/\/\S+$/i.test(url) ? { type: "website", url } : null;
    }
    case "volume":
      return { type: "volume", value: Math.max(0, Math.min(100, Math.round(Number(s.value) || 0))) };
    case "wait":
      return { type: "wait", seconds: Math.max(1, Math.min(MAX_WAIT, Math.round(Number(s.seconds) || 1))) };
  }
  return null;
}

/** Nächster Zeitpunkt (Date) für einen Zeit-Auslöser ab „from“ (ausschließlich) – null, wenn keine Tage gewählt */
function nextTime(trigger, from) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(trigger?.time || "");
  const days = trigger?.days || [];
  if (!m || !days.length) return null;
  for (let add = 0; add <= 7; add++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + add, Number(m[1]), Number(m[2]), 0, 0);
    if (d > from && days.includes(d.getDay())) return d;
  }
  return null;
}

/** Nächster Lauf einer Routine (frühester ihrer Zeit-Auslöser) → Date oder null */
function nextRun(routine, from) {
  if (!routine?.enabled) return null;
  let best = null;
  for (const t of routine.times || []) {
    const d = nextTime(t, from);
    if (d && (!best || d < best)) best = d;
  }
  return best;
}

/**
 * Zeitplan: weckt zum nächsten fälligen Zeitpunkt und startet die Routinen. Höchstens eine Stunde am Stück schlafen
 * (danach neu rechnen – so stimmt es auch nach Ruhezustand oder Zeitumstellung). Jede Routine läuft je Minute nur einmal.
 * env = { now(), setTimeout, clearTimeout, run(routine) } – austauschbar für Tests.
 */
class Scheduler {
  constructor(env = {}) {
    this.env = { now: () => new Date(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (t) => clearTimeout(t), run: () => {}, ...env };
    this.routines = [];
    this.timer = null;
    this.fired = new Set();
    this.from = null; // ab hier wird gesucht (Ende des letzten Laufs)
  }

  update(routines) {
    this.routines = routines || [];
    this.schedule();
  }

  stop() {
    if (this.timer) this.env.clearTimeout(this.timer);
    this.timer = null;
  }

  /** nächste fällige Zeit über alle Routinen → { at, list } */
  next() {
    const now = this.env.now();
    const base = new Date(now.getTime() - 1000);
    const from = this.from && this.from > base && this.from <= now ? this.from : base;
    let at = null;
    for (const r of this.routines) {
      const d = nextRun(r, from);
      if (d && (!at || d < at)) at = d;
    }
    return { at, list: at ? this.routines.filter((r) => nextRun(r, from)?.getTime() === at.getTime()) : [] };
  }

  schedule() {
    this.stop();
    const { at } = this.next();
    if (!at) return null;
    const ms = Math.max(0, Math.min(at.getTime() - this.env.now().getTime(), 3600 * 1000));
    this.timer = this.env.setTimeout(() => this.tick(), ms);
    this.timer?.unref?.();
    return at;
  }

  tick() {
    this.timer = null;
    const now = this.env.now();
    const { at, list } = this.next();
    if (at && at <= now) {
      // verpasst (PC schlief länger als 2 Minuten): nicht nachholen – eine Morgen-Routine um 14 Uhr wäre falsch
      const late = now.getTime() - at.getTime() > 2 * 60 * 1000;
      for (const r of list) {
        const key = `${r.id}@${at.getTime()}`;
        if (this.fired.has(key) || late) continue;
        this.fired.add(key);
        Promise.resolve().then(() => this.env.run(r)).catch(() => {});
      }
      this.from = at;
      if (this.fired.size > 500) this.fired = new Set([...this.fired].slice(-100));
    }
    this.schedule();
  }
}

/**
 * Schritte nacheinander ausführen – ein Fehler hält die anderen nicht auf.
 * exec = { command(text), app(target), website(url), volume(value), wait(seconds), say(text) } (je async, Fehler = Ausnahme)
 * → { ok, total, failed: [{ index, step, label, error }] }
 */
async function runSteps(routine, exec, { onStep = () => {} } = {}) {
  const failed = [];
  const steps = routine.steps || [];
  for (const [index, step] of steps.entries()) {
    onStep(index, step);
    try {
      const fn = exec[step.type];
      if (!fn) throw new Error("unbekannter Schritt " + step.type);
      if (step.type === "command" || step.type === "say") await fn(step.text);
      else if (step.type === "app") await fn(step.target);
      else if (step.type === "website") await fn(step.url);
      else if (step.type === "volume") await fn(step.value);
      else if (step.type === "wait") await fn(step.seconds);
    } catch (e) {
      failed.push({ index, step, label: stepLabel(step), error: String(e?.message || e) });
    }
  }
  return { ok: !failed.length, total: steps.length, failed };
}

/** Schritt als kurzer Text (Fenster, Zusammenfassung) */
function stepLabel(s) {
  switch (s?.type) {
    case "command": return `„${s.text}“`;
    case "app": return `${s.target} starten`;
    case "website": return `${String(s.url).replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "")} öffnen`;
    case "volume": return `Lautstärke ${s.value} %`;
    case "wait": return s.seconds >= 60 && s.seconds % 60 === 0 ? `${s.seconds / 60} Min. warten` : `${s.seconds} Sek. warten`;
    case "say": return `sagen: „${s.text}“`;
  }
  return "?";
}

/** Auslöser als kurzer Text: „„arbeitsmodus“ · Mo–Fr 08:00 · beim Start“ */
function triggerLabel(r) {
  const parts = (r.phrases || []).map((p) => `„${p}“`);
  for (const t of r.times || []) parts.push(`${daysLabel(t.days)} ${t.time}`);
  if (r.onStart) parts.push("beim Start");
  return parts.join(" · ") || "nur von Hand";
}

/** Wochentage kurz: [1,2,3,4,5] → „Mo–Fr“, alle → „täglich“ */
function daysLabel(days) {
  const set = [...new Set(days)].sort();
  if (set.length === 7) return "täglich";
  const order = [1, 2, 3, 4, 5, 6, 0].filter((d) => set.includes(d));
  // zusammenhängende Folge (Mo–Fr, Sa–So) zusammenfassen
  const pos = order.map((d) => (d + 6) % 7);
  if (order.length >= 3 && pos.every((p, i) => !i || p === pos[i - 1] + 1)) return `${DAY_NAMES[order[0]]}–${DAY_NAMES[order.at(-1)]}`;
  return order.map((d) => DAY_NAMES[d]).join(", ");
}

/** Antwort am Ende einer Routine */
function summary(name, result) {
  if (!result.total) return `Die Routine ${name} hat noch keine Schritte.`;
  if (result.ok) return `Routine ${name} ist fertig.`;
  const n = result.failed.length;
  return `Routine ${name} ist fertig – ${n === 1 ? "ein Schritt hat" : n + " Schritte haben"} nicht geklappt: ${result.failed.map((f) => f.label).join(", ")}.`;
}

module.exports = { STEP_TYPES, DAY_NAMES, normalize, normalizeStep, cleanPhrase, nextTime, nextRun, Scheduler, runSteps, stepLabel, triggerLabel, daysLabel, summary };
