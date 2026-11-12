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
      if (this.session || this.wakeActive) return; // Aktivierungswort braucht das Modell
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

    /** Erkenner ohne Befehlsliste (freie Sprache, z. B. Suchbegriffe oder Aussprache lernen) – danach .remove() */
    freeRecognizer(l) {
      if (!this.models[l]) throw new Error("Sprachmodell " + l + " nicht geladen");
      const rec = new this.models[l].KaldiRecognizer(SAMPLE_RATE);
      rec.setWords(true);
      rec.on("result", (m) => this.session?.onResult(l, m));
      rec.on("partialresult", (m) => this.session?.onPart(l, m));
      return rec;
    }

    /** Frei zuhören (nur eine Sprache) → Promise<{ lang, text, conf }> */
    async listenFree(l, opts = {}) {
      const rec = this.freeRecognizer(l);
      try {
        const [r] = await this.listen({ ...opts, recs: { [l]: rec } });
        return r || { lang: l, text: "", conf: null };
      } finally {
        try {
          rec.remove();
        } catch {
          // schon weg
        }
      }
    }

    /**
     * Aktivierungswort: Mikrofon bleibt offen, ein winziger Erkenner kennt nur das Wort (alles andere ist „[unk]“).
     * Erst wenn nach dem Wort eine kurze Pause kommt und es sicher erkannt wurde, wird onWake() aufgerufen.
     */
    async startWake({ lang = "de", phrase = "hey wave", deviceId = "", onWake = () => {}, minConf = 0.6 } = {}) {
      this.stopWake();
      if (!this.models[lang]) throw new Error("Sprachmodell " + lang + " nicht geladen");
      const w = { stopped: false };
      this.wake = w;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: deviceId ? { exact: deviceId } : undefined, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (w.stopped) return stream.getTracks().forEach((t) => t.stop());
      const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      await ctx.audioWorklet.addModule("audio-worklet.js");
      const src = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, "cw-capture");
      src.connect(node);
      const rec = new this.models[lang].KaldiRecognizer(SAMPLE_RATE, JSON.stringify(Speech.wakeGrammar(phrase)));
      rec.setWords(true);
      rec.on("result", (m) => {
        if (!w.stopped && Speech.isWake(m, phrase, minConf)) onWake();
      });
      node.port.onmessage = (e) => {
        if (w.stopped || this.session) return; // während normalem Zuhören nicht doppelt rechnen
        try {
          rec.acceptWaveformFloat(e.data.data, SAMPLE_RATE);
        } catch {
          // Erkenner beendet
        }
      };
      Object.assign(w, { stream, ctx, src, node, rec });
    }

    get wakeActive() {
      return !!this.wake && !this.wake.stopped;
    }

    stopWake() {
      const w = this.wake;
      if (!w) return;
      this.wake = null;
      w.stopped = true;
      try {
        if (w.node) w.node.port.onmessage = null;
        w.src?.disconnect();
        w.node?.disconnect();
        w.stream?.getTracks().forEach((t) => t.stop());
        w.ctx?.close().catch(() => {});
        w.rec?.remove();
      } catch {
        // schon beendet
      }
    }

    /** Grammatik fürs Aktivierungswort */
    static wakeGrammar(phrase) {
      return [phrase, "[unk]"];
    }

    /** Ergebnis des Wort-Erkenners → war es das Aktivierungswort (sicher genug)? */
    static isWake(m, phrase, minConf = 0.6) {
      const words = (m.result?.result || []).filter((x) => x.word !== "[unk]");
      const text = clean(m.result?.text);
      if (!text.endsWith(phrase)) return false;
      const conf = words.length ? words.reduce((a, x) => a + (x.conf ?? 1), 0) / words.length : 0;
      return conf >= minConf;
    }

    /**
     * Zuhören (alle geladenen Sprachen gleichzeitig mit demselben Ton), bis Stille folgt oder maxSeconds um sind.
     * → Promise<[{ lang, text, conf }]> (text leer = nichts verstanden; conf = Sicherheit 0..1)
     */
    async listen({ deviceId = "", maxSeconds = 7, onPartial = () => {}, onStart = () => {}, recs = null } = {}) {
      const use = recs || this.recs; // eigene Erkenner (z. B. frei) statt der Befehls-Erkenner
      const langs = Object.keys(use);
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
              use[l]?.acceptWaveformFloat(e.data.data, SAMPLE_RATE);
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
            for (const l of langs) if (!results[l]) use[l]?.retrieveFinalResult();
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
