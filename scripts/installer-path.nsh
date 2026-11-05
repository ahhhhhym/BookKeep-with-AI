; Only installer drive roots are expanded. Never normalize an uninstaller's owned path.
!ifndef BUILD_UNINSTALLER
Function bkNormalizeInstallDirectory
  Push $0
  Push $1
  Push $2
  StrLen $0 $INSTDIR
  ; A drive-only input is a root selection, not the current directory on that drive.
  ${If} $0 == 2
    StrCpy $1 $INSTDIR 1 1
    ${If} $1 == ":"
      StrCpy $INSTDIR "$INSTDIR\BookKeepAI"
    ${EndIf}
  ${Else}
    GetFullPathName $0 "$INSTDIR"
    StrLen $1 $0
    ${If} $1 == 3
      StrCpy $1 $0 1 1
      StrCpy $2 $0 1 2
      ${If} $1 == ":"
      ${AndIf} $2 == "\"
        StrCpy $INSTDIR "$0BookKeepAI"
      ${EndIf}
    ${EndIf}
  ${EndIf}
  Pop $2
  Pop $1
  Pop $0
FunctionEnd
!endif
