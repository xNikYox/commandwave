// Läuft im Audio-Thread: sammelt Mikrofon-Daten zu 100-ms-Stücken, misst die Lautstärke und gibt sie an das Fenster.
// So bleibt die Oberfläche frei (der alte ScriptProcessor lief im Haupt-Thread).
class CwCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(1600); // 100 ms bei 16 kHz
    this.n = 0;
    this.skip = Math.round(sampleRate * 0.18); // Signalton am Anfang nicht mit aufnehmen
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    let i = 0;
    if (this.skip > 0) {
      i = Math.min(this.skip, ch.length);
      this.skip -= i;
    }
    for (; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === this.buf.length) {
        let sum = 0;
        for (let k = 0; k < this.buf.length; k++) sum += this.buf[k] * this.buf[k];
        const out = this.buf;
        this.port.postMessage({ data: out, level: Math.sqrt(sum / out.length) }, [out.buffer]);
        this.buf = new Float32Array(1600);
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor("cw-capture", CwCapture);
