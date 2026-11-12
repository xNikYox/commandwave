// CommandWave – Sprache im Fenster, komplett offline:
//   Erkennung: Vosk (WebAssembly) mit dem deutschen Modell aus der App; nur die Sätze aus den Mods sind erlaubt (Grammatik).
//   Ausgabe:   die auf Windows installierten Stimmen (z. B. „Microsoft Hedda“, „Katja“) über speechSynthesis.
// Das Mikrofon ist nur offen, solange zugehört wird.
(function () {
  "use strict";
  const SAMPLE_RATE = 16000;

  class Speech {
    constructor() {
      this.models = {}; // Sprache → Vosk-Modell
      this.recs = {}; // Sprache → Erkenner
      this.grammars = {};
      this.urls = {};
      this.session = null;
      this.level = 0;
    }

    /** Sprachmodelle laden, z. B. { de: url, en: url } (parallel, dauert ein paar Sekunden) */
    async load(urls) {
      this.urls = { ...urls };
      for (const l of Object.keys(this.models)) if (!(l in urls)) this.drop(l);
      await Promise.all(Object.entries(urls).map(async ([l, url]) => {
        if (!this.models[l]) this.models[l] = await Vosk.createModel(url);
      }));
      return this;
    }

    get loaded() {
      return Object.keys(this.urls).length > 0 && Object.keys(this.urls).every((l) => this.models[l]);
    }

    get langs() {
      return Object.keys(this.recs);
    }

    drop(l) {
      try {
        this.recs[l]?.remove();
        this.models[l]?.terminate();
      } catch {
        // schon beendet
      }
      delete this.recs[l];
      delete this.models[l];
      delete this.grammars[l];
    }

    /** Sparmodus: alle Sprachmodelle aus dem Speicher werfen – beim nächsten Zuhören werden sie neu geladen */
    unload() {
      if (this.session) return;
      for (const l of Object.keys(this.models)) this.drop(l);
    }

    /** Erlaubte Sätze je Sprache setzen ({ de: [...], en: [...] }) – neuer Erkenner nur bei Änderung */
    setGrammar(grammars) {
      for (const [l, list] of Object.entries(grammars || {})) {
        if (!this.models[l]) continue;
        const g = JSON.stringify(list || []);
        if (g === this.grammars[l] && this.recs[l]) continue;
        this.grammars[l] = g;
        try {
          this.recs[l]?.remove();
        } catch {
          // schon weg
        }
        const rec = new this.models[l].KaldiRecognizer(SAMPLE_RATE, g);
        rec.setWords(true); // je Wort eine Sicherheit (conf) – für die Sicherheitsschwelle
        // Ereignisse nur einmal je Erkenner anmelden und an die laufende Aufnahme weitergeben
        rec.on("result", (m) => this.session?.onResult(l, m));
        rec.on("partialresult", (m) => this.session?.onPart(l, m));
        this.recs[l] = rec;
      }
    }

    get listening() {
      return !!this.session;
    }

    /**
     * Zuhören (alle geladenen Sprachen gleichzeitig mit demselben Ton), bis Stille folgt oder maxSeconds um sind.
     * → Promise<[{ lang, text, conf }]> (text leer = nichts verstanden; conf = Sicherheit 0..1)
     */
    async listen({ deviceId = "", maxSeconds = 7, onPartial = () => {}, onStart = () => {} } = {}) {
      const langs = this.langs;
      if (!langs.length) throw new Error("Spracherkennung noch nicht bereit");
      if (this.session) return this.stop();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: deviceId ? { exact: deviceId } : undefined, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: "interactive" });
      await ctx.audioWorklet.addModule("audio-worklet.js");
      const src = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, "cw-capture");
      src.connect(node); // Ausgang bleibt offen: nichts wird abgespielt

      return new Promise((resolve) => {
        const partial = {};
        const results = {};
        let lastChange = Date.now();
        let heardSomething = false;
        const started = Date.now();
        const finish = () => {
          if (!this.session) return;
          const s = this.session;
          this.session = null;
          clearInterval(s.timer);
          clearTimeout(s.fallback);
          node.port.onmessage = null;
          try {
            src.disconnect();
            node.disconnect();
          } catch {
            // schon getrennt
          }
          stream.getTracks().forEach((t) => t.stop());
          ctx.close().catch(() => {});
          this.level = 0;
          resolve(langs.map((l) => results[l] || { lang: l, text: clean(partial[l]), conf: null }));
        };
        const onResult = (l, m) => {
          const words = (m.result?.result || []).filter((w) => w.word !== "[unk]");
          const conf = words.length ? words.reduce((a, w) => a + (w.conf ?? 1), 0) / words.length : null;
          const text = clean(m.result?.text);
          // erstes vollständiges Ergebnis je Sprache zählt; fertig, wenn alle Sprachen geantwortet haben
          if (!results[l] && (text || this.session?.final)) results[l] = { lang: l, text, conf };
          if (this.session?.final && langs.every((x) => results[x])) finish();
          else if (text && !this.session?.final) this.session?.stop(); // einer hat einen Satz → alle abschließen
        };
        const onPart = (l, m) => {
          const t = clean(m.result?.partial);
          if (t && t !== partial[l]) {
            partial[l] = t;
            lastChange = Date.now();
            heardSomething = true;
            onPartial(t, l);
          }
        };
        node.port.onmessage = (e) => {
          if (!this.session) return;
          this.level = Math.min(1, e.data.level * 6);
          for (const l of langs) {
            try {
              this.recs[l]?.acceptWaveformFloat(e.data.data, SAMPLE_RATE);
            } catch {
              // Erkenner wurde gerade ersetzt
            }
          }
        };
        this.session = {
          final: false,
          onResult,
          onPart,
          stop: () => {
            if (!this.session || this.session.final) return;
            this.session.final = true;
            for (const l of langs) if (!results[l]) this.recs[l]?.retrieveFinalResult();
            if (langs.every((x) => results[x])) return finish();
            this.session.fallback = setTimeout(finish, 900); // falls kein Ergebnis mehr kommt
          },
          timer: setInterval(() => {
            const now = Date.now();
            // nach dem Sprechen ~1 s Ruhe → fertig; sonst nach maxSeconds
            if ((heardSomething && now - lastChange > 1000) || now - started > maxSeconds * 1000) this.session?.stop();
          }, 120),
        };
        onStart();
      });
    }

    /** Zuhören abbrechen (gibt den bisherigen Stand zurück) */
    stop() {
      this.session?.stop();
    }

    /** Verfügbare Stimmen; deutsche zuerst */
    voices() {
      const list = speechSynthesis.getVoices();
      return [...list].sort((a, b) => (b.lang.startsWith("de") - a.lang.startsWith("de")) || a.name.localeCompare(b.name));
    }

    voicesReady() {
      return new Promise((resolve) => {
        if (speechSynthesis.getVoices().length) return resolve(this.voices());
        speechSynthesis.onvoiceschanged = () => resolve(this.voices());
        setTimeout(() => resolve(this.voices()), 1500);
      });
    }

    /** Sprechen mit lokaler Stimme in der passenden Sprache → Promise, wenn fertig */
    speak(text, { voice = "", rate = 1, volume = 1, lang = "de" } = {}) {
      return new Promise((resolve) => {
        if (!text) return resolve();
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        const all = this.voices();
        const wantLang = lang === "en" ? "en" : "de";
        const chosen = all.find((v) => v.name === voice && v.lang.toLowerCase().startsWith(wantLang));
        u.voice = chosen || all.find((v) => v.lang.toLowerCase().startsWith(wantLang)) || null;
        u.lang = u.voice?.lang || (wantLang === "en" ? "en-US" : "de-DE");
        u.rate = rate;
        u.volume = volume;
        u.onend = u.onerror = () => resolve();
        speechSynthesis.speak(u);
      });
    }

    /** Kurzer Ton als Zeichen „ich höre“ */
    beep(up = true) {
      try {
        const ctx = new AudioContext();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.setValueAtTime(up ? 660 : 520, ctx.currentTime);
        o.frequency.linearRampToValueAtTime(up ? 990 : 380, ctx.currentTime + 0.12);
        g.gain.setValueAtTime(0.0001, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16);
        o.connect(g).connect(ctx.destination);
        o.start();
        o.stop(ctx.currentTime + 0.18);
        setTimeout(() => ctx.close(), 300);
      } catch {
        // kein Ton möglich
      }
    }
  }

  const clean = (t) => String(t || "").replace(/\[unk\]/g, "").replace(/\s+/g, " ").trim();
  window.Speech = Speech;
})();
