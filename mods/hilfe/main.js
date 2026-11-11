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
};
