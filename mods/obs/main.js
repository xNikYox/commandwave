// OBS Studio über obs-websocket 5 (in OBS ab Version 28 eingebaut): Aufnahme, Stream, Szenen.
// In OBS einmal einschalten: Werkzeuge → WebSocket-Servereinstellungen → „WebSocket-Server aktivieren“ (Port 4455).
// Das Passwort von dort kommt in CommandWave unter Einstellungen. Verbunden wird nur mit diesem PC (localhost).
const obs = require("./obs");

module.exports = (api) => {
  const T = {
    de: { StartRecord: "Aufnahme läuft.", StopRecord: "Aufnahme gestoppt.", StartStream: "Stream gestartet.", StopStream: "Stream beendet.",
      PauseRecord: "Aufnahme pausiert.", ResumeRecord: "Aufnahme läuft weiter.", scene: (n) => `Szene ${n}.`,
      noScene: (q, list) => `Eine Szene „${q}“ habe ich nicht gefunden.${list.length ? " Es gibt: " + list.join(", ") + "." : ""}`, askScene: "Welche Szene?",
      unreachable: "OBS ist nicht erreichbar. Läuft OBS und ist der WebSocket-Server an (Werkzeuge → WebSocket-Servereinstellungen)?",
      auth: "Das OBS-Passwort stimmt nicht – bitte in CommandWave unter Einstellungen eintragen.", timeout: "OBS antwortet gerade nicht.",
      failed: { StartRecord: "Die Aufnahme läuft schon.", StopRecord: "Gerade läuft keine Aufnahme.", StartStream: "Der Stream läuft schon.", StopStream: "Gerade läuft kein Stream.",
        PauseRecord: "Die Aufnahme lässt sich gerade nicht pausieren.", ResumeRecord: "Die Aufnahme ist nicht pausiert.", other: "Das hat OBS nicht gemacht." } },
    en: { StartRecord: "Recording started.", StopRecord: "Recording stopped.", StartStream: "Stream started.", StopStream: "Stream stopped.",
      PauseRecord: "Recording paused.", ResumeRecord: "Recording resumed.", scene: (n) => `Scene ${n}.`,
      noScene: (q, list) => `I couldn't find a scene "${q}".${list.length ? " There is: " + list.join(", ") + "." : ""}`, askScene: "Which scene?",
      unreachable: "I can't reach OBS. Is OBS running with the WebSocket server enabled (Tools → WebSocket Server Settings)?",
      auth: "The OBS password is wrong – please enter it in the CommandWave settings.", timeout: "OBS isn't responding right now.",
      failed: { StartRecord: "OBS is already recording.", StopRecord: "OBS isn't recording.", StartStream: "The stream is already running.", StopStream: "There is no stream running.",
        PauseRecord: "The recording can't be paused right now.", ResumeRecord: "The recording isn't paused.", other: "OBS didn't do that." } },
  };
  const opts = () => {
    const s = api.settings();
    return { url: String(s.url || "ws://127.0.0.1:4455").trim(), password: String(s.password || "") };
  };
  const explain = (e, t, type) => {
    if (e.code === "auth" || e.code === "unreachable" || e.code === "timeout") return t[e.code];
    if (e.code === "failed") return t.failed[type] || t.failed.other;
    api.log("OBS:", e.message);
    return t.unreachable;
  };
  const simple = (type) => async (ctx) => {
    const t = T[ctx.lang] || T.de;
    try {
      await obs.request(type, {}, opts());
      return t[type];
    } catch (e) {
      return explain(e, t, type);
    }
  };
  const scene = async (ctx) => {
    const t = T[ctx.lang] || T.de;
    const q = String(ctx.slots.frei?.key || (await ctx.ask(t.askScene)) || "").trim();
    if (!q) return "";
    try {
      const list = ((await obs.request("GetSceneList", {}, opts())).scenes || []).map((s) => s.sceneName).filter(Boolean).reverse(); // OBS liefert sie von unten nach oben
      const name = obs.matchScene(q, list);
      if (!name) return t.noScene(q, list);
      await obs.request("SetCurrentProgramScene", { sceneName: name }, opts());
      return t.scene(name);
    } catch (e) {
      return explain(e, t, "scene");
    }
  };

  api.command(["aufnahme starten", "(starte|start) [die] aufnahme", "nimm auf"], simple("StartRecord"));
  api.command(["aufnahme (stoppen|beenden)", "(stoppe|stopp|beende) [die] aufnahme"], simple("StopRecord"));
  api.command(["aufnahme pausieren", "pausiere [die] aufnahme"], simple("PauseRecord"));
  api.command(["aufnahme fortsetzen", "aufnahme weiter", "(setze|setz) [die] aufnahme fort"], simple("ResumeRecord"));
  api.command(["stream starten", "(starte|start) [den] stream", "(geh|gehe) live"], simple("StartStream"));
  api.command(["stream (stoppen|beenden)", "(stoppe|stopp|beende) [den] stream"], simple("StopStream"));
  api.command(["szene {frei}", "(wechsle|wechsel) [zur|zu] szene {frei}", "(zeige|zeig) [die] szene {frei}", "szene wechseln"], scene);
  api.command(["start [the] recording", "start recording"], simple("StartRecord"), { lang: "en" });
  api.command(["stop [the] recording"], simple("StopRecord"), { lang: "en" });
  api.command(["pause [the] recording"], simple("PauseRecord"), { lang: "en" });
  api.command(["resume [the] recording"], simple("ResumeRecord"), { lang: "en" });
  api.command(["start [the] stream", "go live"], simple("StartStream"), { lang: "en" });
  api.command(["stop [the] stream", "end [the] stream"], simple("StopStream"), { lang: "en" });
  api.command(["[switch to] scene {frei}", "switch to [the] scene {frei}"], scene, { lang: "en" });
};
