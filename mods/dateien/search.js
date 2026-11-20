// Dateien finden: zuerst über den Windows-Suchindex (schnell, auch große Ordner), sonst selbst durch die Ordner gehen.
// Gesucht wird in Dokumente, Desktop, Downloads, Bilder und Musik – so, wie Windows sie wirklich ablegt
// (bei OneDrive z. B. C:\Users\…\OneDrive\Dokumente).
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { tokens } = require("./rank");

const psq = (s) => "'" + String(s ?? "").replace(/'/g, "''") + "'";
const FOLDERS = [["Dokumente", "MyDocuments"], ["Desktop", "Desktop"], ["Downloads", null], ["Bilder", "MyPictures"], ["Musik", "MyMusic"]];

/**
 * Suchbegriffe für den Index: Wortanfänge (4 Buchstaben – verzeiht Hörfehler am Wortende), Umlaute in beiden
 * Schreibweisen („mueller“ findet „Müller“). Der Index liefert Kandidaten, die genaue Reihenfolge macht rank.js.
 */
function likeTerms(query) {
  const t = tokens(query);
  const out = new Set();
  for (const w of [...t.ae, ...t.plain]) {
    if (w.length < 3) continue;
    const head = w.slice(0, Math.min(w.length, 4));
    out.add(head);
    if (/ae|oe|ue/.test(head)) out.add(head.replace(/ae/g, "ä").replace(/oe/g, "ö").replace(/ue/g, "ü"));
  }
  return [...out].map((x) => x.replace(/[%_\[\]']/g, "")).filter(Boolean).slice(0, 8);
}

/** PowerShell: Benutzerordner (OneDrive-tauglich) + Treffer aus SYSTEMINDEX → eine JSON-Zeile { ok, roots, files } */
function indexScript(query, max = 200) {
  const terms = likeTerms(query);
  return [
    "$ErrorActionPreference = 'Stop'",
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
    "$roots = @()",
    // Downloads hat keinen SpecialFolder – steht in der Registry (bei Umleitung auch woanders)
    "$dl = $null; try { $dl = [Environment]::ExpandEnvironmentVariables((Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders' -ErrorAction Stop).'{374DE290-123F-4565-9164-39C4925E467B}') } catch {}",
    "if (-not $dl) { $dl = Join-Path $env:USERPROFILE 'Downloads' }",
    ...FOLDERS.map(([label, sf]) => `$p = ${sf ? `[Environment]::GetFolderPath('${sf}')` : "$dl"}; if ($p -and (Test-Path -LiteralPath $p)) { $roots += [pscustomobject]@{ label = ${psq(label)}; path = $p } }`),
    `$terms = @(${terms.map(psq).join(", ")})`,
    "try {",
    "  $files = @()",
    "  if ($terms.Count) {",
    "    $con = New-Object -ComObject ADODB.Connection",
    "    $con.Open(\"Provider=Search.CollatorDSO;Extended Properties='Application=Windows';\")",
    "    $like = ($terms | ForEach-Object { \"System.FileName LIKE '%\" + $_ + \"%'\" }) -join ' OR '",
    "    foreach ($r in $roots) {",
    "      $scope = 'file:' + $r.path.Replace(\"'\", \"''\")",
    `      $sql = "SELECT TOP ${Number(max) || 200} System.ItemPathDisplay, System.ItemNameDisplay, System.DateModified FROM SYSTEMINDEX WHERE SCOPE='$scope' AND ($like)"`,
    "      $rs = New-Object -ComObject ADODB.Recordset",
    "      $rs.Open($sql, $con)",
    "      while (-not $rs.EOF) {",
    "        $p = $rs.Fields.Item('System.ItemPathDisplay').Value",
    "        if ($p -and -not [IO.Directory]::Exists($p)) {",
    "          $m = $rs.Fields.Item('System.DateModified').Value",
    "          $files += [pscustomobject]@{ path = $p; name = [IO.Path]::GetFileName($p); folder = $r.label; modified = $(if ($m -is [datetime]) { $m.ToString('o') } else { $null }) }",
    "        }",
    "        $rs.MoveNext()",
    "      }",
    "      $rs.Close()",
    "    }",
    "    $con.Close()",
    "  }",
    "  [pscustomobject]@{ ok = $true; index = $true; roots = $roots; files = $files } | ConvertTo-Json -Compress -Depth 4",
    "} catch { [pscustomobject]@{ ok = $false; error = $_.Exception.Message; roots = $roots; files = @() } | ConvertTo-Json -Compress -Depth 4 }",
  ].join("\n");
}

/** Ohne Windows-Antwort: die üblichen Ordner im Benutzerprofil */
function defaultRoots(home = os.homedir()) {
  const names = { Dokumente: "Documents", Desktop: "Desktop", Downloads: "Downloads", Bilder: "Pictures", Musik: "Music" };
  return Object.entries(names).map(([label, dir]) => ({ label, path: path.join(home, dir) })).filter((r) => fs.existsSync(r.path));
}

const SKIP = new Set(["node_modules", "appdata", "$recycle.bin", "windows", "program files", "program files (x86)", "__pycache__", "site-packages"]);

/**
 * Selbst suchen (wenn der Index nichts liefert oder aus ist): Ordner rekursiv, höchstens depth Ebenen und max Einträge,
 * versteckte und System-Ordner nicht → [{ path, name, folder }] (Änderungsdatum holt main.js nur für gute Treffer)
 */
function walk(roots, { depth = 6, max = 20000 } = {}) {
  const out = [];
  let seen = 0;
  const go = (dir, folder, d) => {
    if (d > depth || seen >= max) return;
    let list = [];
    try {
      list = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // kein Zugriff
    }
    for (const e of list) {
      if (++seen > max) return;
      if (e.name.startsWith(".") || e.name.startsWith("~$")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP.has(e.name.toLowerCase())) go(p, folder, d + 1);
      } else if (e.isFile()) out.push({ path: p, name: e.name, folder });
    }
  };
  for (const r of roots || []) go(r.path, r.label, 0);
  return out;
}

/** Änderungsdatum nachtragen (für den Gleichstand „neuere Datei zuerst“) */
function withDates(files) {
  return files.map((f) => {
    if (f.modified) return f;
    try {
      return { ...f, modified: fs.statSync(f.path).mtime.toISOString() };
    } catch {
      return f;
    }
  });
}

module.exports = { indexScript, likeTerms, defaultRoots, walk, withDates };
