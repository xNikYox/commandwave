# Test: alte Installation mit KAPUTTEM Deinstallationsprogramm (wie nach einem abgebrochenen Update) –
# der neue Installer muss trotzdem durchlaufen statt „Alte Anwendungsdateien konnten nicht deinstalliert werden“.
param([string]$OldSetup, [string]$NewSetup, [string]$NewVersion)
$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:LOCALAPPDATA 'Programs\commandwave'
$exe = Join-Path $dir 'CommandWave.exe'
Start-Process $OldSetup -ArgumentList '/S' -Wait
Start-Sleep 5
Get-Process CommandWave -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 2
# Deinstallationsprogramm und Programmdateien entfernen, Registry-Eintrag bleibt – so sah es beim Nutzer aus
Remove-Item (Join-Path $dir 'Uninstall CommandWave.exe') -Force
Remove-Item (Join-Path $dir 'resources') -Recurse -Force
Write-Host "kaputte Altinstallation hergestellt"
$p = Start-Process $NewSetup -ArgumentList '/S' -PassThru
if (-not $p.WaitForExit(240000)) { $p | Stop-Process -Force; throw "Installer hängt (über 4 Minuten)" }
Start-Sleep 5
if (-not (Test-Path $exe)) { throw "nach der Installation fehlt CommandWave.exe" }
if (-not (Test-Path (Join-Path $dir 'resources\app.asar'))) { throw "Programmdateien fehlen" }
$v = (Get-Item $exe).VersionInfo.ProductVersion
if (-not ($v -eq $NewVersion -or $v -eq "$NewVersion.0")) { throw "falsche Version: $v" }
Get-Process CommandWave -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host "Installation über kaputte Altversion bestanden: $v"
