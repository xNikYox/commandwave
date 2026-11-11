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
}
const idle = () => setStatus(state?.settings.hotkey ? `Bereit – ${keyLabel()} drücken und sprechen` : "Bereit – Mikrofon anklicken und sprechen", "");

/* ---------------- Zuhören → verstehen → antworten ---------------- */
const MIN_CONF = 0.45; // darunter lieber nachfragen als einen falschen Befehl ausführen

async function listen() {
  if (!ready) return;
  if (speech.listening) return speech.stop();
  speechSynthesis.cancel();
  const s = state.settings;
  $("#heard").hidden = true;
  $("#answer").hidden = true;
  try {
    if (!speech.loaded) {
      setStatus("Lade Spracherkennung …", "thinking");
      await speech.load(speech.url);
      speech.setGrammar(state.grammar);
    }
    if (s.beep) speech.beep(true);
    setTimeout(() => wave.kick(), 50);
    const r = await speech.listen({
      deviceId: s.micId,
      maxSeconds: s.maxSeconds,
      onStart: () => setStatus("Ich höre zu …", "listening"),
      onPartial: (t) => bubble("#heard", t),
    });
    if (s.beep) speech.beep(false);
    if (r.text && r.conf != null && r.conf < MIN_CONF) {
      bubble("#heard", r.text + " ?");
      const say = "Das habe ich nicht sicher verstanden. Sag es bitte noch einmal.";
      bubble("#answer", say, "miss");
      setStatus(say, "speaking");
      await speakAnswer(say);
      idle();
    } else await handle(r.text);
  } catch (e) {
    setStatus(e.name === "NotAllowedError" ? "Kein Zugriff aufs Mikrofon – in Windows unter Datenschutz → Mikrofon erlauben" : e.name === "NotFoundError" ? "Kein Mikrofon gefunden" : "Fehler: " + e.message, "error");
  }
  scheduleUnload();
}

/** Sparmodus: Sprachmodell nach einigen Minuten ohne Benutzung aus dem Speicher nehmen */
let unloadTimer = null;
function scheduleUnload() {
  clearTimeout(unloadTimer);
  const min = Number(state.settings.unloadMinutes) || 0;
  if (min > 0) unloadTimer = setTimeout(() => speech.unload(), min * 60 * 1000);
}

async function handle(text) {
  bubble("#heard", text || "(nichts verstanden)");
  setStatus("Verstehe …", "thinking");
  const r = await cw.command(text);
  if (r.say) {
    bubble("#answer", r.say, r.ok ? "" : "miss");
    setStatus(r.say, "speaking");
    await say(r.say);
  } else if (r.ok) bubble("#answer", "✓ Erledigt");
  idle();
}

const speakAnswer = (t) => say(t);
function say(text) {
  const s = state.settings;
  return speech.speak(text, { voice: s.voice, rate: Number(s.rate) || 1, volume: Number(s.volume) });
}

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
  await say(text);
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
  if (ready) speech.setGrammar(state.grammar);
  renderCommands();
  renderMods();
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
  $("#voice").innerHTML = `<option value="">Automatisch (erste deutsche Stimme)</option>` + voices.map((v) => `<option value="${esc(v.name)}"${v.name === s.voice ? " selected" : ""}>${esc(v.name)} (${esc(v.lang)})</option>`).join("");
  $("#voiceHint").textContent = de.length ? `${de.length} deutsche Stimme${de.length > 1 ? "n" : ""} gefunden` : "Keine deutsche Stimme – Windows: Einstellungen → Zeit und Sprache → Sprache → Deutsch → Sprachausgabe installieren";
  renderSources();
}

for (const el of $$("[data-set]")) el.addEventListener("change", async () => {
  const k = el.dataset.set;
  const v = el.type === "checkbox" ? el.checked : el.dataset.num != null ? Number(el.value) : el.value;
  state.settings = (await cw.saveSettings({ [k]: v })).settings;
});
$("#voice").onchange = async (e) => (state.settings = (await cw.saveSettings({ voice: e.target.value })).settings);
$("#mic-select").onchange = async (e) => (state.settings = (await cw.saveSettings({ micId: e.target.value })).settings);
$("#testVoice").onclick = () => say("Hallo, ich bin CommandWave. Editor wird gestartet.");

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
    downloading: `Lade Version ${u.version || ""} … ${u.percent || 0} %`, ready: `Version ${u.version} ist bereit – wird beim Beenden installiert.`, error: "Update-Prüfung fehlgeschlagen: " + (u.error || ""),
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
    await speech.load(new URL("model/vosk-model-de.tar.gz", location.href).href); // im Worker braucht Vosk eine volle Adresse
    if (state.smoke) console.log("Testmodus: Modell geladen");
    speech.setGrammar(state.grammar);
    ready = true;
    idle();
    showHint();
  } catch (e) {
    setStatus("Spracherkennung konnte nicht geladen werden: " + e.message, "error");
  }
  if (state.smoke) smokeTest();
})();

/** Testmodus: Windows-Stimme spricht Testsätze → Erkennung mit Satz-Grammatik (bisher) und Wortschatz (neu) */
async function audioTest() {
  const results = [];
  for (const a of state.audio || []) {
    const buf = await (await fetch(a.url)).arrayBuffer();
    const decoded = await new AudioContext({ sampleRate: 16000 }).decodeAudioData(buf);
    const pcm = decoded.getChannelData(0);
    const run = async (grammar) => {
      const rec = new speech.model.KaldiRecognizer(16000, JSON.stringify(grammar));
      const t0 = performance.now();
      const text = await new Promise((resolve) => {
        rec.on("result", (m) => resolve(m.result.text));
        for (let i = 0; i < pcm.length; i += 1600) rec.acceptWaveformFloat(pcm.slice(i, i + 1600), 16000);
        rec.acceptWaveformFloat(new Float32Array(8000), 16000);
        rec.retrieveFinalResult();
        setTimeout(() => resolve(null), 15000);
      });
      const ms = Math.round(performance.now() - t0);
      rec.remove();
      return { text, ms, command: text ? (await cw.match(text))?.command || null : null };
    };
    const r = { said: a.text };
    for (const [name, g] of Object.entries(state.grammars)) r[name] = await run(g);
    results.push(r);
  }
  // Auswertung: wie oft wurde der richtige Befehl erkannt, wie schnell
  const want = await Promise.all(results.map(async (r) => (await cw.match(r.said))?.command || null));
  const summary = {};
  for (const name of Object.keys(state.grammars || {})) {
    summary[name] = {
      eintraege: state.grammars[name].reduce((n, x) => n + x.split(" ").length, 0),
      richtig: results.filter((r, i) => r[name].command && r[name].command === want[i]).length + "/" + results.length,
      woertlich: results.filter((r) => r[name].text === r.said).length,
      msGesamt: results.reduce((n, r) => n + r[name].ms, 0),
    };
  }
  return { summary, results };
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
        speech.session = { onResult: (m) => resolve({ text: m.result?.text ?? null }), onPart() {} };
        speech.rec.acceptWaveform(buf);
        speech.rec.retrieveFinalResult();
        setTimeout(() => resolve({ text: null, timeout: true }), 15000);
      });
      speech.session = null;
    }
    out.audioTest = await audioTest();
    out.time = await cw.command("wie spät ist es");
    out.unknown = await cw.command("erzähl mir einen witz");
    const voices = await speech.voicesReady();
    out.voices = voices.map((v) => `${v.name} (${v.lang})`);
    out.ok = ready && out.recognizer && !out.recognizer.timeout && out.time.ok && /Uhr/.test(out.time.say) && out.unknown.say === "Diesen Befehl kenne ich leider nicht.";
  } catch (e) {
    out.error = e.message;
  }
  cw.smoke(out);
}
