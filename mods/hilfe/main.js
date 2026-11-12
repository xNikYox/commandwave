// „Was kannst du?“ – liest die Liste der Mods aus dem Mods-Ordner (Nachbarordner dieser Mod)
const fs = require("node:fs");
const path = require("node:path");

module.exports = (api) => {
  api.command(["was kannst du", "hilfe", "welche befehle (gibt es|kennst du)"], () => {
    const root = path.dirname(api.dir);
    const names = fs.readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(root, d.name, "mod.json"), "utf8")).name;
        } catch {
          return null;
        }
      })
      .filter((n) => n && n !== "Hilfe");
    return `Ich kann: ${names.slice(0, -1).join(", ")} und ${names.at(-1)}. Alle Befehle findest du im Fenster unter Befehle.`;
  });
  api.command(["wer bist du", "wie heißt du"], () => "Ich bin CommandWave, dein Sprachassistent. Ich laufe komplett auf deinem PC.");
  api.command(["what can you do", "help [me]", "what commands (are there|do you know)"], () =>
    "I can open and close apps, control music and volume, open websites and folders, manage browser tabs and windows, search the web, tell the time and set timers. All commands are listed in the window.", { lang: "en" });
  api.command(["who are you", "what is your name"], () => "I'm CommandWave, your voice assistant. I run completely on your PC.", { lang: "en" });
};
