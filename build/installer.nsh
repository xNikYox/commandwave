; CommandWave – Installer-Ergänzung
; Lässt sich die alte Version nicht sauber entfernen (z. B. weil ein abgebrochenes Update ihr Deinstallationsprogramm
; beschädigt hat), NICHT abbrechen („Alte Anwendungsdateien konnten nicht deinstalliert werden“), sondern einfach
; drüber installieren. Einstellungen und Mods liegen ohnehin getrennt in %APPDATA%\CommandWave.
!macro customUnInstallCheck
  IfErrors 0 +3
  DetailPrint "Alte Version: Deinstallationsprogramm fehlt – installiere darüber."
  ClearErrors
  ${if} $R0 != 0
    DetailPrint "Alte Version ließ sich nicht vollständig entfernen (Code $R0) – installiere darüber."
  ${endIf}
  StrCpy $R0 0
!macroend
