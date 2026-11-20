// Kleiner Client für obs-websocket 5 (in OBS Studio ab 28 eingebaut) – ohne Zusatzpakete:
// WebSocket (RFC 6455) direkt über node:http, Anmeldung mit Passwort (SHA-256), eine Anfrage je Verbindung.
//   Hello (op 0) → Identify (op 1) → Identified (op 2) → Request (op 6) → RequestResponse (op 7)
const crypto = require("node:crypto");
const http = require("node:http");

const sha256b64 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("base64");
/** Anmeldung: base64(sha256(base64(sha256(passwort + salt)) + challenge)) */
const authFor = (password, salt, challenge) => sha256b64(sha256b64(String(password) + salt) + challenge);

/** Fehler mit Kennung für freundliche Meldungen: code = unreachable | auth | timeout | failed */
function obsError(code, message) {
  return Object.assign(new Error(message), { code });
}

/** Minimaler WebSocket-Client: → Promise<{ send(text), close(), onMessage, onClose }> */
function connectWs(url, { timeout = 4000 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      return reject(obsError("unreachable", "ungültige Adresse"));
    }
    if (u.protocol !== "ws:") return reject(obsError("unreachable", "nur ws:// wird unterstützt"));
    const key = crypto.randomBytes(16).toString("base64");
    const req = http.request({ host: u.hostname, port: u.port || 80, path: u.pathname + u.search, timeout,
      headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Key": key, "Sec-WebSocket-Version": "13", "Sec-WebSocket-Protocol": "obswebsocket.json" } });
    req.on("timeout", () => req.destroy(obsError("timeout", "Zeitüberschreitung")));
    req.on("error", (e) => reject(e.code === "timeout" ? e : obsError("unreachable", e.message)));
    req.on("response", (res) => reject(obsError("unreachable", "kein WebSocket (HTTP " + res.statusCode + ")")));
    req.on("upgrade", (res, socket, head) => {
      const accept = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
      if (res.headers["sec-websocket-accept"] !== accept) return socket.destroy(), reject(obsError("unreachable", "falsche WebSocket-Antwort"));
      socket.setTimeout(0);
      let buf = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
      let closed = false;
      const ws = {
        onMessage: () => {},
        onClose: () => {},
        send(text) {
          const data = Buffer.from(text, "utf8");
          const mask = crypto.randomBytes(4);
          const len = data.length;
          const hdr = len < 126 ? Buffer.from([0x81, 0x80 | len]) : len < 65536 ? Buffer.from([0x81, 0x80 | 126, len >> 8, len & 255]) : Buffer.concat([Buffer.from([0x81, 0x80 | 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(len)); return b; })()]);
          const body = Buffer.alloc(len);
          for (let i = 0; i < len; i++) body[i] = data[i] ^ mask[i % 4];
          socket.write(Buffer.concat([hdr, mask, body]));
        },
        close() {
          if (closed) return;
          closed = true;
          try {
            socket.end(Buffer.from([0x88, 0x80, 0, 0, 0, 0]));
          } catch {
            // schon zu
          }
        },
      };
      const finish = (code, reason) => {
        if (ws.done) return;
        ws.done = true;
        ws.onClose(code, reason);
      };
      const pump = (d) => {
        if (d) buf = Buffer.concat([buf, d]);
        // vollständige Rahmen lesen (Server schickt unmaskiert)
        for (;;) {
          if (buf.length < 2) return;
          const op = buf[0] & 15;
          let len = buf[1] & 127;
          let p = 2;
          if (len === 126) {
            if (buf.length < 4) return;
            len = buf.readUInt16BE(2);
            p = 4;
          } else if (len === 127) {
            if (buf.length < 10) return;
            len = Number(buf.readBigUInt64BE(2));
            p = 10;
          }
          if (buf[1] & 128) p += 4; // maskiert (sollte vom Server nicht kommen)
          if (buf.length < p + len) return;
          const payload = buf.subarray(p, p + len);
          buf = buf.subarray(p + len);
          if (op === 1) ws.onMessage(payload.toString("utf8"));
          else if (op === 8) {
            const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
            finish(code, payload.subarray(2).toString("utf8"));
            ws.close();
            socket.end();
          } else if (op === 9) socket.write(Buffer.concat([Buffer.from([0x8a, 0x80 | payload.length, 0, 0, 0, 0]), payload])); // Ping → Pong
        }
      };
      socket.on("data", pump);
      socket.on("close", () => finish(1006, ""));
      socket.on("error", () => finish(1006, ""));
      resolve(ws);
      setImmediate(pump); // Hello kann schon mit der Handshake-Antwort gekommen sein
    });
    req.end();
  });
}

/**
 * Eine Anfrage an OBS: → responseData (Objekt) oder Fehler mit code (unreachable | auth | timeout | failed)
 * opts = { url, password, connect (für Tests), timeout }
 */
async function request(requestType, requestData = {}, { url = "ws://127.0.0.1:4455", password = "", connect = connectWs, timeout = 5000 } = {}) {
  const ws = await connect(url, { timeout });
  return new Promise((resolve, reject) => {
    const id = crypto.randomBytes(6).toString("hex");
    let done = false;
    const end = (err, val) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      ws.close();
      err ? reject(err) : resolve(val);
    };
    const timer = setTimeout(() => end(obsError("timeout", "OBS antwortet nicht")), timeout);
    ws.onClose = (code, reason) => end(code === 4009 ? obsError("auth", "Passwort falsch") : obsError("unreachable", `Verbindung geschlossen (${code}${reason ? " " + reason : ""})`));
    ws.onMessage = (text) => {
      let m;
      try {
        m = JSON.parse(text);
      } catch {
        return;
      }
      if (m.op === 0) {
        const a = m.d && m.d.authentication;
        if (a && !password) return end(obsError("auth", "Passwort fehlt"));
        ws.send(JSON.stringify({ op: 1, d: { rpcVersion: 1, eventSubscriptions: 0, ...(a ? { authentication: authFor(password, a.salt, a.challenge) } : {}) } }));
      } else if (m.op === 2) ws.send(JSON.stringify({ op: 6, d: { requestType, requestId: id, requestData } }));
      else if (m.op === 7 && m.d && m.d.requestId === id) {
        const st = m.d.requestStatus || {};
        if (st.result) end(null, m.d.responseData || {});
        else end(Object.assign(obsError("failed", st.comment || "Anfrage abgelehnt"), { status: st.code }));
      }
    };
  });
}

/** Für den Vergleich: klein, Umlaute ausgeschrieben, Zahlwörter → Ziffern, ohne Satzzeichen und Leerzeichen */
const NUM = { null: 0, eins: 1, ein: 1, eine: 1, zwei: 2, zwo: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
function simplify(s) {
  return String(s || "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((w) => (w in NUM ? String(NUM[w]) : w))
    .join("")
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
}

function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** Gesprochener Szenenname → bester Name aus der Liste oder null (unsicher) */
function matchScene(spoken, scenes) {
  const s = simplify(spoken);
  if (!s) return null;
  let best = null;
  for (const name of scenes || []) {
    const n = simplify(name);
    if (!n) continue;
    let score = 1 - lev(s, n) / Math.max(s.length, n.length);
    if (n === s) score = 1;
    else if (n.startsWith(s) || s.startsWith(n)) score = Math.max(score, 0.8);
    else if (n.includes(s) || s.includes(n)) score = Math.max(score, 0.7);
    if (!best || score > best.score) best = { name, score };
  }
  return best && best.score >= 0.6 ? best.name : null;
}

module.exports = { authFor, request, connectWs, matchScene, simplify, obsError };
