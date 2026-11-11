// CommandWave – Sprache im Fenster, komplett offline:
//   Erkennung: Vosk (WebAssembly) mit dem deutschen Modell aus der App; nur die Sätze aus den Mods sind erlaubt (Grammatik).
//   Ausgabe:   die auf Windows installierten Stimmen (z. B. „Microsoft Hedda“, „Katja“) über speechSynthesis.
// Das Mikrofon ist nur offen, solange zugehört wird.
(function () {
  "use strict";
  const SAMPLE_RATE = 16000;

  class Speech {
    constructor() {
      this.model = null;
      this.rec = null;
      this.grammar = null;
      this.session = null;
      this.level = 0;
    }

    /** Sprachmodell laden (einmal beim Start, dauert ein paar Sekunden) */
    async load(url) {
      this.model = await Vosk.createModel(url);
      return this;
    }

    /** Erlaubte Sätze setzen (aus den Mods) – neuer Erkenner */
    setGrammar(list) {
      const g = JSON.stringify(list || []);
      if (g === this.grammar && this.rec) return;
      this.grammar = g;
      try {
        this.rec?.remove();
      } catch {
        // schon weg
      }
      this.rec = new this.model.KaldiRecognizer(SAMPLE_RATE, g);
      // Ereignisse nur einmal je Erkenner anmelden und an die laufende Aufnahme weitergeben
      this.rec.on("result", (m) => this.session?.onResult(m));
      this.rec.on("partialresult", (m) => this.session?.onPart(m));
    }

    get listening() {
      return !!this.session;
    }

    /**
     * Zuhören, bis ein Satz erkannt ist, Stille folgt oder maxSeconds um sind.
     * → Promise<string> (leer = nichts verstanden). onPartial(text) zeigt Zwischenstände.
     */
    async listen({ deviceId = "", maxSeconds = 7, onPartial = () => {}, onStart = () => {} } = {}) {
      if (!this.rec) throw new Error("Spracherkennung noch nicht bereit");
      if (this.session) return this.stop();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: deviceId ? { exact: deviceId } : undefined, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      src.connect(analyser);
      src.connect(proc);
      proc.connect(ctx.destination);
      const buf = new Float32Array(analyser.fftSize);

      return new Promise((resolve) => {
        let lastPartial = "";
        let lastChange = Date.now();
        let heardSomething = false;
        const started = Date.now();
        const finish = (text) => {
          if (!this.session) return;
          const s = this.session;
          this.session = null;
          clearInterval(s.timer);
          proc.disconnect();
          src.disconnect();
          stream.getTracks().forEach((t) => t.stop());
          ctx.close().catch(() => {});
          this.level = 0;
          resolve(clean(text));
        };
        const onResult = (m) => {
          const t = clean(m.result?.text);
          if (t) finish(t);
          else if (this.session?.final) finish("");
        };
        const onPart = (m) => {
          const t = clean(m.result?.partial);
          if (t && t !== lastPartial) {
            lastPartial = t;
            lastChange = Date.now();
            heardSomething = true;
            onPartial(t);
          }
        };
        proc.onaudioprocess = (e) => {
          if (!this.session) return;
          try {
            this.rec.acceptWaveform(e.inputBuffer);
          } catch {
            // Erkenner wurde gerade ersetzt
          }
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += v * v;
          this.level = Math.min(1, Math.sqrt(sum / buf.length) * 6);
        };
        this.session = {
          final: false,
          onResult,
          onPart,
          stop: () => {
            this.session.final = true;
            this.rec.retrieveFinalResult();
            setTimeout(() => finish(lastPartial), 800); // falls kein Ergebnis mehr kommt
          },
          timer: setInterval(() => {
            const now = Date.now();
            // nach dem Sprechen ~1,2 s Ruhe → fertig; sonst nach maxSeconds
            if ((heardSomething && now - lastChange > 1200) || now - started > maxSeconds * 1000) this.session?.stop();
          }, 150),
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

    /** Sprechen mit lokaler Stimme → Promise, wenn fertig */
    speak(text, { voice = "", rate = 1, volume = 1 } = {}) {
      return new Promise((resolve) => {
        if (!text) return resolve();
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        const all = this.voices();
        u.voice = all.find((v) => v.name === voice) || all.find((v) => v.lang.toLowerCase().startsWith("de")) || null;
        u.lang = u.voice?.lang || "de-DE";
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
