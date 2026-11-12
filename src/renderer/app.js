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
  speechSynthesis.cancel();
  speech.stopWake(); // Aktivierungswort pausiert, solange CommandWave zuhört und antwortet
  $("#heard").hidden = true;
  $("#answer").hidden = true;
  try {
    await ensureModels();
    const heard = await hear();
    // sehr unsichere Erkennungen nicht ausführen, sondern nachfragen („Meintest du …?“)
    const sure = heard.filter((r) => r.conf == null || r.conf >= MIN_CONF);
    const r = heard.length && !sure.length ? await cw.commandMulti(heard, { unsure: true }) : await cw.commandMulti(sure);
    await answer(r, (sure.length ? sure : heard).map((x) => x.text).join(" / "));
  } catch (e) {
    setStatus(micError(e), "error");
  }
  busy = false;
  scheduleUnload();
  startWake();
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

/* ---------------- Aktivierungswort ---------------- */
async function startWake() {
  const s = state?.settings;
  if (!ready || !s?.wake || busy || speech.listening || speech.wakeActive) return;
  try {
    await ensureModels();
    const lang = speech.models[primaryLang()] ? primaryLang() : Object.keys(speech.models)[0];
    await speech.startWake({ lang, phrase: s.wakeWord || "hey wave", deviceId: s.micId, onWake: () => listen() });
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
  idle();
}

/** Vorlesen mit der Stimme der passenden Sprache */
function say(text, lang) {
  const s = state.settings;
  const l = lang || guessLang(text);
  return speech.speak(text, { voice: l === "en" ? s.voiceEn : s.voice, rate: Number(s.rate) || 1, volume: Number(s.volume), lang: l });
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
    u.checkedAt && !ups.length && !u.busy ? `<div class="note">Alle Mods sind aktuell (geprüft ${new Date(u.checkedAt).toLocaleTimeString("de-DE")}).</div>` : "",
    !state.settings.sources.length ? `<div class="note">Noch keine Update-Quelle eingetragen – unter Einstellungen → Mod-Updates.</div>` : "",
  ].join("");
  $("#mods").innerHTML = state.mods.map((m) => `<div class="mod${m.enabled ? "" : " off"}">
      <div><b>${esc(m.name)}</b> <span class="ver">${esc(m.version)}</span>${m.script ? ' <span class="tag">Skript</span>' : ""}
        <small>${esc(m.description)}</small>
        <small class="muted">${m.commands} Befehle${m.author ? " · von " + esc(m.author) : ""}${m.error ? ` · <span class="errtxt">${esc(m.error)}</span>` : ""}</small></div>
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
  $("#wakeWord").value = s.wakeWord || "hey wave";
  renderLearn();
  renderSources();
}

for (const el of $$("[data-set]")) el.addEventListener("change", async () => {
  const k = el.dataset.set;
  const v = el.type === "checkbox" ? el.checked : el.dataset.num != null ? Number(el.value) : el.value;
  state.settings = (await cw.saveSettings({ [k]: v })).settings;
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
const SLOT_NAMES = { app: "App", seite: "Webseite", ordner: "Ordner", player: "Musik-App", suchseite: "Suchseite", einstellung: "Windows-Einstellung" };
function renderLearn() {
  const learn = state.learn || {};
  const sel = $("#learnSlot");
  const cur = sel.value || "app";
  sel.innerHTML = Object.keys(learn).map((k) => `<option value="${esc(k)}"${k === cur ? " selected" : ""}>${esc(SLOT_NAMES[k] || k)}</option>`).join("");
  renderLearnKeys();
  $("#learnLangRow").hidden = state.settings.language !== "both";
  $("#learnLang").value = primaryLang();
  const rows = Object.entries(state.aliases || {}).flatMap(([slot, list]) => Object.entries(list).map(([heard, a]) => ({ slot, heard, ...a })));
  $("#aliases").innerHTML = rows.map((r) => `<div class="alias"><span>„${esc(r.heard)}“ → <b>${esc((learn[r.slot] || []).find(([k]) => k === r.key)?.[1] || r.key)}</b> <span class="muted">(${esc(SLOT_NAMES[r.slot] || r.slot)}${r.lang === "en" ? ", English" : ""})</span></span>
    <button class="btn" data-unalias="${esc(r.slot)}|${esc(r.heard)}">Entfernen</button></div>`).join("");
  for (const b of $$("[data-unalias]")) b.onclick = async () => {
    const [slot, heard] = b.dataset.unalias.split("|");
    await cw.removeAlias({ slot, heard });
  };
}
function renderLearnKeys() {
  const list = (state.learn || {})[$("#learnSlot").value] || [];
  const cur = $("#learnKey").value;
  $("#learnKey").innerHTML = [...list].sort((a, b) => a[1].localeCompare(b[1], "de")).map(([k, label]) => `<option value="${esc(k)}"${k === cur ? " selected" : ""}>${esc(label)}${label.toLowerCase() !== k ? ` (${esc(k)})` : ""}</option>`).join("");
}
$("#learnSlot").onchange = renderLearnKeys;
$("#learnGo").onclick = async () => {
  if (busy || !ready) return;
  const slot = $("#learnSlot").value;
  const key = $("#learnKey").value;
  const label = $("#learnKey").selectedOptions[0]?.textContent.replace(/ \(.*\)$/, "") || key;
  const lang = state.settings.language === "both" ? $("#learnLang").value : primaryLang();
  const t = $("#learnText");
  if (!slot || !key) return;
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
    }
    if (!got.length) t.textContent = "Nichts gehört – nochmal versuchen.";
    else {
      // was am häufigsten verstanden wurde
      const count = new Map();
      for (const g of got) count.set(g, (count.get(g) || 0) + 1);
      const heard = [...count].sort((a, b) => b[1] - a[1])[0][0];
      const r = await cw.addAlias({ slot, key, heard, lang });
      t.textContent = r.same ? `„${label}“ verstehe ich schon richtig.` : r.ok ? `Gelernt: „${r.heard}“ = ${label}. (Gehört: ${got.map((g) => "„" + g + "“").join(", ")})` : "Das ging nicht – bitte nur den Namen sagen (höchstens 4 Wörter).";
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

/* ---------------- App-Updates ---------------- */
function renderAppUpdate(u) {
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
    const rec = new speech.models[lang].KaldiRecognizer(16000, JSON.stringify(Speech.wakeGrammar(phrase)));
    rec.setWords(true);
    const got = await feed(rec, pcm);
    return { fired: got.some((m) => Speech.isWake(m, phrase)), heard: got.map((m) => m.result.text).filter(Boolean).join(" | ") };
  };
  const audio = state.audio || [];
  const out = { wake: [], falseAlarms: [], free: [] };
  for (const a of audio.filter((x) => x.kind === "wake")) {
    const pcm = await decode(a.url);
    for (const lang of ["de", "en"]) out.wake.push({ said: a.text, lang, ...(await wake(lang, a.text, pcm)) });
  }
  // Fehlalarme: normale Befehle dürfen „hey wave“ nicht auslösen
  for (const a of [...audio.filter((x) => x.kind === "command" && x.lang === "de").slice(0, 8), ...audio.filter((x) => x.kind === "command" && x.lang === "en").slice(0, 8)]) {
    const pcm = await decode(a.url);
    const r = await wake(a.lang, "hey wave", pcm);
    if (r.fired) out.falseAlarms.push({ said: a.text, heard: r.heard });
  }
  for (const a of audio.filter((x) => x.kind === "free" || (x.kind === "command" && x.lang === "en")).slice(0, 6)) {
    const rec = speech.freeRecognizer(a.lang);
    const got = await feed(rec, await decode(a.url));
    out.free.push({ said: a.text, heard: got.map((m) => m.result.text).filter(Boolean).join(" ") });
  }
  out.summary = { wakeEn: out.wake.filter((w) => w.lang === "en" && w.fired).length + "/" + out.wake.filter((w) => w.lang === "en").length,
    wakeDe: out.wake.filter((w) => w.lang === "de" && w.fired).length + "/" + out.wake.filter((w) => w.lang === "de").length, falseAlarms: out.falseAlarms.length,
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
    out.time = await cw.command("wie spät ist es", "de");
    out.unknown = await cw.command("erzähl mir einen witz", "de");
    out.timeEn = await cw.command("what time is it", "en");
    out.models = Object.keys(speech.models);
    const voices = await speech.voicesReady();
    out.voices = voices.map((v) => `${v.name} (${v.lang})`);
    out.ok = ready && out.recognizer && !out.recognizer.timeout && out.time.ok && /Uhr/.test(out.time.say) && out.unknown.say === "Diesen Befehl kenne ich leider nicht." &&
      out.timeEn.ok && /^It's /.test(out.timeEn.say) && out.models.length === 2 && !!out.overlay?.ok && out.confirm.confirm === true && out.confirmNo.cancelled === true &&
      (out.wakeFree.wake.length === 0 || out.wakeFree.wake.some((w) => w.fired));
  } catch (e) {
    out.error = e.message;
  }
  cw.smoke(out);
}
