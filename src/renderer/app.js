// CommandWave – Fenster: Zuhören, Antwort sprechen, Befehle, Mods & Updates, Einstellungen.
// „cw“ stellt preload.js global bereit (contextBridge) – nicht neu deklarieren, sonst bricht das Skript ab
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const speech = new Speech();
let state = null;
let ready = false;

/* ---------------- Status ---------------- */
function setStatus(text, mode = "") {
  $("#status").textContent = text;
  document.body.dataset.mode = mode; // "" | listening | thinking | speaking | error
  if (typeof wave !== "undefined") wave.kick();
  cw.overlay({ mode, text, ...(mode === "listening" ? { heard: "" } : {}) }); // Overlay zeigt sich nur, wenn das Fenster nicht vorne ist
}
// Pegel fürs Overlay (das Fenster selbst zeichnet nicht, solange es versteckt ist)
setInterval(() => speech.listening && cw.overlay({ level: speech.level }), 90);
const idle = () => setStatus(state?.settings.hotkey ? `Bereit – ${keyLabel()} drücken und sprechen` : "Bereit – Mikrofon anklicken und sprechen", "");

/* ---------------- Zuhören → verstehen → antworten ---------------- */
const MIN_CONF = 0.45; // darunter lieber nachfragen als einen falschen Befehl ausführen

/** Modell-Adressen relativ zur Seite (in der App cw://app/…) */
const modelUrls = () => Object.fromEntries(Object.entries(state.models || {}).map(([l, u]) => [l, new URL(u.replace(/^cw:\/\/app\//, ""), location.href).href]));
const primaryLang = () => (state.settings.language === "en" ? "en" : "de");

async function ensureModels() {
  const urls = modelUrls();
  if (!speech.loaded || JSON.stringify(Object.keys(urls).sort()) !== JSON.stringify(Object.keys(speech.urls).sort())) {
    setStatus(primaryLang() === "en" ? "Loading speech recognition …" : "Lade Spracherkennung …", "thinking");
    await speech.load(urls);
  }
  speech.setGrammar(state.grammars);
}

const micError = (e) => (e.name === "NotAllowedError" ? "Kein Zugriff aufs Mikrofon – in Windows unter Datenschutz → Mikrofon erlauben" : e.name === "NotFoundError" ? "Kein Mikrofon gefunden" : "Fehler: " + e.message);
const listeningText = (lang) => ((lang || (state.settings.language === "both" ? "de" : primaryLang())) === "en" ? "Listening …" : "Ich höre zu …");

/** Einmal zuhören (mit Befehlsliste) → [{ lang, text, conf }] */
async function hear({ lang = null, maxSeconds } = {}) {
  const s = state.settings;
  if (s.beep) speech.beep(true);
  setTimeout(() => wave.kick(), 50);
  const results = await speech.listen({
    deviceId: s.micId,
    maxSeconds: maxSeconds || s.maxSeconds,
    onStart: () => setStatus(listeningText(lang), "listening"),
    onPartial: (t) => (bubble("#heard", t), cw.overlay({ heard: t })),
  });
  if (s.beep) speech.beep(false);
  return results.filter((r) => r.text && (!lang || r.lang === lang));
}

let busy = false;
async function listen() {
  if (!ready) return;
  if (speech.listening) return speech.stop();
  if (busy) return;
  busy = true;
  speech.cancel();
  speech.stopWake(); // Aktivierungswort pausiert, solange CommandWave zuhört und antwortet
  $("#heard").hidden = true;
  $("#answer").hidden = true;
  $("#listCard").hidden = true; // Liste vom letzten Befehl (z. B. Notizen) ausblenden
  try {
    await ensureModels();
    alarm.ctx?.suspend().catch(() => {}); // Weckton beim Zuhören pausieren, sonst versteht er „Wecker aus“ nicht
    const heard = await hear();
    alarm.ctx?.resume().catch(() => {});
    // sehr unsichere Erkennungen nicht ausführen, sondern nachfragen („Meintest du …?“)
    const sure = heard.filter((r) => r.conf == null || r.conf >= MIN_CONF);
    let r = heard.length && !sure.length ? await cw.commandMulti(heard, { unsure: true }) : await cw.commandMulti(sure);
    if (r.needFree) r = await freeTail(r);
    else if (!r.ok && !r.nothing && heard.length) r = await recheck(r);
    await answer(r, (sure.length ? sure : heard).map((x) => x.text).join(" / "));
  } catch (e) {
    setStatus(micError(e), "error");
  }
  busy = false;
  scheduleUnload();
  startWake();
}

/** „Hey Wave, öffne Editor“ in einem Satz: Befehl gleich ausführen (wie nach dem Zuhören) */
async function runHeard(heard) {
  if (busy) return;
  busy = true;
  speech.stopWake();
  try {
    const sure = heard.filter((r) => r.conf == null || r.conf >= MIN_CONF);
    // nach dem Aktivierungswort gibt es keine eigene Aufnahme: Namen fragt der Befehl dann nach
    await answer(sure.length ? await cw.commandMulti(sure, { noFree: true }) : await cw.commandMulti(heard, { unsure: true, noFree: true }), heard.map((x) => x.text).join(" / "));
  } catch (e) {
    setStatus("Fehler: " + e.message, "error");
  }
  busy = false;
  startWake();
}

/** Genaue Erkennung der letzten Aufnahme mit Whisper (wenn eingeschaltet) → Text oder "" */
async function accurate(lang) {
  if (!state.settings.whisper) return "";
  setStatus(lang === "en" ? "Listening more closely …" : "Ich höre genauer hin …", "thinking");
  const w = await speech.transcribe(lang);
  if (!w.ok) console.warn("Whisper:", w.error);
  return w.ok ? String(w.text || "").trim() : "";
}

/** Befehl mit Namen („spiel lieder von SDP“): dieselbe Aufnahme genau (Whisper) oder frei (Vosk) erkennen */
async function freeTail(r) {
  setStatus(r.lang === "en" ? "One moment …" : "Einen Moment …", "thinking");
  const w = await accurate(r.lang);
  const f = w ? { text: w, conf: 0.85 } : await speech.recognizeAudio(r.lang);
  if (f.text) bubble("#heard", f.text);
  return cw.commandMulti([{ lang: r.lang, text: f.text || r.heard, conf: f.conf }], { free: r.command });
}

/**
 * Nicht (sicher) erkannt: Whisper hört dieselbe Aufnahme genau an. Passt das zu einem Befehl → ausführen;
 * sonst wenigstens anzeigen, was wirklich gesagt wurde (z. B. „bunt“ statt „und“).
 */
async function recheck(r) {
  const lang = r.lang || primaryLang();
  const w = await accurate(lang);
  if (!w) return r;
  let r2 = await cw.commandMulti([{ lang, text: w, conf: 0.85 }], r.confirm ? {} : { unsure: false });
  if (r2.needFree) r2 = await cw.commandMulti([{ lang, text: w, conf: 0.85 }], { free: r2.command });
  if (r2.ok || r2.confirm) return r2;
  return { ...r, heard: w, confirm: r.confirm }; // weiterhin unbekannt – aber mit dem richtig verstandenen Text
}

/** „Meintest du …?“ – Frage vorlesen, Ja/Nein hören, dann ausführen (oder nicht) */
async function confirmFlow(r) {
  const heard = await hear({ lang: r.lang, maxSeconds: 4 });
  const text = heard[0]?.text || "";
  bubble("#heard", text || "…");
  return cw.confirm(text);
}

/* Rückfrage eines Befehls (z. B. „Was soll ich suchen?“): vorlesen, frei zuhören, Antwort zurück */
cw.onAsk(async ({ id, say: q, lang }) => {
  let text = null;
  try {
    speech.stopWake();
    bubble("#answer", q);
    setStatus(q, "speaking");
    await say(q, lang);
    await ensureModels();
    if (!speech.models[lang]) throw new Error("Sprachmodell " + lang + " nicht geladen");
    if (state.settings.beep) speech.beep(true);
    const r = await speech.listenFree(lang, {
      deviceId: state.settings.micId,
      maxSeconds: Math.max(6, state.settings.maxSeconds),
      onStart: () => setStatus(listeningText(lang), "listening"),
      onPartial: (t) => (bubble("#heard", t), cw.overlay({ heard: t })),
    });
    if (state.settings.beep) speech.beep(false);
    text = r.text || null;
    bubble("#heard", text || "…");
    setStatus(lang === "en" ? "One moment …" : "Einen Moment …", "thinking");
  } catch (e) {
    setStatus(micError(e), "error");
  }
  cw.askAnswer(id, text);
});

/* ---------------- Weckton: sanft, wird über 90 Sekunden lauter, höchstens 15 Minuten ---------------- */
const alarm = { ctx: null, timer: null, stopAt: 0 };
function alarmTone(on) {
  clearInterval(alarm.timer);
  if (alarm.ctx) alarm.ctx.close().catch(() => {});
  alarm.ctx = null;
  if (!on) return;
  const ctx = new AudioContext();
  alarm.ctx = ctx;
  const start = ctx.currentTime;
  alarm.stopAt = Date.now() + 15 * 60 * 1000;
  const master = ctx.createGain();
  master.connect(ctx.destination);
  master.gain.setValueAtTime(0.03, start);
  master.gain.linearRampToValueAtTime(0.6, start + 90);
  // kleine Melodie (Dreiklang) alle 2 Sekunden
  const play = () => {
    if (Date.now() > alarm.stopAt) return alarmTone(false);
    const t0 = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.8, t0 + i * 0.18 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.18 + 0.5);
      o.connect(g).connect(master);
      o.start(t0 + i * 0.18);
      o.stop(t0 + i * 0.18 + 0.55);
    });
  };
  play();
  alarm.timer = setInterval(play, 2000);
}
cw.onSound(({ name, on }) => name === "alarm" && alarmTone(on));

/* ---------------- Aktivierungswort ---------------- */
async function startWake() {
  const s = state?.settings;
  if (!ready || !s?.wake || busy || speech.listening || speech.wakeActive) return;
  try {
    await ensureModels();
    const lang = speech.models[primaryLang()] ? primaryLang() : Object.keys(speech.models)[0];
    await speech.startWake({ lang, phrase: s.wakeWord || "hey wave", deviceId: s.micId, distractors: state.grammars?.[lang] || [], onWake: (rest, conf) => (rest ? runHeard([{ lang, text: rest, conf }]) : listen()) });
  } catch (e) {
    setStatus("Aktivierungswort: " + micError(e), "error");
  }
}

/** Sparmodus: Sprachmodell nach einigen Minuten ohne Benutzung aus dem Speicher nehmen */
let unloadTimer = null;
function scheduleUnload() {
  clearTimeout(unloadTimer);
  const min = Number(state.settings.unloadMinutes) || 0;
  if (min > 0) unloadTimer = setTimeout(() => speech.unload(), min * 60 * 1000);
}

/** Eingetippter Text: in allen eingestellten Sprachen versuchen, die passendste gewinnt */
async function handle(text) {
  const langs = state.settings.language === "both" ? ["de", "en"] : [primaryLang()];
  await answer(await cw.commandMulti(langs.map((lang) => ({ lang, text, conf: null })), { confirm: false }), text);
}

/** Ergebnis anzeigen und vorlesen */
async function answer(r, heardText) {
  bubble("#heard", r.heard || heardText || (r.lang === "en" ? "(nothing heard)" : "(nichts verstanden)"));
  if (r.say) {
    bubble("#answer", r.say, r.ok || r.confirm ? "" : "miss");
    setStatus(r.say, "speaking");
    await say(r.say, r.lang);
  } else if (r.ok) bubble("#answer", "✓");
  if (r.confirm) return answer(await confirmFlow(r)); // Ergebnis der Rückfrage hat nie wieder eine Rückfrage
  if (r.mod === "notizen") renderNotes();
  idle();
}

/** Vorlesen mit der Stimme der passenden Sprache (Deutsch: Windows-Stimme oder Piper, je nach Einstellung) */
function say(text, lang) {
  const s = state.settings;
  const l = lang || guessLang(text);
  return speech.speak(text, { voice: l === "en" ? s.voiceEn : s.voice, rate: Number(s.rate) || 1, volume: Number(s.volume), lang: l,
    backend: s.tts || "windows", synth: (t) => cw.ttsSynth(t), onFallback: ttsFallback });
}
/** Piper klappt nicht: Windows-Stimme spricht, einmal Bescheid sagen */
let ttsWarned = false;
function ttsFallback(e) {
  console.warn("Piper:", e.message);
  if (ttsWarned) return;
  ttsWarned = true;
  $("#hint").textContent = "Die Piper-Stimme klappt gerade nicht – ich nehme die Windows-Stimme. (" + e.message + ")";
}
/** Sprache eines Textes grob erkennen (für Meldungen ohne Sprachangabe, z. B. abgelaufene Timer) */
const guessLang = (t) => (/[äöüß]|\b(der|die|das|ist|und|nicht|ich|wird)\b/i.test(t) ? "de" : /\b(the|is|your|you|it|and|not)\b/i.test(t) ? "en" : primaryLang());

function bubble(sel, text, cls = "") {
  const el = $(sel);
  el.textContent = text;
  el.className = "bubble " + (sel === "#heard" ? "you" : "cw") + (cls ? " " + cls : "");
  el.hidden = !text;
}

$("#mic").addEventListener("click", listen);
cw.onListen(listen);
// Routinen: vorlesen, wenn die laufende Ausgabe fertig ist – und Bescheid geben, wenn dieser Satz fertig ist
cw.onSpeakWait(async ({ id, text, lang }) => {
  try {
    await speech.speaking;
    bubble("#answer", text);
    await say(text, lang || guessLang(text));
  } finally {
    cw.speakDone(id);
  }
});

/* ---------------- Liste (Notizen, Dateien zur Auswahl): Nummer sagen oder anklicken ---------------- */
cw.onList(({ title, items, choose }) => {
  const card = $("#listCard");
  card.hidden = !items.length;
  card.classList.toggle("pick", !!choose);
  $("#listTitle").textContent = title;
  $("#listItems").innerHTML = items.map((t, i) => `<li data-pick="${i + 1}">${esc(t.replace(/^\d+\.\s*/, ""))}</li>`).join("");
  if (choose) for (const li of $$("[data-pick]", card)) li.onclick = () => {
    speech.stop(); // Zuhören beenden – der Klick ist die Antwort
    cw.listPick(Number(li.dataset.pick));
  };
});
cw.onSpeak(async (text) => {
  bubble("#answer", text);
  await say(text, guessLang(text));
});
$("#typed").addEventListener("submit", async (e) => {
  e.preventDefault();
  const t = $("#typedInput").value.trim();
  if (!t) return;
  $("#typedInput").value = "";
  await handle(t);
});

/* ---------------- Wellen-Anzeige (nur beim Zuhören/Sprechen – sonst keine Rechenzeit) ---------------- */
const wave = (function () {
  const c = $("#wave");
  const g = c.getContext("2d");
  let phase = 0;
  let running = false;
  const active = () => !document.hidden && (speech.listening || document.body.dataset.mode === "speaking");
  const drawLine = () => {
    g.clearRect(0, 0, c.width, c.height);
    const grad = g.createLinearGradient(0, 0, c.width, 0);
    grad.addColorStop(0, "rgba(124,108,255,.8)");
    grad.addColorStop(1, "rgba(34,211,238,.8)");
    g.strokeStyle = grad;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, c.height / 2);
    g.lineTo(c.width, c.height / 2);
    g.stroke();
  };
  const frame = () => {
    if (!active()) {
      running = false;
      return drawLine(); // Ruhe: eine gerade Linie, keine weiteren Bilder
    }
    const w = c.width;
    const h = c.height;
    g.clearRect(0, 0, w, h);
    const lvl = speech.listening ? 0.15 + speech.level : 0.35;
    phase += speech.listening ? 0.22 : 0.08;
    for (const [k, a] of [[1, 1], [1.7, 0.5], [2.6, 0.3]]) {
      g.beginPath();
      for (let x = 0; x <= w; x += 4) {
        const env = Math.sin((x / w) * Math.PI);
        const y = h / 2 + Math.sin(x / (18 / k) + phase * k) * env * lvl * (h / 2.4) * a;
        x ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      const grad = g.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, "rgba(124,108,255," + 0.9 * a + ")");
      grad.addColorStop(1, "rgba(34,211,238," + 0.9 * a + ")");
      g.strokeStyle = grad;
      g.lineWidth = 2;
      g.stroke();
    }
    requestAnimationFrame(frame);
  };
  drawLine();
  return {
    kick() {
      if (!running && active()) {
        running = true;
        requestAnimationFrame(frame);
      }
    },
  };
})();
document.addEventListener("visibilitychange", () => wave.kick());

/* ---------------- Tabs ---------------- */
$$(".tab").forEach((b) => b.addEventListener("click", () => {
  $$(".tab").forEach((x) => x.classList.toggle("on", x === b));
  $$(".page").forEach((p) => p.classList.toggle("on", p.id === "page-" + b.dataset.tab));
  if (b.dataset.tab === "routinen") renderRoutines();
  if (b.dataset.tab === "notizen") renderNotes();
}));

/* ---------------- Befehle ---------------- */
function renderCommands() {
  const q = $("#search").value.trim().toLowerCase();
  const byMod = new Map();
  for (const c of state.commands) {
    if (q && !c.phrases.some((p) => p.toLowerCase().includes(q)) && !c.mod.includes(q)) continue;
    if (!byMod.has(c.mod)) byMod.set(c.mod, []);
    byMod.get(c.mod).push(c);
  }
  const name = (id) => state.mods.find((m) => m.id === id)?.name || id;
  $("#commands").innerHTML = [...byMod].map(([mod, cmds]) => `
    <div class="group"><h4>${esc(name(mod))}</h4>
      ${cmds.map((c) => {
        const slotNames = [...new Set(c.phrases.flatMap((p) => [...p.matchAll(/\{([\w-]+)\}/g)].map((m) => m[1])))];
        return `<div class="cmd"><span class="say">„${esc(example(c.phrases[0]))}“</span>
          ${c.phrases.length > 1 ? `<small>auch: ${c.phrases.slice(1, 4).map((p) => "„" + esc(example(p)) + "“").join(", ")}</small>` : ""}
          ${slotNames.map((n) => `<small class="slot">Statt <b>${esc(firstValue(n))}</b> geht auch: ${esc((state.slots?.[n] || []).filter((x, i, a) => a.indexOf(x) === i).slice(1, 12).join(", "))}${(state.slots?.[n] || []).length > 12 ? " …" : ""}</small>`).join("")}</div>`;
      }).join("")}
    </div>`).join("") || `<p class="muted center">Keine Befehle gefunden.</p>`;
}

/** Muster als Beispielsatz: [optional] mitnehmen, (a|b) → a, {platzhalter} → erster Wert */
const firstValue = (slot) => (state.slots?.[slot] || [])[0] || slot;
function example(pattern) {
  let t = pattern.replace(/\[([^\]]*)\]/g, "$1").replace(/\(([^)|]*)\|[^)]*\)/g, "$1").replace(/\(([^)]*)\)/g, "$1");
  t = t.replace(/\{([\w-]+)\}/g, (m, n) => firstValue(n));
  t = t.replace(/\s+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
$("#search").addEventListener("input", renderCommands);

/* ---------------- Mods & Updates ---------------- */
function renderMods() {
  const u = state.updates;
  const ups = u.list || [];
  $("#updates").innerHTML = [
    u.busy ? `<div class="note">Suche nach Updates …</div>` : "",
    ...ups.map((x) => `<div class="mod up">
      <div><b>${esc(x.name)}</b> <span class="ver">${x.isNew ? "neu" : esc(x.from) + " →"} ${esc(x.to)}</span>
        <small>${esc(x.description || "")}${x.script ? " · ⚠ enthält Programmcode – nur aus vertrauenswürdigen Quellen installieren" : ""}<br>Quelle: ${esc(x.sourceLabel)}</small></div>
      <button class="btn primary" data-install="${esc(x.id)}">${x.isNew ? "Installieren" : "Aktualisieren"}</button></div>`),
    ...(u.errors || []).map((e) => `<div class="note err">${esc(e.source)}: ${esc(e.error)}</div>`),
    ...(u.held || []).map((h) => `<div class="note">${esc(h.name)} ${esc(h.version)} braucht CommandWave ${esc(h.minApp)} – bis dahin bleibt deine Version.</div>`),
    u.checkedAt && !ups.length && !u.busy ? `<div class="note">Alle Mods sind aktuell (geprüft ${new Date(u.checkedAt).toLocaleTimeString("de-DE")}).</div>` : "",
    !state.settings.sources.length ? `<div class="note">Noch keine Update-Quelle eingetragen – unter Einstellungen → Mod-Updates.</div>` : "",
  ].join("");
  $("#mods").innerHTML = state.mods.map((m) => `<div class="mod${m.enabled ? "" : " off"}">
      <div><b>${esc(m.name)}</b> <span class="ver">${esc(m.version)}</span>${m.script ? ' <span class="tag">Skript</span>' : ""}
        <small>${esc(m.description)}</small>
        <small class="muted">${m.commands} Befehle${m.author ? " · von " + esc(m.author) : ""}${m.note ? " · " + esc(m.note) + " – ältere Version aktiv" : ""}${m.error ? ` · <span class="errtxt">${esc(m.error)}</span>` : ""}</small></div>
      <input type="checkbox" class="switch" data-toggle="${esc(m.id)}" ${m.enabled ? "checked" : ""} title="Mod an/aus">
    </div>`).join("");
  $("#modErrors").innerHTML = state.errors.filter((e) => !state.mods.some((m) => m.id === e.dir)).map((e) => `<div class="note err">Mod „${esc(e.dir)}“ nicht geladen: ${esc(e.error)}</div>`).join("");
  for (const b of $$("[data-install]")) b.onclick = async () => {
    const x = ups.find((y) => y.id === b.dataset.install);
    if (x?.isNew && x.script && !confirm(`„${x.name}“ enthält Programmcode, der mit deinen Rechten läuft.\n\nNur installieren, wenn du der Quelle vertraust:\n${x.sourceLabel}`)) return;
    b.disabled = true;
    b.textContent = "Lade …";
    const r = await cw.installMod(b.dataset.install);
    if (!r.ok) alert("Installation fehlgeschlagen: " + r.error);
    apply(r.state);
  };
  for (const c of $$("[data-toggle]")) c.onchange = async () => {
    const disabled = new Set(state.settings.disabled);
    c.checked ? disabled.delete(c.dataset.toggle) : disabled.add(c.dataset.toggle);
    const r = await cw.saveSettings({ disabled: [...disabled] });
    state.settings = r.settings;
  };
}
$("#reload").onclick = async () => apply(await cw.reloadMods());
$("#folder").onclick = () => cw.openModsFolder();
$("#check").onclick = async () => apply(await cw.checkUpdates());

function showHint() {
  $("#hint").textContent = `${state.commands.length} Befehle aus ${state.mods.filter((m) => m.enabled).length} Mods${state.foundApps ? ` · ${state.foundApps} Apps gefunden` : ""} · offline`;
}

/** Neuer Stand der Mods (nach Laden, Update, Umschalten, gefundenen Apps) */
function apply(mods) {
  Object.assign(state, mods);
  if (ready) showHint();
  if (ready) ensureModels().then(idle).catch((e) => setStatus("Fehler: " + e.message, "error"));
  renderCommands();
  renderMods();
  renderModSettings();
  if (ready) renderLearn();
}
cw.onMods(apply);

/* ---------------- Einstellungen ---------------- */
async function renderSettings() {
  const s = state.settings;
  for (const el of $$("[data-set]")) {
    const k = el.dataset.set;
    if (el.type === "checkbox") el.checked = !!s[k];
    else el.value = String(s[k]);
  }
  $("#hotkey").value = keyLabel();
  $("#hotkeyError").hidden = !state.hotkeyError;
  $("#hotkeyError").textContent = state.hotkeyError || "";
  $("#about").textContent = `CommandWave ${state.version} · Mods: ${state.modsDir} · alles läuft offline auf diesem PC`;
  // Mikrofone (Namen erst nach Erlaubnis sichtbar)
  const devs = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter((d) => d.kind === "audioinput");
  $("#mic-select").innerHTML = `<option value="">Standard-Mikrofon</option>` + devs.filter((d) => d.deviceId && d.deviceId !== "default").map((d, i) => `<option value="${esc(d.deviceId)}"${d.deviceId === s.micId ? " selected" : ""}>${esc(d.label || "Mikrofon " + (i + 1))}</option>`).join("");
  // Stimmen
  const voices = await speech.voicesReady();
  const de = voices.filter((v) => v.lang.toLowerCase().startsWith("de"));
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  const opts = (list, cur) => list.map((v) => `<option value="${esc(v.name)}"${v.name === cur ? " selected" : ""}>${esc(v.name)} (${esc(v.lang)})</option>`).join("");
  $("#voice").innerHTML = `<option value="">Automatisch (erste deutsche Stimme)</option>` + opts(de, s.voice);
  $("#voiceEn").innerHTML = `<option value="">Automatisch (erste englische Stimme)</option>` + opts(en, s.voiceEn);
  $("#voiceHint").textContent = de.length ? `${de.length} deutsche, ${en.length} englische Stimme${en.length === 1 ? "" : "n"}` : "Keine deutsche Stimme – Windows: Einstellungen → Zeit und Sprache → Sprache → Deutsch → Sprachausgabe installieren";
  $("#language").value = s.language || "de";
  $("#ttsEngine").value = s.tts || "windows";
  $("#voiceRow").hidden = (s.tts || "windows") !== "windows";
  $("#wakeWord").value = s.wakeWord || "hey wave";
  renderLearn();
  renderSources();
  renderModSettings();
}

for (const el of $$("[data-set]")) el.addEventListener("change", async () => {
  const k = el.dataset.set;
  const v = el.type === "checkbox" ? el.checked : el.dataset.num != null ? Number(el.value) : el.value;
  state.settings = (await cw.saveSettings({ [k]: v })).settings;
  if (k === "whisper") v ? speech.warmWhisper() : speech.unloadWhisper();
  if (k === "wake" || k === "micId") {
    speech.stopWake();
    startWake();
  }
});
$("#voice").onchange = async (e) => (state.settings = (await cw.saveSettings({ voice: e.target.value })).settings);
$("#voiceEn").onchange = async (e) => (state.settings = (await cw.saveSettings({ voiceEn: e.target.value })).settings);
$("#language").onchange = async (e) => {
  state.settings = (await cw.saveSettings({ language: e.target.value })).settings;
};
$("#wakeWord").onchange = async (e) => {
  state.settings = (await cw.saveSettings({ wakeWord: e.target.value })).settings;
  speech.stopWake();
  startWake();
};
$("#mic-select").onchange = async (e) => (state.settings = (await cw.saveSettings({ micId: e.target.value })).settings);
$("#testVoice").onclick = async () => {
  if (state.settings.language !== "en") await say("Hallo, ich bin CommandWave. Editor wird gestartet.", "de");
  if (state.settings.language !== "de") await say("Hi, I'm CommandWave. Starting Notepad.", "en");
};

$("#mic-select").addEventListener("change", () => {
  speech.stopWake();
  setTimeout(startWake, 100);
});

/* ---------------- Mikrofon-Test: Pegel + was verstanden würde (nichts ausführen) ---------------- */
$("#micTest").onclick = async () => {
  if (speech.listening) return speech.stop();
  if (busy || !ready) return;
  busy = true;
  const b = $("#micTest");
  const t = $("#micTestText");
  const bar = $("#micLevel");
  let peak = 0;
  let on = true;
  const loop = () => {
    if (!on) return (bar.style.width = "0");
    peak = Math.max(peak, speech.level);
    bar.style.width = Math.round(speech.level * 100) + "%";
    requestAnimationFrame(loop);
  };
  try {
    speech.stopWake();
    b.textContent = "Stopp";
    await ensureModels();
    requestAnimationFrame(loop);
    const res = await speech.listen({ deviceId: state.settings.micId, maxSeconds: state.settings.maxSeconds, onStart: () => (t.textContent = "Sprich jetzt …"), onPartial: (x) => (t.textContent = "Höre: „" + x + "“") });
    const p = await cw.preview(res.filter((r) => r.text));
    const quiet = peak < 0.08 ? " Sehr leise – Mikrofon näher halten oder in Windows den Pegel erhöhen." : "";
    if (!p.heard) t.textContent = "Nichts verstanden – ist das richtige Mikrofon gewählt?" + quiet;
    else {
      const conf = p.conf != null ? ` · Sicherheit ${Math.round(p.conf * 100)} %` : "";
      const what = p.command ? (p.sure ? ` → ${p.mod} („${p.suggestion}“)` : ` → würde nachfragen: „${p.suggestion}“?`) : " → kein passender Befehl";
      t.textContent = `Verstanden${p.lang === "en" ? " (English)" : ""}: „${p.heard}“${what}${conf}.${quiet}`;
    }
  } catch (e) {
    t.textContent = micError(e);
  }
  on = false;
  b.textContent = "Test starten";
  busy = false;
  startWake();
};

/* ---------------- Aussprache lernen ---------------- */
const SLOT_NAMES = { app: "App", seite: "Webseite", ordner: "Ordner", player: "Musik-App", suchseite: "Suchseite", einstellung: "Windows-Einstellung", _woerter: "Eigenes Wort (z. B. Name für die Suche)" };
const WORDS = "_woerter";
function renderLearn() {
  const learn = state.learn || {};
  const sel = $("#learnSlot");
  const cur = sel.value || "app";
  sel.innerHTML = [...Object.keys(learn), WORDS].map((k) => `<option value="${esc(k)}"${k === cur ? " selected" : ""}>${esc(SLOT_NAMES[k] || k)}</option>`).join("");
  renderLearnKeys();
  $("#learnLangRow").hidden = state.settings.language !== "both";
  $("#learnLang").value = primaryLang();
  // gelernte Varianten je Wert zusammenfassen: „deer balance“, „dear balance“ → DoctorBenx
  const groups = new Map();
  for (const [slot, list] of Object.entries(state.aliases || {})) for (const [heard, a] of Object.entries(list)) {
    const id = slot + "|" + a.key;
    if (!groups.has(id)) groups.set(id, { slot, key: a.key, lang: a.lang, heard: [] });
    groups.get(id).heard.push(heard);
  }
  const rows = [...groups.values()];
  $("#aliases").innerHTML = rows.map((r, i) => `<div class="alias"><span>${r.heard.map((h) => "„" + esc(h) + "“").join(", ")} → <b>${esc((learn[r.slot] || []).find(([k]) => k === r.key)?.[1] || r.key)}</b> <span class="muted">(${esc(r.slot === WORDS ? "Wort" : SLOT_NAMES[r.slot] || r.slot)}${r.lang === "en" ? ", English" : ""})</span></span>
    <button class="btn" data-unalias="${i}">Entfernen</button></div>`).join("");
  for (const b of $$("[data-unalias]")) b.onclick = async () => {
    const r = rows[Number(b.dataset.unalias)];
    for (const heard of r.heard) await cw.removeAlias({ slot: r.slot, heard });
  };
}
function renderLearnKeys() {
  const word = $("#learnSlot").value === WORDS;
  $("#learnKeyRow").hidden = word;
  $("#learnWordRow").hidden = !word;
  const list = (state.learn || {})[$("#learnSlot").value] || [];
  const cur = $("#learnKey").value;
  $("#learnKey").innerHTML = [...list].sort((a, b) => a[1].localeCompare(b[1], "de")).map(([k, label]) => `<option value="${esc(k)}"${k === cur ? " selected" : ""}>${esc(label)}${label.toLowerCase() !== k ? ` (${esc(k)})` : ""}</option>`).join("");
}
$("#learnSlot").onchange = renderLearnKeys;
$("#learnGo").onclick = async () => {
  if (busy || !ready) return;
  const slot = $("#learnSlot").value;
  const word = slot === WORDS;
  const key = word ? $("#learnWord").value.trim() : $("#learnKey").value;
  const label = word ? key : $("#learnKey").selectedOptions[0]?.textContent.replace(/ \(.*\)$/, "") || key;
  const lang = state.settings.language === "both" ? $("#learnLang").value : primaryLang();
  const t = $("#learnText");
  if (!slot || !key) return word && ($("#learnText").textContent = "Bitte zuerst das Wort eintippen.");
  busy = true;
  $("#learnGo").disabled = true;
  try {
    speech.stopWake();
    await ensureModels();
    if (!speech.models[lang]) throw new Error("Sprachmodell nicht geladen");
    const got = [];
    for (let i = 1; i <= 3; i++) {
      t.textContent = `Sag jetzt nur „${label}“ (${i}/3) …`;
      if (state.settings.beep) speech.beep(true);
      const r = await speech.listenFree(lang, { deviceId: state.settings.micId, maxSeconds: 4, onPartial: (x) => (t.textContent = `(${i}/3) „${x}“`) });
      if (r.text) got.push(r.text);
      // Namen hört CommandWave später mit Whisper – also auch mit Whisper lernen
      if (state.settings.whisper) {
        const w = await speech.transcribe(lang);
        if (w.ok && w.text) got.push(w.text);
      }
    }
    if (!got.length) t.textContent = "Nichts gehört – nochmal versuchen.";
    else {
      // alle verschiedenen Varianten merken – die Erkennung hört einen unbekannten Namen nicht immer gleich
      const r = await cw.addAlias({ slot, key, heard: got, lang });
      t.textContent = r.ok ? `Gelernt: ${r.heard.map((h) => "„" + h + "“").join(", ")} = ${label}.` : r.same ? `„${label}“ verstehe ich schon richtig.` : "Das ging nicht – bitte nur den Namen sagen (höchstens 4 Wörter).";
    }
  } catch (e) {
    t.textContent = micError(e);
  }
  $("#learnGo").disabled = false;
  busy = false;
  startWake();
};

// Tastenkombination aufnehmen: Feld anklicken, Kombination drücken (Entf/Rücktaste = keine, Esc = abbrechen).
// Während der Aufnahme sind die globalen Tastenkombinationen aus – sonst fängt Windows die alte Kombination ab.
const hk = $("#hotkey");
hk.addEventListener("focus", () => {
  hk.value = "Tasten drücken …";
  cw.pauseHotkeys();
});
hk.addEventListener("blur", () => {
  hk.value = keyLabel();
  cw.resumeHotkeys();
});
hk.addEventListener("keyup", (e) => {
  if (document.activeElement === hk && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && hk.value.endsWith("…")) hk.value = "Tasten drücken …";
});
hk.addEventListener("keydown", async (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (e.key === "Escape") return hk.blur();
  let r;
  if ((e.key === "Backspace" || e.key === "Delete") && !e.ctrlKey && !e.altKey && !e.metaKey) r = { acc: "", label: "" };
  else {
    r = Hotkey.fromEvent(e);
    if (!r) return;
    if (r.partial) return (hk.value = r.partial); // nur Strg/Alt/Umschalt gedrückt: weiter warten
  }
  const res = await cw.saveSettings({ hotkey: r.acc, hotkeyLabel: r.label });
  state.settings = res.settings;
  state.hotkeyError = res.hotkeyError;
  // eine Ziffernblock-Taste allein ist global belegt – darauf hinweisen
  if (!res.hotkeyError && /^num/.test(r.acc)) state.hotkeyError = `Hinweis: ${r.label} tippt in anderen Programmen dann nichts mehr. Besser z. B. Strg + ${r.label}. (Num-Lock muss an sein.)`;
  else if (!res.hotkeyError && /num/.test(r.acc)) state.hotkeyError = "Hinweis: Für Ziffernblock-Tasten muss Num-Lock an sein.";
  hk.blur();
  renderSettings();
  idle();
});
const keyLabel = () => (state.settings.hotkey ? state.settings.hotkeyLabel || Hotkey.pretty(state.settings.hotkey) : "keine");

// Update-Quellen
function renderSources() {
  const list = state.settings.sources;
  const label = (s) => (s.type === "github" ? `GitHub: ${s.repo}${s.dir ? "/" + s.dir : ""}` : s.type === "folder" ? `Ordner: ${s.path}` : `Adresse: ${s.url}`);
  $("#sources").innerHTML = list.length ? list.map((s, i) => `<div class="row src"><span class="mono">${esc(label(s))}</span><button class="btn" data-del="${i}">Entfernen</button></div>`).join("") : `<p class="muted small">Keine Quelle. Beispiele: GitHub „name/commandwave-mods“, Ordner „\\\\NAS\\Mods“.</p>`;
  for (const b of $$("[data-del]")) b.onclick = async () => {
    const next = list.filter((_, i) => i !== Number(b.dataset.del));
    state.settings = (await cw.saveSettings({ sources: next })).settings;
    renderSources();
  };
}
$("#srcType").onchange = (e) => ($("#srcValue").placeholder = { github: "name/repository (optional /ordner)", folder: "C:\\Mods oder \\\\NAS\\Mods", url: "https://…/mods/" }[e.target.value]);
$("#addSource").addEventListener("submit", async (e) => {
  e.preventDefault();
  const type = $("#srcType").value;
  const v = $("#srcValue").value.trim();
  let src;
  if (type === "github") {
    const m = /^(?:https:\/\/github\.com\/)?([\w.-]+\/[\w.-]+)(?:\/(.+))?$/.exec(v.replace(/\.git$/, ""));
    if (!m) return alert("Bitte als name/repository angeben.");
    src = { type, repo: m[1], branch: "main", dir: m[2] || "" };
  } else if (type === "folder") src = { type, path: v };
  else {
    if (!/^https?:\/\//.test(v)) return alert("Adresse muss mit https:// beginnen.");
    src = { type, url: v };
  }
  state.settings = (await cw.saveSettings({ sources: [...state.settings.sources, src] })).settings;
  $("#srcValue").value = "";
  renderSources();
});

/* ---------------- Natürliche Stimme (Piper): einmal laden mit Bestätigung, dann offline ---------------- */
$("#ttsEngine").onchange = async (e) => {
  const id = e.target.value;
  const t = $("#ttsText");
  const back = () => (e.target.value = state.settings.tts || "windows");
  if (id !== "windows") {
    const st = (await cw.ttsStatus())[id];
    if (!st.installed) {
      const mb = Math.max(1, Math.round(st.bytes / 1e6));
      if (!confirm(`Für „${st.label}“ lädt CommandWave einmalig ${mb} MB aus dem Internet (Piper von GitHub, die Stimme von Hugging Face).\n\nDanach spricht die Stimme komplett offline auf diesem PC. Jetzt laden?`)) return back();
      $("#ttsRow").hidden = false;
      $("#ttsMeter").hidden = false;
      e.target.disabled = true;
      t.textContent = "Lade …";
      const r = await cw.ttsInstall(id);
      e.target.disabled = false;
      $("#ttsMeter").hidden = true;
      if (!r.ok) {
        t.textContent = `Das Laden hat nicht geklappt: ${r.error} – es bleibt bei der Windows-Stimme.`;
        return back();
      }
    }
  }
  state.settings = (await cw.saveSettings({ tts: id })).settings;
  $("#voiceRow").hidden = id !== "windows";
  ttsWarned = false;
  $("#ttsRow").hidden = id === "windows";
  t.textContent = id === "windows" ? "" : "Fertig – die Stimme läuft jetzt offline.";
  await say("Hallo, so klinge ich jetzt. Editor wird gestartet.", "de");
};
cw.onTtsProgress((p) => {
  $("#ttsLevel").style.width = p.percent + "%";
  $("#ttsText").textContent = p.label === "fertig" ? "Richte die Stimme ein …" : `Lade ${p.label} … ${p.percent} % (${Math.round(p.done / 1e6)} von ${Math.round(p.total / 1e6)} MB)`;
});

/* ---------------- Einstellungen für Mods („settings“ in der mod.json, z. B. Discord-Tasten, OBS-Passwort) ---------------- */
/** SendKeys-Schreibweise lesbar machen: "^+m" → „Strg + Umschalt + M“ */
function keysLabel(k) {
  if (!k) return "keine";
  const m = /^([\^+%]*)(.*)$/.exec(k);
  const mods = [...m[1]].map((c) => ({ "^": "Strg", "+": "Umschalt", "%": "Alt" })[c]);
  return [...mods, m[2].replace(/^\{(.+)\}$/, "$1").toUpperCase()].join(" + ");
}
/** Tastendruck → SendKeys-Schreibweise ("^+m"); nur Strg/Alt/Umschalt gedrückt → null */
function keysFromEvent(e) {
  if (["Control", "Shift", "Alt", "Meta", "AltGraph"].includes(e.key)) return null;
  const named = { Enter: "{ENTER}", Tab: "{TAB}", " ": " ", Escape: "{ESC}", Backspace: "{BS}", Delete: "{DEL}", Insert: "{INS}", Home: "{HOME}", End: "{END}", PageUp: "{PGUP}", PageDown: "{PGDN}",
    ArrowUp: "{UP}", ArrowDown: "{DOWN}", ArrowLeft: "{LEFT}", ArrowRight: "{RIGHT}" };
  let key = named[e.key] || (/^F\d{1,2}$/.test(e.key) ? `{${e.key}}` : /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : /^Digit\d$/.test(e.code) ? e.code.slice(5) : e.key.length === 1 ? e.key.toLowerCase() : null);
  if (!key) return null;
  if ("+^%~(){}[]".includes(key)) key = `{${key}}`;
  return (e.ctrlKey ? "^" : "") + (e.altKey ? "%" : "") + (e.shiftKey ? "+" : "") + key;
}
function renderModSettings() {
  if (!state) return;
  const mods = state.mods.filter((m) => m.enabled && m.settings?.length);
  $("#modSettingsCard").hidden = !mods.length;
  const vals = state.settings.modSettings || {};
  $("#modSettings").innerHTML = mods.map((m) => `<div class="modset"><h4>${esc(m.name)}</h4>${m.settings.map((x) => {
    const v = vals[m.id]?.[x.key] ?? x.default ?? "";
    const attrs = `data-mod="${esc(m.id)}" data-key="${esc(x.key)}"`;
    const input = x.type === "hotkey" ? `<input class="key" readonly ${attrs} data-hotkey value="${esc(keysLabel(v))}">`
      : `<input ${x.type === "password" ? 'type="password"' : ""} ${attrs} value="${esc(v)}" placeholder="${esc(x.default || "")}" autocomplete="off">`;
    return `<label class="row"><span>${esc(x.label)}${x.help ? `<small class="sub">${esc(x.help)}</small>` : ""}</span>${input}</label>`;
  }).join("")}</div>`).join("");
  const save = async (el, v) => (state.settings = (await cw.saveModSettings(el.dataset.mod, { [el.dataset.key]: v })).settings);
  for (const el of $$("#modSettings input:not([data-hotkey])")) el.onchange = () => save(el, el.value.trim());
  for (const el of $$("#modSettings [data-hotkey]")) {
    el.onfocus = () => (el.value = "Tasten drücken …");
    el.onblur = () => renderModSettings();
    el.onkeydown = async (e) => {
      e.preventDefault();
      if (e.key === "Escape") return el.blur();
      const k = (e.key === "Backspace" || e.key === "Delete") && !e.ctrlKey && !e.altKey ? "" : keysFromEvent(e);
      if (k == null) return;
      await save(el, k);
      el.blur();
    };
  }
}

/* ---------------- Routinen ---------------- */
const STEP_NAMES = { command: "Befehl (wie gesprochen)", app: "App starten", website: "Webseite öffnen", volume: "Lautstärke setzen", wait: "Warten", say: "Etwas sagen" };
const DAYS = [[1, "Mo"], [2, "Di"], [3, "Mi"], [4, "Do"], [5, "Fr"], [6, "Sa"], [0, "So"]];
let routinesState = { list: [], running: [] };
let editing = null; // Routine im Editor (Kopie)

async function renderRoutines() {
  routinesState = await cw.routines();
  const list = routinesState.list;
  const needAuto = list.some((r) => r.enabled && r.onStart) && !routinesState.autostart;
  $("#routineAuto").hidden = !needAuto;
  $("#routineAuto").innerHTML = needAuto ? `„Beim Start“ läuft, sobald CommandWave startet. Damit das nach dem Anmelden passiert: <button class="btn mini" id="autoOn">Mit Windows starten</button>` : "";
  if (needAuto) $("#autoOn").onclick = async () => ((state.settings = (await cw.saveSettings({ autostart: true })).settings), renderSettings(), renderRoutines());
  $("#routines").innerHTML = list.length ? list.map((r) => `<div class="routine${r.enabled ? "" : " off"}">
      <div class="head"><b>${esc(r.name)}</b><span class="row-btns"><button class="btn mini" data-rrun="${esc(r.id)}">Starten</button><button class="btn mini" data-redit="${esc(r.id)}">Bearbeiten</button></span></div>
      <small>${esc(r.triggerLabel)}${r.next ? ` · nächster Lauf ${new Date(r.next).toLocaleString("de-DE", { weekday: "short", hour: "2-digit", minute: "2-digit" })}` : ""}</small>
      <small>${r.stepLabels.length ? r.stepLabels.map((x, i) => `${i + 1}. ${esc(x)}`).join(" · ") : "Noch keine Schritte"}</small>
      ${routinesState.running.includes(r.id) ? '<small class="running">läuft gerade …</small>' : ""}</div>`).join("")
    : `<p class="muted center small">Noch keine Routinen. Beispiel: „Arbeitsmodus“ → Editor und Outlook öffnen, Lautstärke 30 %, „Viel Erfolg!“ sagen.</p>`;
  for (const b of $$("[data-rrun]")) b.onclick = () => cw.runRoutine(b.dataset.rrun).then(() => setTimeout(renderRoutines, 300));
  for (const b of $$("[data-redit]")) b.onclick = () => editRoutine(list.find((r) => r.id === b.dataset.redit));
}
cw.onRoutine(() => $("#page-routinen").classList.contains("on") && renderRoutines());

function editRoutine(r) {
  editing = JSON.parse(JSON.stringify(r || { name: "", phrases: [], times: [], onStart: false, enabled: true, steps: [{ type: "command", text: "" }] }));
  $("#routineEdit").hidden = false;
  $("#rTitle").textContent = r ? "Routine bearbeiten" : "Neue Routine";
  $("#rDelete").hidden = !r;
  $("#rName").value = editing.name;
  $("#rPhrases").value = editing.phrases.join(", ");
  $("#rOnStart").checked = editing.onStart;
  $("#rEnabled").checked = editing.enabled;
  $("#rPhraseWarn").hidden = true;
  // Apps für „App starten“ zum Auswählen
  $("#appNames").innerHTML = [...new Set(state.slots?.app || [])].slice(0, 300).map((a) => `<option value="${esc(a)}">`).join("");
  renderTimes();
  renderSteps();
  $("#routineEdit").scrollIntoView({ behavior: "smooth" });
  $("#rName").focus();
}
function renderTimes() {
  $("#rTimes").innerHTML = editing.times.map((t, i) => `<div class="trow"><input type="time" data-time="${i}" value="${esc(t.time)}">
    <span class="days">${DAYS.map(([d, n]) => `<label><input type="checkbox" data-day="${i}" value="${d}"${t.days.includes(d) ? " checked" : ""}>${n}</label>`).join("")}</span>
    <button class="btn mini" data-tdel="${i}" type="button">✕</button></div>`).join("");
  for (const el of $$("[data-time]")) el.onchange = () => (editing.times[el.dataset.time].time = el.value);
  for (const el of $$("[data-day]")) el.onchange = () => {
    const t = editing.times[el.dataset.day];
    const d = Number(el.value);
    t.days = el.checked ? [...new Set([...t.days, d])] : t.days.filter((x) => x !== d);
  };
  for (const b of $$("[data-tdel]")) b.onclick = () => (editing.times.splice(Number(b.dataset.tdel), 1), renderTimes());
}
function stepInput(s, i) {
  const a = `data-sval="${i}"`;
  switch (s.type) {
    case "command": return `<input ${a} value="${esc(s.text || "")}" placeholder="z. B. öffne die app editor">`;
    case "say": return `<input ${a} value="${esc(s.text || "")}" placeholder="z. B. Viel Erfolg heute!">`;
    case "app": return `<input ${a} value="${esc(s.target || "")}" list="appNames" placeholder="z. B. Spotify">`;
    case "website": return `<input ${a} value="${esc(s.url || "")}" placeholder="z. B. youtube.com">`;
    case "volume": return `<input ${a} type="number" min="0" max="100" value="${esc(s.value ?? 30)}"> %`;
    case "wait": return `<input ${a} type="number" min="1" max="3600" value="${esc(s.seconds ?? 5)}"> Sekunden`;
  }
  return "";
}
function renderSteps() {
  $("#rSteps").innerHTML = editing.steps.map((s, i) => `<div class="srow"><span class="muted">${i + 1}.</span>
    <select data-stype="${i}">${Object.entries(STEP_NAMES).map(([k, n]) => `<option value="${k}"${k === s.type ? " selected" : ""}>${n}</option>`).join("")}</select>
    ${stepInput(s, i)}
    <button class="btn mini" data-sup="${i}" type="button" title="nach oben">↑</button><button class="btn mini" data-sdel="${i}" type="button" title="entfernen">✕</button></div>`).join("");
  const field = { command: "text", say: "text", app: "target", website: "url", volume: "value", wait: "seconds" };
  for (const el of $$("[data-stype]")) el.onchange = () => ((editing.steps[el.dataset.stype] = { type: el.value }), renderSteps());
  for (const el of $$("[data-sval]")) el.oninput = () => {
    const s = editing.steps[el.dataset.sval];
    s[field[s.type]] = el.type === "number" ? Number(el.value) : el.value;
  };
  for (const b of $$("[data-sup]")) b.onclick = () => {
    const i = Number(b.dataset.sup);
    if (i > 0) [editing.steps[i - 1], editing.steps[i]] = [editing.steps[i], editing.steps[i - 1]];
    renderSteps();
  };
  for (const b of $$("[data-sdel]")) b.onclick = () => (editing.steps.splice(Number(b.dataset.sdel), 1), renderSteps());
}
/** Kennt die Erkennung die Wörter? Sonst Hinweis: so schreiben, wie es klingt */
async function checkPhrases() {
  const phrases = $("#rPhrases").value.split(",").map((x) => x.trim()).filter(Boolean);
  const r = phrases.length ? await cw.checkPhrases(phrases) : { unknown: [] };
  $("#rPhraseWarn").hidden = !r.unknown.length;
  $("#rPhraseWarn").textContent = r.unknown.length ? `Diese Wörter kennt die Spracherkennung nicht: ${r.unknown.join(", ")}. Schreib sie so, wie sie klingen (z. B. „disk kord“ statt „discord“) – sonst klappt nur „Starte Routine …“.` : "";
}
$("#rPhrases").onchange = checkPhrases;
$("#newRoutine").onclick = () => editRoutine(null);
$("#rAddTime").onclick = () => (editing.times.push({ time: "08:00", days: [1, 2, 3, 4, 5] }), renderTimes());
$("#rAddStep").onclick = () => (editing.steps.push({ type: "command", text: "" }), renderSteps());
$("#rCancel").onclick = () => (($("#routineEdit").hidden = true), (editing = null));
$("#rDelete").onclick = async () => {
  if (!editing?.id || !confirm(`Routine „${editing.name}“ löschen?`)) return;
  await cw.deleteRoutine(editing.id);
  $("#routineEdit").hidden = true;
  renderRoutines();
};
$("#rSave").onclick = async () => {
  editing.name = $("#rName").value.trim();
  editing.phrases = $("#rPhrases").value.split(",").map((x) => x.trim()).filter(Boolean);
  editing.onStart = $("#rOnStart").checked;
  editing.enabled = $("#rEnabled").checked;
  const r = await cw.saveRoutine(editing);
  if (!r.ok) return alert(r.error);
  await checkPhrases();
  if ($("#rPhraseWarn").hidden) $("#routineEdit").hidden = true;
  editing = { ...editing, id: r.routine.id };
  renderRoutines();
};

/* ---------------- Notizen ---------------- */
async function renderNotes() {
  const notes = await cw.notes();
  $("#notes").innerHTML = notes.length ? notes.map((n, i) => `<div class="notec"><div><span class="n">${i + 1}.</span>${esc(n.text)}<small>${new Date(n.at).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}</small></div>
    <button class="btn mini" data-ndel="${esc(n.id)}">Löschen</button></div>`).join("") : `<p class="muted center small">Noch keine Notizen.</p>`;
  for (const b of $$("[data-ndel]")) b.onclick = async () => (await cw.deleteNote(b.dataset.ndel), renderNotes());
}
$("#noteAdd").addEventListener("submit", async (e) => {
  e.preventDefault();
  const t = $("#noteInput").value.trim();
  if (!t) return;
  $("#noteInput").value = "";
  await cw.addNote(t);
  renderNotes();
});

/* ---------------- App-Updates ---------------- */
/** Hinweis oben im Fenster: automatische Updates klemmen seit einer Weile, oder ein Update wartet schon lange */
function renderBanner(u) {
  const b = $("#updBanner");
  const DAY = 24 * 3600 * 1000;
  let text = "";
  let btn = "";
  if (u.status === "error" && u.errorSince && Date.now() - u.errorSince > 10 * 60 * 1000) {
    text = "Automatische Updates klappen gerade nicht. Lade die neueste Version einfach von Hand – Einstellungen und Mods bleiben erhalten.";
    btn = "Neueste Version laden";
  } else if (u.status === "ready" && u.readyAt && Date.now() - u.readyAt > DAY) {
    text = `Version ${u.version} wartet schon seit ${Math.floor((Date.now() - u.readyAt) / DAY) > 1 ? Math.floor((Date.now() - u.readyAt) / DAY) + " Tagen" : "gestern"} auf die Installation.`;
    btn = "Jetzt neu starten";
  }
  b.hidden = !text;
  $("#updBannerText").textContent = text;
  $("#updBannerBtn").textContent = btn;
}
$("#updBannerBtn").onclick = async () => ((await cw.appUpdate()).status === "ready" ? cw.installAppUpdate() : cw.downloadApp());
$("#updBannerReport").onclick = () => $("#copyReport").click();
$("#copyReport").onclick = async () => {
  const r = await cw.copyReport();
  $("#reportText").textContent = r.ok ? `Kopiert (${Math.round(r.chars / 1000)} KB) – jetzt mit Strg + V einfügen und schicken.` : "Das ging nicht.";
};
$("#openLogs").onclick = () => cw.openLogs();
setInterval(async () => renderBanner(await cw.appUpdate()), 10 * 60 * 1000);

function renderAppUpdate(u) {
  renderBanner(u);
  const t = {
    idle: "Updates kommen automatisch.", dev: "Im Entwicklungsmodus keine Updates.", checking: "Suche nach Updates …", current: "Du hast die neueste Version.",
    downloading: `Lade Version ${u.version || ""} … ${u.percent || 0} %`, ready: `Version ${u.version} ist bereit – wird installiert, wenn du CommandWave ein paar Minuten nicht benutzt.`, error: "Update-Prüfung fehlgeschlagen: " + (u.error || ""),
  };
  $("#appUpdateText").textContent = `Version ${state.version} · ` + (t[u.status] || t.idle);
  const b = $("#appUpdateBtn");
  b.textContent = u.status === "ready" ? "Jetzt neu starten" : "Nach Updates suchen";
  b.disabled = u.status === "checking" || u.status === "downloading";
}
$("#appUpdateBtn").onclick = async () => {
  const u = await cw.appUpdate();
  if (u.status === "ready") return cw.installAppUpdate();
  renderAppUpdate({ status: "checking" });
  renderAppUpdate(await cw.checkAppUpdate());
};
cw.onAppUpdate(renderAppUpdate);

/* ---------------- Start ---------------- */
(async () => {
  state = await cw.state();
  renderCommands();
  renderMods();
  renderSettings();
  cw.appUpdate().then(renderAppUpdate);
  if (state.smoke) console.log("Testmodus: lade Modell …", location.href);
  try {
    await ensureModels(); // im Worker braucht Vosk volle Adressen
    if (state.smoke) console.log("Testmodus: Modelle geladen", Object.keys(speech.models).join(", "));
    ready = true;
    idle();
    showHint();
    startWake();
    // Whisper im Leerlauf vorladen, damit die erste genaue Erkennung nicht warten muss
    if (state.settings.whisper && !state.smoke) setTimeout(() => speech.warmWhisper(), 8000);
  } catch (e) {
    setStatus("Spracherkennung konnte nicht geladen werden: " + e.message, "error");
  }
  if (state.smoke) smokeTest();
})();

/** Testmodus: Windows-Stimme spricht Testsätze → Erkennung je Sprache und mit beiden Sprachen gleichzeitig */
async function audioTest() {
  const decode = async (url) => (await new AudioContext({ sampleRate: 16000 }).decodeAudioData(await (await fetch(url)).arrayBuffer())).getChannelData(0);
  const recognize = (lang, pcm) => new Promise((resolve) => {
    const rec = new speech.models[lang].KaldiRecognizer(16000, JSON.stringify(state.grammars[lang]));
    rec.setWords(true);
    const t0 = performance.now();
    rec.on("result", (m) => {
      const words = (m.result.result || []).filter((w) => w.word !== "[unk]");
      resolve({ lang, text: m.result.text, conf: words.length ? words.reduce((a, w) => a + w.conf, 0) / words.length : null, ms: Math.round(performance.now() - t0) });
      rec.remove();
    });
    for (let i = 0; i < pcm.length; i += 1600) rec.acceptWaveformFloat(pcm.slice(i, i + 1600), 16000);
    rec.acceptWaveformFloat(new Float32Array(8000), 16000);
    rec.retrieveFinalResult();
    setTimeout(() => resolve({ lang, text: null, ms: 15000 }), 15000);
  });
  const results = [];
  for (const a of (state.audio || []).filter((x) => x.kind === "command")) {
    const pcm = await decode(a.url);
    const want = (await cw.match(a.text, a.lang))?.command || null;
    const own = await recognize(a.lang, pcm);
    const ownCmd = own.text ? (await cw.match(own.text, a.lang))?.command || null : null;
    // beide Sprachen: wie in der App – passendster Treffer gewinnt
    const both = await Promise.all(["de", "en"].map((l) => recognize(l, pcm)));
    let pick = null;
    for (const b of both) {
      const m = b.text ? await cw.match(b.text, b.lang) : null;
      const rank = m ? m.score + 0.15 * (b.conf ?? 0.7) : -1;
      if (!pick || rank > pick.rank) pick = { ...b, command: m?.command || null, rank };
    }
    results.push({ said: a.text, lang: a.lang, want, heard: own.text, conf: own.conf && Math.round(own.conf * 100) / 100, ok: !!want && ownCmd === want, both: { lang: pick.lang, heard: pick.text, ok: !!want && pick.command === want } });
  }
  const summary = {};
  for (const l of ["de", "en"]) {
    const r = results.filter((x) => x.lang === l);
    summary[l] = { richtig: r.filter((x) => x.ok).length + "/" + r.length, mitBeidenSprachen: r.filter((x) => x.both.ok).length + "/" + r.length, spracheErkannt: r.filter((x) => x.both.lang === l).length + "/" + r.length };
  }
  return { summary, results };
}

/** Testmodus: Aktivierungswort (muss bei „hey wave“ auslösen, bei normalen Befehlen nicht) und freie Erkennung */
async function wakeFreeTest() {
  const decode = async (url) => (await new AudioContext({ sampleRate: 16000 }).decodeAudioData(await (await fetch(url)).arrayBuffer())).getChannelData(0);
  const feed = (rec, pcm) => new Promise((resolve) => {
    const got = [];
    let t = null;
    const done = () => (clearTimeout(t), clearTimeout(fallback), rec.remove(), resolve(got));
    // fertig, wenn nach dem letzten Ergebnis kurz nichts mehr kommt
    rec.on("result", (m) => (got.push(m), clearTimeout(t), (t = setTimeout(done, 250))));
    const fallback = setTimeout(done, 4000);
    for (let i = 0; i < pcm.length; i += 1600) rec.acceptWaveformFloat(pcm.slice(i, i + 1600), 16000);
    rec.acceptWaveformFloat(new Float32Array(12000), 16000);
    rec.retrieveFinalResult();
  });
  const wake = async (lang, phrase, pcm) => {
    const rec = new speech.models[lang].KaldiRecognizer(16000, JSON.stringify(Speech.wakeGrammar(phrase, state.grammars[lang])));
    rec.setWords(true);
    const got = await feed(rec, pcm);
    const hit = got.map((m) => Speech.wakeMatch(m, phrase)).find(Boolean);
    return { fired: !!hit, rest: hit?.rest, conf: hit && Math.round(hit.conf * 100) / 100, heard: got.map((m) => m.result.text).filter(Boolean).join(" | ") };
  };
  const audio = state.audio || [];
  const out = { wake: [], falseAlarms: [], free: [] };
  for (const a of audio.filter((x) => x.kind === "wake")) {
    const pcm = await decode(a.url);
    const phrase = a.wakeWord || a.text;
    for (const lang of ["de", "en"]) out.wake.push({ said: a.text, lang, ...(await wake(lang, phrase, pcm)) });
  }
  // Fehlalarme: normale Befehle dürfen „hey wave“ nicht auslösen
  for (const a of audio.filter((x) => x.kind === "command")) {
    const pcm = await decode(a.url);
    const r = await wake(a.lang, "hey wave", pcm);
    if (r.fired) out.falseAlarms.push({ said: a.text, heard: r.heard });
  }
  for (const a of [...audio.filter((x) => x.kind === "free"), ...audio.filter((x) => x.kind === "command" && x.lang === "en").slice(0, 4)]) {
    const rec = speech.freeRecognizer(a.lang);
    const got = await feed(rec, await decode(a.url));
    out.free.push({ said: a.text, heard: got.map((m) => m.result.text).filter(Boolean).join(" ") });
  }
  // Befehl mit Namen: Befehls-Erkennung → „frei erkennen“ → dieselbe Aufnahme frei → Befehl mit Namen
  out.tail = [];
  for (const a of audio.filter((x) => x.kind === "tail")) {
    const pcm = await decode(a.url);
    const rec = new speech.models[a.lang].KaldiRecognizer(16000, JSON.stringify(state.grammars[a.lang]));
    rec.setWords(true);
    const got = await feed(rec, pcm);
    const first = got.map((m) => m.result.text).filter(Boolean).join(" ");
    const r1 = await cw.match(first, a.lang);
    const f = await speech.recognizeAudio(a.lang, pcm);
    out.tail.push({ said: a.text, grammar: first, command: r1?.command || null, free: f.text });
  }
  // Whisper (genaue Erkennung): Namen-Sätze und echte menschliche Aufnahmen (Wikimedia, Deutsch)
  out.whisper = { warm: await speech.warmWhisper(), results: [] };
  for (const a of audio.filter((x) => x.kind === "tail" || x.kind === "human")) {
    let pcm;
    try {
      pcm = await decode(a.url);
    } catch (e) {
      out.whisper.results.push({ said: a.text, error: "nicht lesbar: " + e.message });
      continue;
    }
    let vosk = "";
    if (a.kind === "human") {
      const rec = new speech.models[a.lang].KaldiRecognizer(16000, JSON.stringify(state.grammars[a.lang]));
      rec.setWords(true);
      vosk = (await feed(rec, pcm)).map((m) => m.result.text).filter(Boolean).join(" ");
    }
    const w = await speech.transcribe(a.lang, pcm);
    out.whisper.results.push({ said: a.text, vosk, whisper: w.text, ms: w.ms, error: w.error });
  }
  out.summary = { wakeEn: out.wake.filter((w) => w.lang === "en" && w.fired).length + "/" + out.wake.filter((w) => w.lang === "en").length,
    wakeDe: out.wake.filter((w) => w.lang === "de" && w.fired).length + "/" + out.wake.filter((w) => w.lang === "de").length,
    falseAlarms: out.falseAlarms.length + "/" + audio.filter((x) => x.kind === "command").length,
    freeRichtig: out.free.filter((f) => f.heard === f.said).length + "/" + out.free.length };
  return out;
}

/** Testmodus: Modell geladen? Erkenner verarbeitet Ton? Befehle laufen? Stimmen da? → an den Hauptprozess */
async function smokeTest() {
  const out = { ok: false, ready, status: $("#status").textContent, commands: state.commands.length, grammar: state.grammar.length, mods: state.mods.length };
  try {
    if (ready) {
      // 1,5 s fast-Stille einspeisen: der Erkenner muss ein (leeres) Endergebnis liefern
      out.recognizer = await new Promise((resolve) => {
        const ctx = new OfflineAudioContext(1, 24000, 16000);
        const buf = ctx.createBuffer(1, 24000, 16000);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() - 0.5) * 0.002;
        speech.session = { onResult: (_l, m) => resolve({ text: m.result?.text ?? null }), onPart() {} };
        const rec = speech.recs.de || Object.values(speech.recs)[0];
        rec.acceptWaveform(buf);
        rec.retrieveFinalResult();
        setTimeout(() => resolve({ text: null, timeout: true }), 15000);
      });
      speech.session = null;
    }
    out.audioTest = await audioTest();
    out.wakeFree = await wakeFreeTest();
    out.overlay = await cw.overlayTest();
    out.confirm = await cw.commandMulti([{ lang: "de", text: "welcher tag ist", conf: 0.9 }], {}); // knapp daneben → Rückfrage „Meintest du …?“
    out.confirmNo = await cw.confirm("nein");
    out.report = await cw.copyReport();
    alarmTone(true);
    await new Promise((r) => setTimeout(r, 600));
    out.alarmTone = alarm.ctx ? alarm.ctx.state : "keiner";
    alarmTone(false);
    out.time = await cw.command("wie spät ist es", "de");
    out.unknown = await cw.command("erzähl mir einen witz", "de");
    out.timeEn = await cw.command("what time is it", "en");
    out.models = Object.keys(speech.models);
    const voices = await speech.voicesReady();
    out.voices = voices.map((v) => `${v.name} (${v.lang})`);
    out.ok = ready && out.recognizer && !out.recognizer.timeout && out.time.ok && /Uhr/.test(out.time.say) && out.unknown.say === "Diesen Befehl kenne ich leider nicht." &&
      out.timeEn.ok && /^It's /.test(out.timeEn.say) && out.models.length === 2 && !!out.overlay?.ok && out.confirm.confirm === true && out.confirmNo.cancelled === true && out.report?.ok === true && out.report.chars > 500 &&
      (out.wakeFree.wake.length === 0 || out.wakeFree.wake.some((w) => w.fired));
  } catch (e) {
    out.error = e.message;
  }
  cw.smoke(out);
}
