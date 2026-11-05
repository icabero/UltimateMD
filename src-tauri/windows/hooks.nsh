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
