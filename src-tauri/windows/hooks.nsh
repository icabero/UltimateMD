; An AI client keeps the MCP server running, and Windows does not let a file
; in use be replaced, so installing, updating or removing the app would fail.
; Only the copy in this folder is closed: a portable one elsewhere stays.
; The client starts it again on its next call, or when it is restarted.
!macro CLOSE_MCP_SERVER
  ; The installer is 32-bit, and so is the PowerShell it starts: that one does
  ; not see where a 64-bit process runs from, but WMI does.
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process | Where-Object { $$_.Name -eq 'ultimatemd-mcp.exe' -and $$_.ExecutablePath -like '$INSTDIR\*' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force }; Start-Sleep -Milliseconds 300"`
  Pop $0
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro CLOSE_MCP_SERVER
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro CLOSE_MCP_SERVER
!macroend

; Leaves the language picked in the installer next to the program, where the app
; reads it on start until the user chooses another one in Settings.
!macro NSIS_HOOK_POSTINSTALL
  StrCpy $R8 "en"
  ${If} $LANGUAGE == ${LANG_SPANISH}
    StrCpy $R8 "es"
  ${ElseIf} $LANGUAGE == ${LANG_BASQUE}
    StrCpy $R8 "eu"
  ${EndIf}
  FileOpen $R9 "$INSTDIR\language.txt" w
  FileWrite $R9 $R8
  FileClose $R9
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$INSTDIR\language.txt"
!macroend
