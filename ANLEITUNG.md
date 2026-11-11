# CommandWave – Anleitung

CommandWave ist ein Sprachassistent für Windows 11, der **komplett auf deinem PC** läuft. Spracherkennung und Sprachausgabe arbeiten offline – kein Server, keine Cloud, kein Ton verlässt den Rechner.

---

## 1. Installieren und starten (ohne Programmierkenntnisse)

1. **`CommandWave-1.0.0.exe`** herunterladen (Download-Seite) und doppelklicken.
   Es ist eine „portable“ App: keine Installation, die Datei startet direkt. Am besten in einen festen Ordner legen, z. B. `C:\Programme\CommandWave\`.
2. Windows SmartScreen warnt beim ersten Start („Unbekannter Herausgeber“), weil die App kein gekauftes Zertifikat hat:
   **„Weitere Informationen“ → „Trotzdem ausführen“**.
3. Beim ersten Zuhören fragt Windows nach dem Mikrofon. Falls nichts passiert:
   **Einstellungen → Datenschutz und Sicherheit → Mikrofon → „Desktop-Apps den Zugriff auf das Mikrofon erlauben“** einschalten.
4. **Deutsche Stimme prüfen:** Unter *Einstellungen* in CommandWave auf **„Probe“** klicken.
   Kommt keine deutsche Stimme: Windows-**Einstellungen → Zeit und Sprache → Sprache und Region → Deutsch → Sprachoptionen → Sprachausgabe** installieren, danach CommandWave neu starten.

### Benutzen

- **Strg + Leertaste** drücken (oder auf das Mikrofon klicken), kurz warten bis der Ton kommt, dann sprechen:
  - „**Öffne die App Editor**“ → *„Editor wird gestartet“* und der Editor geht auf
  - „Starte den Rechner“, „Schließe Paint“, „Öffne YouTube“, „Öffne Downloads“
  - „Wie spät ist es?“, „Welcher Tag ist heute?“, „Stelle einen Timer auf fünf Minuten“
  - „Lauter“, „Leiser“, „Pause“, „Nächstes Lied“
  - „Was kannst du?“
- Versteht CommandWave etwas nicht: *„Diesen Befehl kenne ich leider nicht.“*
- Alle Befehle stehen im Fenster unter **Befehle**. Man kann sie dort auch eintippen.
- Das Fenster schließen = CommandWave läuft im **Tray** (unten rechts) weiter. Beenden: Rechtsklick aufs Tray-Symbol → Beenden.
- Ist **Strg + Leertaste** schon belegt (z. B. für die Tastatursprache), unter *Einstellungen → Tastenkombination* eine andere wählen.

---

## 2. Wie es funktioniert (Architektur)

| Teil | Technik | Warum |
|---|---|---|
| App, Fenster, Tray, Tastenkombination | **Electron** (JavaScript/Node.js) | eine eigenständige Windows-App, stabil, einfach erweiterbar |
| Spracherkennung | **Vosk** mit deutschem Modell (`vosk-model-small-de-0.15`, 45 MB, Apache 2.0), läuft als WebAssembly im Fenster | 100 % offline; CommandWave gibt Vosk nur die Sätze aus den Mods vor („Grammatik“) – das macht die Erkennung von Befehlen sehr zuverlässig |
| Verstehen | eigener Satz-Abgleich (`src/core/phrases.js`) | ordnet das Gehörte dem passenden Befehl zu und verzeiht Füllwörter („bitte“, „den“) und kleine Hörfehler |
| Sprachausgabe | die **Windows-Stimmen** (z. B. Microsoft Hedda/Katja) | offline, schon auf dem PC |
| Mods | Ordner `mods\` mit `mod.json` (+ optional `main.js`) | neue Befehle ohne den Hauptcode zu ändern |
| Mod-Updater | Quellen: Ordner/Netzlaufwerk, öffentliches GitHub-Repo, Adresse mit `index.json` | prüft Versionen, lädt neue Dateien, prüft jede per **SHA-256**, tauscht atomar, sichert die alte Version |

Der Mods-Ordner liegt unter `%APPDATA%\CommandWave\mods` (im Fenster: *Mods → Mods-Ordner öffnen*).
Die mitgelieferten Mods werden beim ersten Start dorthin kopiert – du kannst sie direkt bearbeiten.

---

## 3. Eigene Mods schreiben

Eine Mod ist ein **Ordner** im Mods-Ordner. Der Ordnername ist die `id` (klein, ohne Leerzeichen).

### a) Einfache Mod – nur `mod.json`, kein Programmieren

`mods\gruss\mod.json`:

```json
{
  "id": "gruss",
  "name": "Begrüßung",
  "version": "1.0.0",
  "author": "Ich",
  "description": "Sagt guten Morgen und öffnet die Nachrichten.",
  "commands": [
    {
      "phrases": ["guten morgen", "(hallo|hi) assistent"],
      "say": "Guten Morgen! Ich öffne die Nachrichten.",
      "action": { "type": "open", "target": "https://www.tagesschau.de" }
    }
  ]
}
```

Speichern → im Fenster **Mods → Neu laden** → „Guten Morgen“ sagen. Fertig.

**Sätze schreiben (`phrases`):**

| Schreibweise | Bedeutung | Beispiel |
|---|---|---|
| `[ … ]` | darf fehlen | `öffne [die app] {app}` passt auf „öffne Editor“ und „öffne die App Editor“ |
| `( a \| b )` | eins davon | `(mach\|mache) {app} auf` |
| `{name}` | Platzhalter – Werte stehen unter `slots` | `{app}` → editor, rechner, … |

**Platzhalter (`slots`):** Werte, die man sagen kann. Mehrere Mods dürfen denselben Platzhalter ergänzen – so fügt man z. B. neue Apps zu `{app}` hinzu, ohne die Apps-Mod anzufassen:

```json
{
  "id": "meine-apps",
  "version": "1.0.0",
  "slots": { "app": { "gimp": { "target": "C:\\Program Files\\GIMP 2\\bin\\gimp-2.10.exe", "label": "GIMP" } } }
}
```

In `say` und `action` kann man einsetzen: `{app}` (Anzeigename), `{app.value}` (Ziel), `{app.irgendwas}` (eigene Felder, z. B. `{app.process}`).

**Aktionen (`action.type`):**

| Typ | macht | Beispiel |
|---|---|---|
| `run` | Programm starten | `{ "type": "run", "target": "notepad.exe", "args": ["C:\\notiz.txt"] }` |
| `open` | Webseite, Ordner, Datei, Windows-Einstellung | `{ "type": "open", "target": "ms-settings:bluetooth" }` |
| `media` | Lautstärke/Musik: `volume_up`, `volume_down`, `mute`, `play_pause`, `next`, `previous`, `stop` | `{ "type": "media", "key": "volume_up", "times": 5 }` |
| `keys` | Tasten drücken (SendKeys-Schreibweise) | `{ "type": "keys", "keys": "^c" }` |
| `shell` | PowerShell-Befehl (mächtig – nur für eigene Mods!) | `{ "type": "shell", "command": "Stop-Computer" }` |
| `sequence` | mehrere Schritte, mit `{ "type": "wait", "ms": 1000 }` dazwischen | |

### b) Skript-Mod – mit eigener Logik (`main.js`)

`mod.json` bekommt `"main": "main.js"`. In `main.js`:

```js
module.exports = (api) => {
  api.command(["würfle", "wirf einen würfel"], () => {
    return `Ich habe eine ${1 + Math.floor(Math.random() * 6)} gewürfelt.`;
  });
};
```

Die Schnittstelle `api`: `command(sätze, handler)`, `slot(name, werte)`, `say(text)`, `notify(titel, text)`, `run(programm, args)`, `open(adresse)`, `media(taste)`, `storage.get()/set()`, `log(...)`.
Der Handler bekommt `ctx` mit `ctx.slots` (z. B. `ctx.slots.zahl.value`) und darf `async` sein. Ein vollständiges Beispiel ist die mitgelieferte Mod **uhrzeit** (Uhrzeit, Datum, Timer).

> ⚠ Skript-Mods laufen mit deinen Rechten – nur Mods aus Quellen installieren, denen du vertraust.

### Tipp: Wort wird nie erkannt?

Das deutsche Sprachmodell kennt nicht jedes Wort (z. B. „Discord“). Dann schreibt man es so, wie es klingt: `"disk kord": { "target": "discord:", "label": "Discord" }`.

---

## 4. Mod-Updates (Auto-Updater)

Unter *Einstellungen → Mod-Updates* eine **Quelle** eintragen:

- **GitHub:** `name/repository` (öffentliches Repo), optional mit Unterordner: `name/repository/mods`
- **Ordner:** z. B. `\\NAS\CommandWave-Mods` oder `D:\Mods` – auch ohne `index.json`
- **Adresse:** `https://example.de/cw-mods/` (dort muss eine `index.json` liegen)

CommandWave prüft **beim Start** und bei **Mods → Nach Updates suchen**:

- schon installierte Mods mit höherer Version werden **automatisch** aktualisiert (abschaltbar),
- **neue** Mods erscheinen mit „Installieren“ – bei Skript-Mods mit Warnhinweis,
- jede Datei wird per SHA-256 geprüft; stimmt etwas nicht, bleibt die alte Version,
- die alte Version wird unter `mods\.backup` gesichert (die letzten 3 je Mod).

### Eigenes Mod-Repo auf GitHub anlegen

1. Neues **öffentliches** Repo anlegen, z. B. `commandwave-mods`.
2. Jede Mod als Ordner hineinlegen (`gruss\mod.json`, …).
3. Im Projektordner von CommandWave: `node scripts\build-index.js C:\Pfad\zu\commandwave-mods` → erzeugt die `index.json`.
4. Alles hochladen (Commit + Push).
5. In CommandWave die Quelle `deinname/commandwave-mods` eintragen.

Für ein Update: `version` in der `mod.json` erhöhen (z. B. `1.0.0` → `1.1.0`), `build-index.js` erneut ausführen, hochladen. Alle PCs mit dieser Quelle holen es sich beim nächsten Start.

---

## 5. Für Entwickler: aus dem Quellcode starten und selbst bauen

1. **Node.js 22 LTS** installieren: <https://nodejs.org> (Installer, alle Häkchen lassen).
2. Projektordner öffnen, in der Adresszeile `cmd` eintippen → Enter.
3. Einmalig:
   ```
   npm install
   npm run model
   ```
   (`npm run model` lädt das deutsche Sprachmodell nach `models\` – nur zum Bauen nötig.)
4. Starten: `npm start`
5. Tests: `npm test`
6. Eigene `.exe` bauen: `npm run dist:win` → liegt danach in `dist\`.

Projektaufbau:

```
src/main.js            Hauptprozess: Fenster, Tray, Tastenkombination, Updater, Einstellungen
src/core/phrases.js    Sätze/Platzhalter verstehen, Grammatik für die Erkennung
src/core/mods.js       Mods laden und prüfen, Schnittstelle für Skript-Mods
src/core/actions.js    Aktionen: run, open, media, keys, shell, sequence
src/core/assistant.js  verbindet alles: Text → Befehl → Aktion → Antwort
src/core/updater.js    Mod-Updater (Ordner, GitHub, Adresse) mit SHA-256-Prüfung
src/renderer/          Fenster: Oberfläche, Vosk-Erkennung, Windows-Stimmen
mods/                  mitgelieferte Mods (werden beim ersten Start kopiert)
scripts/build-index.js index.json für eine Mod-Quelle erzeugen
scripts/get-model.js   Sprachmodell herunterladen
```
