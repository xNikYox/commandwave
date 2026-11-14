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
function amazonMusicScript(query, { like = "Amazon Music*" } = {}) {
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
    '[DllImport("user32.dll")] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);',
    '[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n);',
    '[DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr h, uint m, IntPtr w, IntPtr l, uint f, uint t, out IntPtr r);',
    '[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);',
    '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
    '[DllImport("oleacc.dll")] public static extern int AccessibleObjectFromWindow(IntPtr h, uint id, ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object o);',
    "'@",
    `  $q = ${psq(query)}`,
    "  $A = [Windows.Automation.AutomationElement]; $T = [Windows.Automation.TreeScope]; $C = [Windows.Automation.ControlType]",
    `  $like = ${psq(like)}`, // Test: andere Chromium-App (Edge) mit Testseite
    "  function Win { Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and ($_.ProcessName -like $like -or $_.MainWindowTitle -like $like) } | Select-Object -First 1 }",
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
    "    $app = Get-StartApps | Where-Object { $_.Name -like $like } | Select-Object -First 1",
    "    if (-not $app) { Out @{ ok = $false; step = 'app'; error = 'nicht installiert' } }",
    "    Start-Process explorer.exe ('shell:AppsFolder\\' + $app.AppID); $started = $true",
    "    for ($i = 0; $i -lt 60 -and -not $p; $i++) { Start-Sleep -Milliseconds 500; $p = Win }",
    "    if (-not $p) { Out @{ ok = $false; step = 'app'; error = 'startet nicht' } }",
    "    Start-Sleep -Seconds 4",
    "  }",
    "  $h = $p.MainWindowHandle; Front $h; Start-Sleep -Milliseconds 400",
    "  $root = $A::FromHandle($h)",
    // Amazon Music ist eine Chromium-App: die Bedienelemente gibt sie erst frei, wenn man ihr inneres Fenster
    // (Chrome_RenderWidgetHostHWND) wie ein Bildschirmleser anfragt – sonst sieht man nur „Chrome Legacy Window“
    "  function Kids($w) { $c = [IntPtr]::Zero; $out = @(); do { $c = [CW.AM]::FindWindowEx($w, $c, $null, $null); if ($c -ne [IntPtr]::Zero) { $out += $c; $out += Kids $c } } while ($c -ne [IntPtr]::Zero); $out }",
    "  function Cls($w) { $sb = New-Object System.Text.StringBuilder 256; $null = [CW.AM]::GetClassName($w, $sb, 256); $sb.ToString() }",
    "  $render = @(Kids $h | Where-Object { (Cls $_) -eq 'Chrome_RenderWidgetHostHWND' })",
    "  foreach ($w in $render) {",
    "    $r = [IntPtr]::Zero; foreach ($l in @(-4, -25, 1)) { $null = [CW.AM]::SendMessageTimeout($w, 0x3D, [IntPtr]::Zero, [IntPtr]$l, 2, 1000, [ref]$r) }",
    "    try { $g = [Guid]'618736e0-3c3d-11cf-810c-00aa00389b71'; $o = $null; $null = [CW.AM]::AccessibleObjectFromWindow($w, [uint32]4294967292, [ref]$g, [ref]$o) } catch {}",
    "    try { $null = $A::FromHandle($w) } catch {}",
    "  }",
    // Inhalt zuerst (so wird nie eine Adressleiste o. Ä. statt des Suchfelds der Seite genommen)
    "  $roots = @($render | ForEach-Object { try { $A::FromHandle($_) } catch {} } | Where-Object { $_ }) + @($root)",
    // 2. Suchfeld (die App lädt ihre Oberfläche nach – ein paar Sekunden warten)
    "  $edit = $null",
    "  for ($i = 0; $i -lt 30 -and -not $edit; $i++) {",
    "    $edits = @($roots | ForEach-Object { Of $_ $C::Edit } | Where-Object { $_.Current.Name -notmatch '(?i)address|adress|url' })", // keine Adressleiste
    "    $edit = $edits | Where-Object { $_.Current.Name -match '(?i)such|search' } | Select-Object -First 1",
    "    if (-not $edit) { $edit = $edits | Select-Object -First 1 }",
    "    if (-not $edit) { Start-Sleep -Milliseconds 500 }",
    "  }",
    "  if (-not $edit) { Out @{ ok = $false; step = 'suchfeld'; error = 'Suchfeld nicht gefunden'; dump = (@('Fenster: ' + (@($render).Count) + ' Chromium-Fenster') + ($roots | ForEach-Object { Dump $_ })) } }",
    "  $diag = @{ edit = $edit.Current.Name; editClass = $edit.Current.ClassName; patterns = (@($edit.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName }) -join ',') }",
    "  try { $edit.SetFocus() } catch { $diag.focusError = $_.Exception.Message; $null = Click $edit }",
    "  Start-Sleep -Milliseconds 200",
    // Text direkt ins Feld setzen (klappt auch, wenn Windows das Fenster nicht nach vorne lässt); sonst tippen
    "  $typed = 'wert'",
    "  try { $edit.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern).SetValue($q) } catch { $typed = 'tasten'; $diag.valueError = $_.Exception.Message }",
    "  $diag.hasFocus = $edit.Current.HasKeyboardFocus",
    "  if ($typed -eq 'tasten') { [System.Windows.Forms.SendKeys]::SendWait('^a'); [System.Windows.Forms.SendKeys]::SendWait([regex]::Replace($q, '[+^%~(){}\\[\\]]', '{$0}')) }",
    "  Start-Sleep -Milliseconds 300",
    "  $value = ''; try { $value = $edit.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern).Current.Value } catch {}",
    // Enter: direkt an das Chromium-Fenster schicken (Fokus liegt im Suchfeld) – vorne oder nicht
    "  $target = if (@($render).Count) { $render[0] } else { $h }",
    "  $fg = [CW.AM]::GetForegroundWindow() -eq $h",
    "  if ($fg) { [System.Windows.Forms.SendKeys]::SendWait('{ENTER}') } else { $null = [CW.AM]::PostMessage($target, 0x100, [IntPtr]0x0D, [IntPtr]0x001C0001); $null = [CW.AM]::PostMessage($target, 0x102, [IntPtr]0x0D, [IntPtr]0x001C0001); $null = [CW.AM]::PostMessage($target, 0x101, [IntPtr]0x0D, [IntPtr]0xC01C0001) }",
    // 3. Ergebnisse abwarten, ersten Abspielen-Knopf drücken (nicht den der Wiedergabeleiste unten)
    "  $wr = $root.Current.BoundingRectangle",
    "  $play = $null",
    "  for ($i = 0; $i -lt 16 -and -not $play; $i++) {",
    "    Start-Sleep -Milliseconds 500",
    "    $btns = @($roots | ForEach-Object { Of $_ $C::Button }) | Where-Object { $_.Current.Name -match '(?i)abspielen|wiedergeben|wiedergabe starten|^play\\b|play now|jetzt h' -and $_.Current.Name -notmatch '(?i)pause|zufall|shuffle|vorschau|preview' }",
    "    $btns = @($btns | Where-Object { $r = $_.Current.BoundingRectangle; $r.Width -gt 0 -and $r.Y -lt ($wr.Y + $wr.Height * 0.82) } | Sort-Object { $_.Current.BoundingRectangle.Y }, { $_.Current.BoundingRectangle.X })",
    "    $play = $btns | Select-Object -First 1",
    "  }",
    "  if (-not $play) { Out @{ ok = $false; step = 'abspielen'; error = 'kein Abspielen-Knopf'; searched = $true; typed = $typed; value = $value; foreground = $fg; diag = $diag; dump = ($roots | ForEach-Object { Dump $_ }) } }",
    "  $how = Click $play",
    "  Out @{ ok = $true; started = $started; clicked = $play.Current.Name; how = $how; typed = $typed; value = $value; foreground = $fg }",
    "} catch { Out @{ ok = $false; step = 'fehler'; error = $_.Exception.Message } }",
  ].join("\n");
}

/**
 * Text ins vorderste Fenster tippen (CommandWave selbst wird übersprungen – dann das Fenster dahinter).
 * Zeilenumbrüche werden Enter. Getippt wird über SendKeys (Sonderzeichen maskiert).
 */
function typeTextScript(text, skipPid = 0) {
  return [
    "$ErrorActionPreference = 'Stop'",
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
    "try {",
    "  Add-Type -AssemblyName System.Windows.Forms",
    "  Add-Type -Namespace CW -Name Ty -MemberDefinition @'",
    '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
    '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);',
    '[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);',
    '[DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint c);',
    '[DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);',
    '[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);',
    '[DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);',
    '[DllImport("user32.dll")] public static extern void keybd_event(byte v, byte s, int f, int e);',
    "'@",
    `  $text = ${psq(text)}; $skip = ${Number(skipPid) || 0}`,
    "  function PidOf($h) { $p = [uint32]0; $null = [CW.Ty]::GetWindowThreadProcessId($h, [ref]$p); $p }",
    "  function IsApp($h) { [CW.Ty]::IsWindowVisible($h) -and [CW.Ty]::GetWindowTextLength($h) -gt 0 -and -not (([CW.Ty]::GetWindowLong($h, -20) -band 0x80) -ne 0) }",
    "  $h = [CW.Ty]::GetForegroundWindow(); $n = 0",
    "  while ($h -ne [IntPtr]::Zero -and $n -lt 500 -and ((PidOf $h) -eq $skip -or -not (IsApp $h))) { $h = [CW.Ty]::GetWindow($h, 2); $n++ }",
    "  if ($h -eq [IntPtr]::Zero) { [pscustomobject]@{ ok = $false; error = 'kein Fenster' } | ConvertTo-Json -Compress; exit }",
    "  [CW.Ty]::keybd_event(0x12, 0, 0, 0); [CW.Ty]::keybd_event(0x12, 0, 2, 0); $null = [CW.Ty]::SetForegroundWindow($h); Start-Sleep -Milliseconds 250",
    "  $lines = $text -split \"`n\"",
    "  for ($i = 0; $i -lt $lines.Count; $i++) {",
    "    if ($lines[$i]) { [System.Windows.Forms.SendKeys]::SendWait([regex]::Replace($lines[$i], '[+^%~(){}\\[\\]]', '{$0}')) }",
    "    if ($i -lt $lines.Count - 1) { [System.Windows.Forms.SendKeys]::SendWait('{ENTER}') }",
    "  }",
    "  $name = (Get-Process -Id (PidOf $h) -ErrorAction SilentlyContinue).ProcessName",
    "  [pscustomobject]@{ ok = $true; name = $name; chars = $text.Length } | ConvertTo-Json -Compress",
    "} catch { [pscustomobject]@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress }",
  ].join("\n");
}

/** C#-Teil für den Windows-Lautstärkemixer (Core Audio: Sitzungen je Programm) */
const MIXER_CS = String.raw`
using System; using System.Collections.Generic; using System.Diagnostics; using System.Runtime.InteropServices;
namespace CWMix {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom {}
  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IMMDeviceEnumerator {
    int NotImpl1();
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice dev);
  }
  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
  }
  [Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IAudioSessionManager2 {
    int NotImpl1(); int NotImpl2();
    [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator e);
  }
  [Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IAudioSessionEnumerator {
    [PreserveSig] int GetCount(out int n);
    [PreserveSig] int GetSession(int i, out IAudioSessionControl2 s);
  }
  [Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IAudioSessionControl2 {
    int GetState(out int s);
    int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string n);
    int N1(); int N2(); int N3(); int N4(); int N5(); int N6(); int N7();
    int N8(); int N9();
    [PreserveSig] int GetProcessId(out int pid);
  }
  [Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface ISimpleAudioVolume {
    [PreserveSig] int SetMasterVolume(float v, ref Guid ctx);
    [PreserveSig] int GetMasterVolume(out float v);
    [PreserveSig] int SetMute(bool m, ref Guid ctx);
    [PreserveSig] int GetMute(out bool m);
  }
  public class Result { public bool ok; public string error; public int count; public int volume = -1; public bool muted; public string[] apps; }
  public static class Mixer {
    public static Result Run(string[] names, string op, float value) {
      var r = new Result();
      IMMDevice dev;
      var en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorCom());
      if (en.GetDefaultAudioEndpoint(0, 1, out dev) != 0 || dev == null) { r.error = "kein Audiogerät"; return r; }
      Guid iid = typeof(IAudioSessionManager2).GUID; object o;
      if (dev.Activate(ref iid, 23, IntPtr.Zero, out o) != 0) { r.error = "Mixer nicht erreichbar"; return r; }
      IAudioSessionEnumerator se; ((IAudioSessionManager2)o).GetSessionEnumerator(out se);
      int n; se.GetCount(out n);
      var seen = new List<string>();
      for (int i = 0; i < n; i++) {
        IAudioSessionControl2 c; se.GetSession(i, out c);
        int pid; c.GetProcessId(out pid);
        string pn = "";
        try { if (pid != 0) pn = Process.GetProcessById(pid).ProcessName.ToLowerInvariant(); } catch {}
        if (pn == "") continue;
        if (!seen.Contains(pn)) seen.Add(pn);
        bool hit = false;
        foreach (var w in names) if (w.Length > 0 && (pn == w || pn.Contains(w) || pn.Replace(" ", "").Contains(w.Replace(" ", "")))) hit = true;
        if (!hit) continue;
        var v = (ISimpleAudioVolume)c; Guid g = Guid.Empty; float cur; v.GetMasterVolume(out cur); bool m; v.GetMute(out m);
        float nv = cur;
        if (op == "up") { nv = Math.Min(1f, cur + value); if (m) v.SetMute(false, ref g); m = false; }
        else if (op == "down") nv = Math.Max(0f, cur - value);
        else if (op == "set") { nv = Math.Max(0f, Math.Min(1f, value)); if (m && nv > 0) { v.SetMute(false, ref g); m = false; } }
        else if (op == "mute") { v.SetMute(true, ref g); m = true; }
        else if (op == "unmute") { v.SetMute(false, ref g); m = false; if (cur < 0.05f) nv = 0.5f; }
        if (nv != cur) v.SetMasterVolume(nv, ref g);
        r.count++; r.volume = (int)Math.Round(nv * 100); r.muted = m;
      }
      r.apps = seen.ToArray(); r.ok = r.count > 0;
      if (!r.ok) r.error = "keine Wiedergabe";
      return r;
    }
  }
}`;

/** Lautstärke einzelner Programme: op up|down|set|mute|unmute|get, value 0..1, names = Prozessnamen (mit |) */
function appVolumeScript(names, op, value = 0.2) {
  return [
    "$ErrorActionPreference = 'Stop'",
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
    "try {",
    "  Add-Type -TypeDefinition @'",
    MIXER_CS,
    "'@",
    `  $r = [CWMix.Mixer]::Run(@(${psq(String(names).toLowerCase())}.Split('|') | Where-Object { $_ }), ${psq(op)}, [float]${Number(value) || 0})`,
    "  [pscustomobject]@{ ok = $r.ok; error = $r.error; count = $r.count; volume = $r.volume; muted = $r.muted; apps = $r.apps } | ConvertTo-Json -Compress",
    "} catch { [pscustomobject]@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress }",
  ].join("\n");
}

/** Akku und (falls Windows sie herausgibt) CPU-Temperatur */
function systemScript() {
  return [
    "$ErrorActionPreference = 'Stop'",
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
    "try {",
    "  Add-Type -AssemblyName System.Windows.Forms",
    "  $p = [System.Windows.Forms.SystemInformation]::PowerStatus",
    "  $temp = $null",
    "  try { $t = Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop | Select-Object -First 1; if ($t) { $temp = [math]::Round($t.CurrentTemperature / 10 - 273.15) } } catch {}",
    "  $load = $null; try { $load = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average } catch {}",
    "  [pscustomobject]@{ ok = $true; battery = [int][math]::Round($p.BatteryLifePercent * 100); hasBattery = ($p.BatteryChargeStatus.ToString() -notmatch 'NoSystemBattery|Unknown'); charging = ($p.PowerLineStatus.ToString() -eq 'Online'); remaining = $p.BatteryLifeRemaining; temp = $temp; load = $load } | ConvertTo-Json -Compress",
    "} catch { [pscustomobject]@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress }",
  ].join("\n");
}

/**
 * Bildschirmfoto als PNG: mode "screen" = alle Bildschirme, "window" = vorderstes Fenster (CommandWave übersprungen).
 * Vorher DPI-bewusst schalten, sonst schneidet Windows bei Skalierung (125 %, 150 %) einen Teil ab.
 */
function screenshotScript(file, mode = "screen", skipPid = 0) {
  return [
    "$ErrorActionPreference = 'Stop'",
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
    "try {",
    "  Add-Type -AssemblyName System.Drawing, System.Windows.Forms",
    "  Add-Type -Namespace CW -Name Shot -MemberDefinition @'",
    '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();',
    '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
    '[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);',
    '[DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint c);',
    '[DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);',
    '[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);',
    '[DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);',
    '[DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int s);',
    "[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }",
    "'@",
    "  $null = [CW.Shot]::SetProcessDPIAware()",
    `  $file = ${psq(file)}; $mode = ${psq(mode)}; $skip = ${Number(skipPid) || 0}`,
    "  $null = New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($file))",
    "  if ($mode -eq 'window') {",
    "    function PidOf($h) { $p = [uint32]0; $null = [CW.Shot]::GetWindowThreadProcessId($h, [ref]$p); $p }",
    "    $h = [CW.Shot]::GetForegroundWindow(); $n = 0",
    "    while ($h -ne [IntPtr]::Zero -and $n -lt 500 -and ((PidOf $h) -eq $skip -or -not [CW.Shot]::IsWindowVisible($h) -or [CW.Shot]::GetWindowTextLength($h) -eq 0 -or (([CW.Shot]::GetWindowLong($h, -20) -band 0x80) -ne 0))) { $h = [CW.Shot]::GetWindow($h, 2); $n++ }",
    "    if ($h -eq [IntPtr]::Zero) { [pscustomobject]@{ ok = $false; error = 'kein Fenster' } | ConvertTo-Json -Compress; exit }",
    // sichtbarer Rahmen ohne Schatten (DWMWA_EXTENDED_FRAME_BOUNDS = 9)
    "    $r = New-Object CW.Shot+RECT; $null = [CW.Shot]::DwmGetWindowAttribute($h, 9, [ref]$r, 16)",
    "    $x = $r.Left; $y = $r.Top; $w = $r.Right - $r.Left; $hh = $r.Bottom - $r.Top",
    "    $name = (Get-Process -Id (PidOf $h) -ErrorAction SilentlyContinue).ProcessName",
    "  } else {",
    "    $v = [System.Windows.Forms.SystemInformation]::VirtualScreen; $x = $v.X; $y = $v.Y; $w = $v.Width; $hh = $v.Height; $name = ''",
    "  }",
    "  if ($w -le 0 -or $hh -le 0) { [pscustomobject]@{ ok = $false; error = 'leerer Bereich' } | ConvertTo-Json -Compress; exit }",
    "  $bmp = New-Object System.Drawing.Bitmap $w, $hh",
    "  $g = [System.Drawing.Graphics]::FromImage($bmp)",
    "  $g.CopyFromScreen($x, $y, 0, 0, $bmp.Size)",
    "  $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)",
    "  $g.Dispose(); $bmp.Dispose()",
    "  [pscustomobject]@{ ok = $true; file = $file; width = $w; height = $hh; name = $name } | ConvertTo-Json -Compress",
    "} catch { [pscustomobject]@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress }",
  ].join("\n");
}

module.exports = { mediaSessionScript, browserScript, windowScript, amazonMusicScript, typeTextScript, appVolumeScript, systemScript, screenshotScript, MIXER_CS, BROWSERS, TAB_KEYS, psq };
