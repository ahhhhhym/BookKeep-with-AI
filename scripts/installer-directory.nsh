; Win32 canonicalization is lexical and works before directories exist.
; NSIS GetFullPathName can return empty for a missing directory: never compare empty paths.
!macro bkFullPathFunction PREFIX
  Function ${PREFIX}bkFullPath
    Exch $0
    Push $1
    Push $2
    System::Call 'kernel32::GetFullPathNameW(w r0, i ${NSIS_MAX_STRLEN}, w .r1, p 0) i .r2'
    ${If} $2 == 0
    ${OrIf} $2 >= ${NSIS_MAX_STRLEN}
      StrCpy $0 ""
    ${Else}
      StrCpy $0 $1
    ${EndIf}
    Pop $2
    Pop $1
    Exch $0
  FunctionEnd
!macroend

!macro bkCheckOverlap LOCALROOT PREFIX
  Push "${LOCALROOT}\BookKeepAI"
  Call ${PREFIX}bkFullPath
  Pop $1
  ${If} $1 == ""
    StrCpy $bkDirectorySafe "0"
  ${EndIf}
  StrCpy $1 "$1\"
  StrLen $2 $0
  StrCpy $3 $1 $2
  ${If} $3 == $0
    StrCpy $bkDirectorySafe "0"
  ${EndIf}
  StrLen $2 $1
  StrCpy $3 $0 $2
  ${If} $3 == $1
    StrCpy $bkDirectorySafe "0"
  ${EndIf}
!macroend

!macro bkDirectoryFunction PREFIX
  !insertmacro bkFullPathFunction "${PREFIX}"
  Function ${PREFIX}bkValidateDirectory
    Push $0
    Push $1
    Push $2
    Push $3
    StrCpy $bkDirectorySafe "1"
    Push "$INSTDIR"
    Call ${PREFIX}bkFullPath
    Pop $0
    ${If} $0 == ""
      StrCpy $bkDirectorySafe "0"
      Goto bk_parent_done
    ${EndIf}
    ; Even a spoofed install marker must never permit uninstalling a whole drive/share.
    System::Call 'shlwapi::PathIsRootW(w r0) i .r1'
    ${If} $1 != 0
      StrCpy $bkDirectorySafe "0"
      Goto bk_parent_done
    ${EndIf}
    StrCpy $0 "$0\"
    ReadEnvStr $1 LOCALAPPDATA
    !insertmacro bkCheckOverlap "$1" "${PREFIX}"
    !insertmacro bkCheckOverlap "$LOCALAPPDATA" "${PREFIX}"
    Push "$INSTDIR"
    Call ${PREFIX}bkFullPath
    Pop $0
    bk_parent_loop:
      System::Call 'kernel32::GetFileAttributesW(w r0) i .r2'
      ${If} $2 != -1
        IntOp $2 $2 & 0x400
        ${If} $2 != 0
          StrCpy $bkDirectorySafe "0"
        ${EndIf}
      ${EndIf}
      ${GetParent} "$0" $1
      StrCmp $1 "" bk_parent_done
      StrCmp $0 $1 bk_parent_done
      StrCpy $0 $1
      Goto bk_parent_loop
    bk_parent_done:
    Pop $3
    Pop $2
    Pop $1
    Pop $0
  FunctionEnd
!macroend
