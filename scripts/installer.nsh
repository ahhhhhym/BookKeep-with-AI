; Never install into user data, an ancestor/child of it, or a redirected directory.
!include LogicLib.nsh
!include FileFunc.nsh
!include "${PROJECT_DIR}\scripts\installer-path.nsh"

!ifndef BUILD_UNINSTALLER
  ; Root selections are normalized before any installation or ownership checks.
  AllowRootDirInstall true
!endif

Var bkDirectorySafe
!ifndef BUILD_UNINSTALLER
  Var bkDesktopOption
  Var bkStartMenuOption
  Var bkDesktopCheckbox
  Var bkStartMenuCheckbox
  Var bkPathPreview
!endif

!include "${PROJECT_DIR}\scripts\installer-directory.nsh"

!macro customHeader
  BrandingText "BookKeepAI  |  本地记账 · 逐笔确认"
  SetFont "Microsoft YaHei UI" 9
  !ifdef BUILD_UNINSTALLER
    !insertmacro bkDirectoryFunction "un."
  !else
    !insertmacro bkDirectoryFunction ""
    Function bkOptionsPage
      Call bkNormalizeInstallDirectory
      !insertmacro MUI_HEADER_TEXT "确认安装选项" "确认程序位置，再选择需要的快捷方式。"
      nsDialogs::Create 1018
      Pop $0
      ${If} $0 == error
        Abort
      ${EndIf}
      ${NSD_CreateLabel} 0 0 100% 12u "程序将安装到"
      Pop $0
      ${NSD_CreateText} 0 16u 100% 26u "$INSTDIR"
      Pop $bkPathPreview
      SendMessage $bkPathPreview ${EM_SETREADONLY} 1 0
      SetCtlColors $bkPathPreview "163B96" "F3F6FC"
      ${NSD_CreateCheckbox} 0 54u 100% 14u "创建桌面快捷方式"
      Pop $bkDesktopCheckbox
      ${NSD_SetState} $bkDesktopCheckbox $bkDesktopOption
      ${NSD_CreateCheckbox} 0 77u 100% 14u "创建开始菜单快捷方式"
      Pop $bkStartMenuCheckbox
      ${NSD_SetState} $bkStartMenuCheckbox $bkStartMenuOption
      ${NSD_CreateLabel} 0 107u 100% 26u "程序文件夹会自动创建。账本与程序分开保存，卸载时保留。"
      Pop $0
      SetCtlColors $0 "64748B" "FFFFFF"
      nsDialogs::Show
    FunctionEnd

    Function bkInstFilesPre
      ; The confirmation page already shows the selected final directory.
      ; The upstream hook only adjusts INSTDIR; preserve our explicit final selection.
      Call bkNormalizeInstallDirectory
      Push $INSTDIR
      Call instFilesPre
      Pop $INSTDIR
    FunctionEnd

    Function bkOptionsLeave
      ${NSD_GetState} $bkDesktopCheckbox $bkDesktopOption
      ${NSD_GetState} $bkStartMenuCheckbox $bkStartMenuOption
    FunctionEnd

    Function .onVerifyInstDir
      Call bkNormalizeInstallDirectory
      Call bkValidateDirectory
      ${If} $bkDirectorySafe != "1"
        Abort
      ${EndIf}
    FunctionEnd

    ; Runs before the normal installation section, including silent /D installs.
    Section "-BookKeep directory protection"
      Call bkNormalizeInstallDirectory
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
  StrCpy $bkDesktopOption 1
  StrCpy $bkStartMenuOption 1
  Call bkNormalizeInstallDirectory
!macroend

!macro customPageAfterChangeDir
  !ifdef MUI_PAGE_CUSTOMFUNCTION_PRE
    !undef MUI_PAGE_CUSTOMFUNCTION_PRE
  !endif
  !define MUI_PAGE_CUSTOMFUNCTION_PRE bkInstFilesPre
  Page custom bkOptionsPage bkOptionsLeave
!macroend

!macro customInstallMode
  !insertmacro setInstallModePerUser
  Abort
!macroend

!macro customInstall
  FileOpen $0 "$INSTDIR\.bookkeepai-install" w
  FileWrite $0 "ai.bookkeep.desktop"
  FileClose $0
  ${If} $bkDesktopOption != 1
    Delete "$newDesktopLink"
  ${EndIf}
  ${If} $bkStartMenuOption != 1
    Delete "$newStartMenuLink"
  ${EndIf}
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

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "欢迎安装 BookKeepAI"
  !define MUI_WELCOMEPAGE_TEXT "让每一笔支出清楚可查。$\r$\n$\r$\n本地账本、图片整理与 AI 辅助记账，帮你把消费记录得更清晰。$\r$\n$\r$\n接下来可以选择程序位置和快捷方式。选择任意盘符根目录时，安装器会自动创建 BookKeepAI 文件夹。$\r$\n$\r$\n点击“下一步”继续。"
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customFinishPage
  !define MUI_FINISHPAGE_TITLE "BookKeepAI 已准备就绪"
  !define MUI_FINISHPAGE_TEXT "安装已完成。$\r$\n$\r$\n程序位置：$\r$\n$INSTDIR$\r$\n$\r$\n账本保存在当前用户的本机数据目录，卸载时保留。点击“完成”关闭向导，再从快捷方式或程序目录启动。"
  !insertmacro MUI_PAGE_FINISH
!macroend
