// Kleiner Ersatz für obs-websocket 5 (für Tests): Handshake, Anmeldung mit Passwort, ein paar Anfragen.
// startFakeObs({ password, scenes }) → { url, port, requests: [{ requestType, requestData }], close() }
const http = require("node:http");
const crypto = require("node:crypto");

const sha = (s) => crypto.createHash("sha256").update(s).digest("base64");

function frame(op, payload) {
  const len = payload.length;
  const hdr = len < 126 ? Buffer.from([0x80 | op, len]) : Buffer.from([0x80 | op, 126, len >> 8, len & 255]);
  return Buffer.concat([hdr, payload]);
}

function startFakeObs({ password = "", scenes = ["Szene"], recording = false } = {}) {
  const requests = [];
  const state = { recording, streaming: false, scene: scenes[0] };
  const server = http.createServer((_req, res) => res.writeHead(426).end());
  server.on("upgrade", (req, socket) => {
    const accept = crypto.createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nSec-WebSocket-Protocol: obswebsocket.json\r\n\r\n`);
    const salt = crypto.randomBytes(8).toString("base64");
    const challenge = crypto.randomBytes(8).toString("base64");
    const send = (o) => socket.write(frame(1, Buffer.from(JSON.stringify(o))));
    const close = (code, reason) => {
      const b = Buffer.alloc(2);
      b.writeUInt16BE(code);
      socket.end(frame(8, Buffer.concat([b, Buffer.from(reason)])));
    };
    send({ op: 0, d: { obsWebSocketVersion: "5.5.0", rpcVersion: 1, ...(password ? { authentication: { salt, challenge } } : {}) } });
    let buf = Buffer.alloc(0);
    socket.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 6) {
        const op = buf[0] & 15;
        let len = buf[1] & 127;
        let p = 2;
        if (len === 126) (len = buf.readUInt16BE(2)), (p = 4);
        if (!(buf[1] & 128)) return socket.destroy(); // Client muss maskieren
        if (buf.length < p + 4 + len) return;
        const mask = buf.subarray(p, p + 4);
        const data = Buffer.from(buf.subarray(p + 4, p + 4 + len).map((x, i) => x ^ mask[i % 4]));
        buf = buf.subarray(p + 4 + len);
        if (op === 8) return socket.end();
        if (op !== 1) continue;
        const m = JSON.parse(data.toString("utf8"));
        if (m.op === 1) {
          if (password && m.d.authentication !== sha(sha(password + salt) + challenge)) return close(4009, "Authentication failed.");
          send({ op: 2, d: { negotiatedRpcVersion: 1 } });
        } else if (m.op === 6) {
          const { requestType, requestId, requestData } = m.d;
          requests.push({ requestType, requestData });
          let result = true;
          let responseData;
          if (requestType === "StartRecord") (result = !state.recording), (state.recording = true);
          else if (requestType === "StopRecord") (result = state.recording), (state.recording = false);
          else if (requestType === "StartStream") (result = !state.streaming), (state.streaming = true);
          else if (requestType === "StopStream") (result = state.streaming), (state.streaming = false);
          else if (requestType === "GetSceneList") responseData = { currentProgramSceneName: state.scene, scenes: [...scenes].reverse().map((sceneName, i) => ({ sceneName, sceneIndex: i })) };
          else if (requestType === "SetCurrentProgramScene") (result = scenes.includes(requestData.sceneName)), result && (state.scene = requestData.sceneName);
          send({ op: 7, d: { requestType, requestId, requestStatus: { result, code: result ? 100 : 500, ...(result ? {} : { comment: "geht nicht" }) }, ...(responseData ? { responseData } : {}) } });
        }
      }
    });
    socket.on("error", () => {});
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    resolve({ url: `ws://127.0.0.1:${port}`, port, requests, state, close: () => new Promise((r) => (server.closeAllConnections?.(), server.close(r))) });
  }));
}

module.exports = { startFakeObs };
