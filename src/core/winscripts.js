// CommandWave – PowerShell-Skripte für Windows-Funktionen ohne zusätzliche Programme:
//   Mediensteuerung: Windows „Global System Media Transport Controls“ (dieselbe Steuerung wie das Musik-Feld bei der
//                    Lautstärke) – gezielt je App: Amazon Music, Spotify, Browser …; auch „was läuft gerade“
//   Browser-Tabs:    Tastenkürzel an das oberste Browserfenster; Tabs nach Namen schließen über die Windows-
//                    Bedienungshilfe (UI Automation), auch wenn der Tab nicht vorne ist
//   Fenster:         minimieren, maximieren, an den Rand schieben, Desktop zeigen, zu einer App wechseln (user32.dll)
const psq = (s) => "'" + String(s ?? "").replace(/'/g, "''") + "'";

/** Medien: command = next | previous | play | pause | toggle | stop | info; app = Teil der App-Kennung (z. B. "amazon") */
function mediaSessionScript(command, app = "") {
  return [
    "$ErrorActionPreference = 'Stop'",
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
    "try {",
    "  Add-Type -AssemblyName System.Runtime.WindowsRuntime",
    "  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]",
    "  function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $null = $t.Wait(5000); $t.Result }",
    "  $M = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]",
    "  $mgr = Await ($M::RequestAsync()) ($M)",
    "  $all = @($mgr.GetSessions())",
    `  $want = ${psq(String(app).toLowerCase())}`,
    // gewünschte App suchen (Kennung enthält den Namen), sonst die aktuelle Wiedergabe
    "  $s = $null",
    // mehrere Namen mit | (z. B. "chrome|msedge|firefox"): die erste passende App, die gerade spielt, sonst irgendeine passende
    "  $parts = @($want.Split('|') | Where-Object { $_ })",
    "  if ($parts.Count) {",
    "    $hit = @($all | Where-Object { $id = $_.SourceAppUserModelId.ToLower(); @($parts | Where-Object { $id.Contains($_) }).Count -gt 0 })",
    "    $s = ($hit | Where-Object { $_.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing' } | Select-Object -First 1)",
    "    if (-not $s) { $s = $hit | Select-Object -First 1 }",
    "  }",
    "  elseif ($mgr.GetCurrentSession()) { $s = $mgr.GetCurrentSession() }",
    "  $ids = @($all | ForEach-Object { $_.SourceAppUserModelId })",
    "  if (-not $s) { [pscustomobject]@{ ok = $false; error = 'keine Wiedergabe'; sessions = $ids } | ConvertTo-Json -Compress; exit }",
    `  $cmd = ${psq(command)}`,
    "  $done = $true",
    "  switch ($cmd) {",
    "    'next' { $done = Await ($s.TrySkipNextAsync()) ([bool]) }",
    "    'previous' { $done = Await ($s.TrySkipPreviousAsync()) ([bool]) }",
    "    'play' { $done = Await ($s.TryPlayAsync()) ([bool]) }",
    "    'pause' { $done = Await ($s.TryPauseAsync()) ([bool]) }",
    "    'toggle' { $done = Await ($s.TryTogglePlayPauseAsync()) ([bool]) }",
    "    'stop' { $done = Await ($s.TryStopAsync()) ([bool]) }",
    "  }",
    "  $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])",
    "  [pscustomobject]@{ ok = [bool]$done; app = $s.SourceAppUserModelId; title = $p.Title; artist = $p.Artist; album = $p.AlbumTitle; status = $s.GetPlaybackInfo().PlaybackStatus.ToString(); sessions = $ids } | ConvertTo-Json -Compress",
    "} catch { [pscustomobject]@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress }",
  ].join("\n");
}

const BROWSERS = ["chrome", "msedge", "firefox", "brave", "opera", "vivaldi"];

/** C#-Helfer: oberstes sichtbares Browserfenster finden und nach vorne holen */
const BROWSER_CS = `
using System; using System.Diagnostics; using System.Runtime.InteropServices;
public static class CWB {
  [DllImport("user32.dll")] static extern IntPtr GetTopWindow(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern void keybd_event(byte v, byte s, int f, int e);
  public static IntPtr Top(string[] names, out string found) {
    found = "";
    IntPtr h = GetTopWindow(IntPtr.Zero);
    while (h != IntPtr.Zero) {
      if (IsWindowVisible(h) && GetWindowTextLength(h) > 0) {
        uint pid; GetWindowThreadProcessId(h, out pid);
        try { string p = Process.GetProcessById((int)pid).ProcessName.ToLower(); if (Array.IndexOf(names, p) >= 0) { found = p; return h; } } catch { }
      }
      h = GetWindow(h, 2);
    }
    return IntPtr.Zero;
  }
  public static void Focus(IntPtr h) {
    if (IsIconic(h)) ShowWindow(h, 9);
    keybd_event(0x12, 0, 0, 0); keybd_event(0x12, 0, 2, 0); // Alt antippen: Windows erlaubt dann das Nach-vorne-Holen
    SetForegroundWindow(h);
  }
}`;

const TAB_KEYS = { close: "^w", new: "^t", next: "^{TAB}", previous: "^+{TAB}", reopen: "^+t" };

/**
 * Browser: op = close | new | next | previous | reopen  (Tastenkürzel an das oberste Browserfenster)
 *          op = closeMatching, match = Text im Tab-Namen, all = alle passenden statt nur dem ersten
 *          op = list (Tab-Namen, für Tests)
 */
function browserScript(op, match = "", all = false) {
  const names = BROWSERS.map(psq).join(",");
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
    "try {",
    `  $names = @(${names})`,
    `  $op = ${psq(op)}`,
  ];
  if (TAB_KEYS[op]) {
    lines.push(
      `  Add-Type -TypeDefinition ${psq(BROWSER_CS)}`,
      "  $found = ''",
      "  $h = [CWB]::Top($names, [ref]$found)",
      "  if ($h -eq [IntPtr]::Zero) { [pscustomobject]@{ ok = $false; error = 'kein Browser' } | ConvertTo-Json -Compress; exit }",
      "  [CWB]::Focus($h)",
      "  Start-Sleep -Milliseconds 180",
      `  (New-Object -ComObject WScript.Shell).SendKeys(${psq(TAB_KEYS[op])})`,
      "  [pscustomobject]@{ ok = $true; browser = $found } | ConvertTo-Json -Compress",
    );
  } else {
    // UI Automation: alle Browserfenster → Tab-Einträge → passender Name → Schließen-Knopf im Tab drücken
    lines.push(
      "  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes",
      "  $A = [Windows.Automation.AutomationElement]",
      "  $tabCond = New-Object Windows.Automation.PropertyCondition($A::ControlTypeProperty, [Windows.Automation.ControlType]::TabItem)",
      "  $btnCond = New-Object Windows.Automation.PropertyCondition($A::ControlTypeProperty, [Windows.Automation.ControlType]::Button)",
      "  $tabs = @()",
      "  foreach ($pid2 in (Get-Process -Name $names -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id -Unique)) {",
      "    $pc = New-Object Windows.Automation.PropertyCondition($A::ProcessIdProperty, [int]$pid2)",
      "    foreach ($w in $A::RootElement.FindAll([Windows.Automation.TreeScope]::Children, $pc)) { $tabs += @($w.FindAll([Windows.Automation.TreeScope]::Descendants, $tabCond)) }",
      "  }",
      "  $all = @($tabs | ForEach-Object { $_.Current.Name } | Where-Object { $_ })",
      "  if ($op -eq 'list') { [pscustomobject]@{ ok = $true; tabs = $all } | ConvertTo-Json -Compress; exit }",
      `  $m = ${psq(String(match).toLowerCase())}`,
      "  $hits = @($tabs | Where-Object { $_.Current.Name -and $_.Current.Name.ToLower().Contains($m) })",
      all ? "" : "  if ($hits.Count -gt 1) { $hits = @($hits[0]) }",
      "  $closed = @()",
      "  foreach ($t in $hits) {",
      "    $name = $t.Current.Name",
      "    $btn = $t.FindFirst([Windows.Automation.TreeScope]::Descendants, $btnCond)",
      "    $ip = $null",
      "    if ($btn -and $btn.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern, [ref]$ip)) { $ip.Invoke(); $closed += $name; Start-Sleep -Milliseconds 150; continue }",
      // kein Schließen-Knopf: Tab auswählen und Strg+W
      "    $sp = $null",
      "    if ($t.TryGetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern, [ref]$sp)) { $sp.Select(); Start-Sleep -Milliseconds 150; (New-Object -ComObject WScript.Shell).SendKeys('^w'); $closed += $name }",
      "  }",
      "  [pscustomobject]@{ ok = $true; closed = $closed; count = $closed.Count; tabs = $all.Count } | ConvertTo-Json -Compress",
    );
  }
  lines.push("} catch { [pscustomobject]@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress }");
  return lines.filter(Boolean).join("\n");
}

/**
 * Fenster: op = minimize | maximize | restore | left | right | desktop | focus | list
 * match = Namen (mit | getrennt), nach denen bei „focus“ gesucht wird (Prozessname oder Fenstertitel)
 * skipPid = Prozess, dessen Fenster nie gemeint ist (CommandWave selbst) – dann zählt das Fenster dahinter
 */
function windowScript(op, match = "", skipPid = 0) {
  return [
    "$ErrorActionPreference = 'Stop'",
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
    "try {",
    "  Add-Type -Namespace CW -Name Win -MemberDefinition @'",
    '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
    '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);',
    '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);',
    '[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);',
    '[DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);',
    '[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);',
    '[DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint c);',
    '[DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);',
    '[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);',
    '[DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);',
    '[DllImport("user32.dll")] public static extern void keybd_event(byte v, byte s, int f, int e);',
    "'@",
    `  $op = ${psq(op)}; $skip = ${Number(skipPid) || 0}`,
    `  $want = @(${psq(String(match).toLowerCase())}.Split('|') | Where-Object { $_ })`,
    "  function PidOf($h) { $p = [uint32]0; $null = [CW.Win]::GetWindowThreadProcessId($h, [ref]$p); $p }",
    // normales App-Fenster: sichtbar, mit Titel, kein Werkzeugfenster (WS_EX_TOOLWINDOW)
    "  function IsApp($h) { [CW.Win]::IsWindowVisible($h) -and [CW.Win]::GetWindowTextLength($h) -gt 0 -and -not (([CW.Win]::GetWindowLong($h, -20) -band 0x80) -ne 0) }",
    // vorderstes Fenster – ist es CommandWave selbst, das nächste dahinter (Z-Reihenfolge)
    "  function Target() {",
    "    $h = [CW.Win]::GetForegroundWindow()",
    "    $n = 0",
    "    while ($h -ne [IntPtr]::Zero -and $n -lt 500 -and ((PidOf $h) -eq $skip -or -not (IsApp $h))) { $h = [CW.Win]::GetWindow($h, 2); $n++ }",
    "    $h",
    "  }",
    "  function Key($vk, $up) { [CW.Win]::keybd_event($vk, 0, $(if ($up) { 2 } else { 0 }), 0) }",
    // Windows erlaubt das Nach-vorne-Holen nur nach einer Eingabe: kurz Alt drücken (bekannter Trick)
    "  function Front($h) { if ([CW.Win]::IsIconic($h)) { $null = [CW.Win]::ShowWindow($h, 9) }; Key 0x12 $false; Key 0x12 $true; $null = [CW.Win]::SetForegroundWindow($h) }",
    "  switch ($op) {",
    "    'desktop' { (New-Object -ComObject Shell.Application).MinimizeAll(); [pscustomobject]@{ ok = $true } | ConvertTo-Json -Compress; exit }",
    "    'list' {",
    "      $l = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.Id -ne $skip -and $_.MainWindowTitle } | ForEach-Object { [pscustomobject]@{ name = $_.ProcessName; title = $_.MainWindowTitle } })",
    "      [pscustomobject]@{ ok = $true; windows = $l } | ConvertTo-Json -Compress -Depth 3; exit",
    "    }",
    "    'focus' {",
    // erst nach Prozessname, dann nach Fenstertitel suchen
    "      $cands = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.Id -ne $skip })",
    "      $hit = $null",
    "      foreach ($w in $want) { $hit = $cands | Where-Object { $_.ProcessName.ToLower() -eq $w } | Select-Object -First 1; if ($hit) { break } }",
    "      if (-not $hit) { foreach ($w in $want) { $hit = $cands | Where-Object { $_.ProcessName.ToLower().Contains($w) -or $_.MainWindowTitle.ToLower().Contains($w) } | Select-Object -First 1; if ($hit) { break } } }",
    "      if (-not $hit) { [pscustomobject]@{ ok = $false; error = 'kein Fenster' } | ConvertTo-Json -Compress; exit }",
    "      Front $hit.MainWindowHandle",
    "      [pscustomobject]@{ ok = $true; name = $hit.ProcessName; title = $hit.MainWindowTitle } | ConvertTo-Json -Compress; exit",
    "    }",
    "  }",
    "  $h = Target",
    "  if ($h -eq [IntPtr]::Zero) { [pscustomobject]@{ ok = $false; error = 'kein Fenster' } | ConvertTo-Json -Compress; exit }",
    "  $name = (Get-Process -Id (PidOf $h) -ErrorAction SilentlyContinue).ProcessName",
    "  switch ($op) {",
    "    'minimize' { $null = [CW.Win]::ShowWindow($h, 6) }",
    "    'maximize' { Front $h; $null = [CW.Win]::ShowWindow($h, 3) }",
    "    'restore' { $null = [CW.Win]::ShowWindow($h, 9); Front $h }",
    // an den Rand: wie Win + Pfeil (Windows-Andocken), dafür muss das Fenster vorne sein
    "    { $_ -in 'left', 'right' } { Front $h; Start-Sleep -Milliseconds 120; Key 0x5B $false; Key $(if ($op -eq 'left') { 0x25 } else { 0x27 }) $false; Key $(if ($op -eq 'left') { 0x25 } else { 0x27 }) $true; Key 0x5B $true; Start-Sleep -Milliseconds 150; Key 0x1B $false; Key 0x1B $true }",
    "    default { throw ('Unbekannt: ' + $op) }",
    "  }",
    "  [pscustomobject]@{ ok = $true; name = $name; minimized = [CW.Win]::IsIconic($h); maximized = [CW.Win]::IsZoomed($h) } | ConvertTo-Json -Compress",
    "} catch { [pscustomobject]@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress }",
  ].join("\n");
}

/**
 * Amazon Music (Windows-App) per Bedienungshilfe: App starten/nach vorne holen, Suchbegriff ins Suchfeld,
 * Enter, dann den ersten „Abspielen“-Knopf in den Ergebnissen drücken.
 * Amazon Music hat keine Schnittstelle zum Abspielen – findet das Skript etwas nicht, liefert es eine Liste
 * der Bedienelemente mit (dump), damit man es anpassen kann.
 */
function amazonMusicScript(query) {
  return [
    "$ErrorActionPreference = 'Stop'",
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
    "function Out($o) { $o | ConvertTo-Json -Compress -Depth 4; exit }",
    "try {",
    "  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms",
    "  Add-Type -Namespace CW -Name AM -MemberDefinition @'",
    '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);',
    '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);',
    '[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);',
    '[DllImport("user32.dll")] public static extern void keybd_event(byte v, byte s, int f, int e);',
    '[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);',
    '[DllImport("user32.dll")] public static extern void mouse_event(int f, int x, int y, int d, int e);',
    "'@",
    `  $q = ${psq(query)}`,
    "  $A = [Windows.Automation.AutomationElement]; $T = [Windows.Automation.TreeScope]; $C = [Windows.Automation.ControlType]",
    "  function Win { Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and ($_.ProcessName -like 'Amazon Music*' -or $_.MainWindowTitle -like 'Amazon Music*') } | Select-Object -First 1 }",
    "  function Front($h) { if ([CW.AM]::IsIconic($h)) { $null = [CW.AM]::ShowWindow($h, 9) }; [CW.AM]::keybd_event(0x12, 0, 0, 0); [CW.AM]::keybd_event(0x12, 0, 2, 0); $null = [CW.AM]::SetForegroundWindow($h) }",
    "  function Of($root, $type) { $root.FindAll($T::Descendants, (New-Object Windows.Automation.PropertyCondition($A::ControlTypeProperty, $type))) }",
    // Liste der Bedienelemente für die Fehlersuche
    "  function Dump($root) { @($root.FindAll($T::Descendants, [Windows.Automation.Condition]::TrueCondition) | Select-Object -First 150 | ForEach-Object { $_.Current.ControlType.ProgrammaticName.Replace('ControlType.', '') + ': ' + $_.Current.Name } | Where-Object { $_ -notmatch ': $' }) }",
    "  function Click($el) {",
    "    try { $el.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke(); return 'invoke' } catch {}",
    "    $r = $el.Current.BoundingRectangle; if ($r.Width -le 0) { return $null }",
    "    $null = [CW.AM]::SetCursorPos([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2)); Start-Sleep -Milliseconds 250",
    "    [CW.AM]::mouse_event(2, 0, 0, 0, 0); [CW.AM]::mouse_event(4, 0, 0, 0, 0); return 'klick'",
    "  }",
    // 1. App finden oder starten
    "  $p = Win; $started = $false",
    "  if (-not $p) {",
    "    $app = Get-StartApps | Where-Object { $_.Name -like 'Amazon Music*' } | Select-Object -First 1",
    "    if (-not $app) { Out @{ ok = $false; step = 'app'; error = 'nicht installiert' } }",
    "    Start-Process explorer.exe ('shell:AppsFolder\\' + $app.AppID); $started = $true",
    "    for ($i = 0; $i -lt 60 -and -not $p; $i++) { Start-Sleep -Milliseconds 500; $p = Win }",
    "    if (-not $p) { Out @{ ok = $false; step = 'app'; error = 'startet nicht' } }",
    "    Start-Sleep -Seconds 4",
    "  }",
    "  $h = $p.MainWindowHandle; Front $h; Start-Sleep -Milliseconds 400",
    "  $root = $A::FromHandle($h)",
    // 2. Suchfeld (die App lädt ihre Oberfläche nach – ein paar Sekunden warten)
    "  $edit = $null",
    "  for ($i = 0; $i -lt 24 -and -not $edit; $i++) {",
    "    $edits = @(Of $root $C::Edit)",
    "    $edit = $edits | Where-Object { $_.Current.Name -match '(?i)such|search' } | Select-Object -First 1",
    "    if (-not $edit) { $edit = $edits | Select-Object -First 1 }",
    "    if (-not $edit) { Start-Sleep -Milliseconds 500 }",
    "  }",
    "  if (-not $edit) { Out @{ ok = $false; step = 'suchfeld'; error = 'Suchfeld nicht gefunden'; dump = (Dump $root) } }",
    "  try { $edit.SetFocus() } catch { $null = Click $edit }",
    "  Start-Sleep -Milliseconds 200",
    // Text tippen (Sonderzeichen für SendKeys maskieren), vorher Inhalt markieren
    "  [System.Windows.Forms.SendKeys]::SendWait('^a')",
    "  [System.Windows.Forms.SendKeys]::SendWait([regex]::Replace($q, '[+^%~(){}\\[\\]]', '{$0}'))",
    "  Start-Sleep -Milliseconds 300",
    "  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')",
    // 3. Ergebnisse abwarten, ersten Abspielen-Knopf drücken (nicht den der Wiedergabeleiste unten)
    "  $wr = $root.Current.BoundingRectangle",
    "  $play = $null",
    "  for ($i = 0; $i -lt 16 -and -not $play; $i++) {",
    "    Start-Sleep -Milliseconds 500",
    "    $btns = @(Of $root $C::Button) | Where-Object { $_.Current.Name -match '(?i)abspielen|wiedergeben|wiedergabe starten|^play\\b|play now|jetzt h' -and $_.Current.Name -notmatch '(?i)pause|zufall|shuffle|vorschau|preview' }",
    "    $btns = @($btns | Where-Object { $r = $_.Current.BoundingRectangle; $r.Width -gt 0 -and $r.Y -lt ($wr.Y + $wr.Height * 0.82) } | Sort-Object { $_.Current.BoundingRectangle.Y }, { $_.Current.BoundingRectangle.X })",
    "    $play = $btns | Select-Object -First 1",
    "  }",
    "  if (-not $play) { Out @{ ok = $false; step = 'abspielen'; error = 'kein Abspielen-Knopf'; searched = $true; dump = (Dump $root) } }",
    "  $how = Click $play",
    "  Out @{ ok = $true; started = $started; clicked = $play.Current.Name; how = $how }",
    "} catch { Out @{ ok = $false; step = 'fehler'; error = $_.Exception.Message } }",
  ].join("\n");
}

module.exports = { mediaSessionScript, browserScript, windowScript, amazonMusicScript, BROWSERS, TAB_KEYS, psq };
