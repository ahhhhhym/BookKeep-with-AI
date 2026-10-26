; Never install into user data, an ancestor/child of it, or a redirected directory.
!include LogicLib.nsh
!include FileFunc.nsh

Var bkDirectorySafe

!macro bkCheckOverlap LOCALROOT
  GetFullPathName $1 "${LOCALROOT}\BookKeepAI"
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
  Function ${PREFIX}bkValidateDirectory
    Push $0
    Push $1
    Push $2
    Push $3
    StrCpy $bkDirectorySafe "1"
    GetFullPathName $0 "$INSTDIR"
    StrCpy $0 "$0\"
    ReadEnvStr $1 LOCALAPPDATA
    !insertmacro bkCheckOverlap "$1"
    !insertmacro bkCheckOverlap "$LOCALAPPDATA"
    GetFullPathName $0 "$INSTDIR"
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

!macro customHeader
  !ifdef BUILD_UNINSTALLER
    !insertmacro bkDirectoryFunction "un."
  !else
    !insertmacro bkDirectoryFunction ""
    Function .onVerifyInstDir
      Call bkValidateDirectory
      ${If} $bkDirectorySafe != "1"
        Abort
      ${EndIf}
    FunctionEnd

    ; Runs before the normal installation section, including silent /D installs.
    Section "-BookKeep directory protection"
      Call bkValidateDirectory
      ${If} $bkDirectorySafe != "1"
        IfSilent +2
        MessageBox MB_OK|MB_ICONSTOP "请选择独立的程序目录，不要选择账本数据目录、其上级/子目录或链接目录。"
        SetErrorLevel 2
        Quit
      ${EndIf}
      ; A new install must not take ownership of a directory containing unrelated files.
      IfFileExists "$INSTDIR\.bookkeepai-install" bk_owned
      FindFirst $0 $1 "$INSTDIR\*.*"
      bk_contents_loop:
        StrCmp $1 "" bk_contents_done
        StrCmp $1 "." bk_contents_next
        StrCmp $1 ".." bk_contents_next
        FindClose $0
        IfSilent +2
        MessageBox MB_OK|MB_ICONSTOP "安装目录包含其他文件，请选择一个新的空目录。"
        SetErrorLevel 2
        Quit
      bk_contents_next:
        FindNext $0 $1
        Goto bk_contents_loop
      bk_contents_done:
        FindClose $0
        Goto bk_directory_done
      bk_owned:
        FileOpen $0 "$INSTDIR\.bookkeepai-install" r
        FileRead $0 $1
        FileClose $0
        ${If} $1 != "ai.bookkeep.desktop"
          SetErrorLevel 2
          Quit
        ${EndIf}
      bk_directory_done:
    SectionEnd
  !endif
!macroend

!macro customInit
  ; Enforce current-user installation even when /allusers was supplied.
  StrCpy $hasPerMachineInstallation "0"
  StrCpy $hasPerUserInstallation "1"
  !insertmacro setInstallModePerUser
!macroend

!macro customInstallMode
  !insertmacro setInstallModePerUser
  Abort
!macroend

!macro customInstall
  FileOpen $0 "$INSTDIR\.bookkeepai-install" w
  FileWrite $0 "ai.bookkeep.desktop"
  FileClose $0
!macroend

!macro customUnInstall
  Call un.bkValidateDirectory
  ${If} $bkDirectorySafe != "1"
    SetErrorLevel 2
    Quit
  ${EndIf}
  IfFileExists "$INSTDIR\.bookkeepai-install" +3
  SetErrorLevel 2
  Quit
  FileOpen $0 "$INSTDIR\.bookkeepai-install" r
  FileRead $0 $1
  FileClose $0
  ${If} $1 != "ai.bookkeep.desktop"
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend
