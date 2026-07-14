; Inno Setup script for LoL Scoreboard.
; Per-user install (no admin/UAC) so config.json next to the exe stays writable.
; Build: npm run installer   (compiles the exe first, then this)

#define AppName "LoL Scoreboard"
#define AppVersion "1.0.0"
#define AppExe "LoL-Scoreboard.exe"

[Setup]
AppId={{7E1B2C6A-9D4F-4B7A-8C3E-5A0F6D2E8B11}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=scoreboard-lol
DefaultDirName={localappdata}\Programs\{#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=dist
OutputBaseFilename=LoL-Scoreboard-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\{#AppExe}
SetupIconFile=assets\icon.ico

[Files]
Source: "dist\{#AppExe}"; DestDir: "{app}"; Flags: ignoreversion
Source: "dist\LoL-Scoreboard-Panel.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "dist\Microsoft.Web.WebView2.Core.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "dist\Microsoft.Web.WebView2.WinForms.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "dist\WebView2Loader.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "dist\HudReader.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "dist\beaufort-bold.ttf"; DestDir: "{app}"; Flags: ignoreversion
Source: "dist\spiegel-bold.ttf"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{userprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{userprograms}\{#AppName} (Test Mode)"; Filename: "{app}\{#AppExe}"; Parameters: "--mock"
Name: "{userdesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional shortcuts:"

[Run]
Filename: "{app}\{#AppExe}"; Description: "Launch {#AppName} now"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; created at runtime next to the exe
Type: files; Name: "{app}\config.json"
Type: files; Name: "{app}\scoreboard.log"
