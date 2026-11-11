// CommandWave – installierte Apps finden (Startmenü, auch Microsoft-Store-Apps) und als Werte für {app} anbieten.
// Windows liefert die Liste mit „Get-StartApps“: Name + AppID. Gestartet wird über explorer.exe shell:AppsFolder\<AppID> –
// so öffnet Windows jede App genauso wie ein Klick im Startmenü.

/** PowerShell-Befehl: alle Startmenü-Apps als JSON */
const START_APPS_CMD = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress";

/** Apps, die nur Werkzeuge/Hilfen sind und beim Sprechen stören würden */
const SKIP = /deinstall|uninstall|readme|hilfe|help|lizenz|license|dokumentation|documentation|release notes|website|support|feedback|einrichtung|setup|update|reparatur|repair|\.url$|\.txt$|\.pdf$/i;
const VENDORS = ["microsoft", "google", "mozilla", "adobe", "apple", "amazon", "oracle", "jetbrains", "autodesk", "valve", "epic games", "ea", "ubisoft", "nvidia", "amd", "intel", "logitech"];

/** Anzeigename → Sprechname: klein, ohne ™/®, Versionsnummern, (x64), Satzzeichen */
function speakable(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[™®©]/g, "")
    .replace(/\((x64|x86|64-bit|32-bit|64 bit|32 bit|preview|beta)\)/g, "")
    .replace(/\b(x64|x86|64-bit|32-bit)\b/g, "")
    .replace(/\bv?\d+(\.\d+)+\b/g, "") // 2.10.34
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Liste aus Get-StartApps → Werte für den Platzhalter {app}: { "visual studio code": { target, label, process } }
 * Zusätzlich die Kurzform ohne Hersteller („microsoft edge“ → auch „edge“), wenn eindeutig.
 */
function toSlots(list) {
  const out = {};
  const add = (key, v) => {
    if (!key || key.length < 2 || key.split(" ").length > 4 || out[key]) return;
    out[key] = v;
  };
  for (const a of Array.isArray(list) ? list : list ? [list] : []) {
    if (!a || !a.Name || !a.AppID || SKIP.test(a.Name)) continue;
    const key = speakable(a.Name);
    if (!key || /^\d+$/.test(key)) continue;
    const value = { target: "shell:AppsFolder\\" + a.AppID, label: a.Name.replace(/[™®©]/g, "").trim(), process: "" };
    add(key, value);
    // „Music“ spricht man oft deutsch aus („Amazon Musik“)
    if (/\bmusic\b/.test(key)) add(key.replace(/\bmusic\b/g, "musik"), value);
    const vendor = VENDORS.find((v) => key.startsWith(v + " "));
    if (vendor) add(key.slice(vendor.length + 1), value);
  }
  return out;
}

module.exports = { START_APPS_CMD, speakable, toSlots };
