// CommandWave – Overlay: Status, Gehörtes und eine kleine Welle; animiert nur, solange etwas passiert.
const $ = (s) => document.querySelector(s);
const c = $("#wave");
const g = c.getContext("2d");
let mode = "";
let level = 0;
let phase = 0;
let running = false;

function frame() {
  const active = mode === "listening" || mode === "speaking" || mode === "thinking";
  g.clearRect(0, 0, c.width, c.height);
  const lvl = mode === "listening" ? 0.15 + level : mode === "speaking" ? 0.35 : 0.08;
  phase += mode === "listening" ? 0.22 : 0.08;
  for (const [k, a] of [[1, 1], [1.7, 0.5]]) {
    g.beginPath();
    for (let x = 0; x <= c.width; x += 3) {
      const env = Math.sin((x / c.width) * Math.PI);
      const y = c.height / 2 + Math.sin(x / (9 / k) + phase * k) * env * lvl * (c.height / 2.2) * a;
      x ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    const grad = g.createLinearGradient(0, 0, c.width, 0);
    grad.addColorStop(0, `rgba(124,108,255,${0.9 * a})`);
    grad.addColorStop(1, `rgba(34,211,238,${0.9 * a})`);
    g.strokeStyle = grad;
    g.lineWidth = 2;
    g.stroke();
  }
  if (active) requestAnimationFrame(frame);
  else running = false;
}

ov.onUpdate((d) => {
  if (d.mode != null) {
    mode = d.mode;
    document.body.dataset.mode = mode;
  }
  if (d.text != null) $("#status").textContent = d.text;
  if (d.heard != null) $("#heard").textContent = d.heard;
  if (d.level != null) level = d.level;
  if (!running) {
    running = true;
    requestAnimationFrame(frame);
  }
  if (d.echo) ov.shown($("#status").textContent);
});
