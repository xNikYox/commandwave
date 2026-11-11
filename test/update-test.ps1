# Update-Test auf echtem Windows: alte Version installieren und starten, dann den neuen Installer so ausführen,
# wie es das Auto-Update tut (/S --updated --force-run). Danach muss die App noch da sein (neue Version, läuft wieder,
# Einstellungen und Mods erhalten) – genau das ging bei einem Nutzer schief („hat sich selbst deinstalliert“).
param([string]$OldSetup, [string]$NewSetup, [string]$NewVersion)
$ErrorActionPreference = 'Stop'
$exe = Join-Path $env:LOCALAPPDATA 'Programs\commandwave\CommandWave.exe'
$data = Join-Path $env:APPDATA 'CommandWave'

Write-Host "1) alte Version installieren: $OldSetup"
Start-Process $OldSetup -ArgumentList '/S' -Wait
Start-Sleep 5
Get-Process CommandWave -ErrorAction SilentlyContinue | Stop-Process -Force   # runAfterFinish startet sie
if (-not (Test-Path $exe)) { throw "alte Version nicht installiert" }
$old = (Get-Item $exe).VersionInfo.ProductVersion
Write-Host "   installiert: $old"

Write-Host "2) alte Version starten (im Tray) und Merker in den App-Daten anlegen"
Start-Process $exe -ArgumentList '--hidden'
Start-Sleep 15
New-Item -ItemType Directory -Force -Path $data | Out-Null
Set-Content (Join-Path $data 'update-test-merker.txt') 'vorher'
if (-not (Get-Process CommandWave -ErrorAction SilentlyContinue)) { throw "alte Version läuft nicht" }

Write-Host "3) Update wie electron-updater: $NewSetup /S --updated --force-run"
Start-Process $NewSetup -ArgumentList '/S', '--updated', '--force-run' -Wait
Start-Sleep 12

Write-Host "4) prüfen"
if (-not (Test-Path $exe)) { throw "App nach dem Update NICHT mehr installiert" }
$new = (Get-Item $exe).VersionInfo.ProductVersion
Write-Host "   Version jetzt: $new"
if (-not ($new -eq $NewVersion -or $new -eq "$NewVersion.0")) { throw "falsche Version nach dem Update: $new (erwartet $NewVersion)" }
if (-not (Test-Path (Join-Path $data 'update-test-merker.txt'))) { throw "App-Daten nach dem Update verloren" }
if (-not (Test-Path (Join-Path $data 'mods'))) { throw "Mods-Ordner nach dem Update verloren" }
$p = Get-Process CommandWave -ErrorAction SilentlyContinue
if (-not $p) { throw "App läuft nach dem Update nicht wieder" }
Write-Host "   läuft wieder: $($p.Count) Prozesse"
$p | Stop-Process -Force
Write-Host "Update-Test bestanden: $old -> $new, Daten und Mods erhalten, App läuft wieder."
