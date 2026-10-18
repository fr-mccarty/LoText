; The Windows installer, built on the Mac by scripts/make-windows.sh with Homebrew's makensis.
;
; Per user, with no administrator prompt: the app goes to %LOCALAPPDATA%\Programs\LoText, the
; place Windows itself suggests for an app installed by the person who runs it, and every
; registry key is under HKCU. The uninstaller is written by the installer as it runs, on the
; Windows machine — which is why nothing here needs Wine to build.
;
; makensis is handed APP_NAME, VERSION, SOURCE (the staged app folder), ICON and OUT with -D.

Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel user

!include "MUI2.nsh"

!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}"
!define PROG_ID "${APP_NAME}.Document"

Name "${APP_NAME}"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\${APP_NAME}"
InstallDirRegKey HKCU "Software\${APP_NAME}" "InstallDir"
BrandingText "${APP_NAME} ${VERSION}"

!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_NAME}.exe"

!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APP_NAME}"
VIAddVersionKey "FileDescription" "${APP_NAME} Setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "CompanyName" "Lolek Productions, Inc."
VIAddVersionKey "LegalCopyright" "Josh McCarty"

; An update installs over a running copy otherwise, and Windows will not replace an open exe.
Function .onInit
  nsExec::Exec 'taskkill /IM "${APP_NAME}.exe" /F'
FunctionEnd

Section "Install"
  SetOutPath "$INSTDIR"
  ; Whatever an older version left that this one does not have would otherwise stay behind.
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  File /r "${SOURCE}\*.*"

  WriteUninstaller "$INSTDIR\Uninstall ${APP_NAME}.exe"
  CreateShortCut "$SMPROGRAMS\${APP_NAME}.lnk" "$INSTDIR\${APP_NAME}.exe"

  WriteRegStr HKCU "Software\${APP_NAME}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "Lolek Productions, Inc."
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\${APP_NAME}.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall ${APP_NAME}.exe"'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1

  ; Offered under Open with for plain text and markdown, the types the Mac app declares
  ; (packaging/document-types.plist). Offered, not taken: the default app is the user's choice.
  WriteRegStr HKCU "Software\Classes\${PROG_ID}" "" "Text Document"
  WriteRegStr HKCU "Software\Classes\${PROG_ID}\DefaultIcon" "" "$INSTDIR\${APP_NAME}.exe,0"
  WriteRegStr HKCU "Software\Classes\${PROG_ID}\shell\open\command" "" '"$INSTDIR\${APP_NAME}.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\.txt\OpenWithProgids" "${PROG_ID}" ""
  WriteRegStr HKCU "Software\Classes\.md\OpenWithProgids" "${PROG_ID}" ""
  WriteRegStr HKCU "Software\Classes\.markdown\OpenWithProgids" "${PROG_ID}" ""
  WriteRegStr HKCU "Software\Classes\.text\OpenWithProgids" "${PROG_ID}" ""
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /IM "${APP_NAME}.exe" /F'
  Delete "$SMPROGRAMS\${APP_NAME}.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  DeleteRegKey HKCU "Software\${APP_NAME}"
  DeleteRegKey HKCU "Software\Classes\${PROG_ID}"
  DeleteRegValue HKCU "Software\Classes\.txt\OpenWithProgids" "${PROG_ID}"
  DeleteRegValue HKCU "Software\Classes\.md\OpenWithProgids" "${PROG_ID}"
  DeleteRegValue HKCU "Software\Classes\.markdown\OpenWithProgids" "${PROG_ID}"
  DeleteRegValue HKCU "Software\Classes\.text\OpenWithProgids" "${PROG_ID}"
  ; The settings in %APPDATA%\LoText stay, as an uninstalled Mac app's do.
SectionEnd
