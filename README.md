# CommandWave

Lokaler Sprachassistent für Windows 11 – Spracherkennung (Vosk) und Sprachausgabe (Windows-Stimmen) komplett offline, Tray-Icon, **Strg + Leertaste**, erweiterbar über Mods mit Auto-Updater.

- „Öffne die App Editor“ → *„Editor wird gestartet“* → `notepad.exe`
- Unbekannt → *„Diesen Befehl kenne ich leider nicht.“*
- Mods: Ordner mit `mod.json` (Sätze + Aktion) oder `main.js` (eigene Logik)
- Updater: Ordner/Netzlaufwerk, öffentliches GitHub-Repo oder Adresse mit `index.json`, SHA-256-Prüfung, Sicherung der alten Version

Ausführliche Anleitung (Einrichten, eigene Mods, Mod-Repo, Bauen): **[ANLEITUNG.md](ANLEITUNG.md)**

`npm install` · `npm run model` · `npm start` · `npm test` · `npm run dist:win`

Spracherkennung: [Vosk](https://alphacephei.com/vosk/) / [vosk-browser](https://github.com/ccoreilly/vosk-browser) (Apache 2.0), Modell `vosk-model-small-de-0.15` (Apache 2.0).
