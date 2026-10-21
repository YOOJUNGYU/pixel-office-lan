; Pixel Office — Windows installer (Inno Setup 6).
; Build: iscc /DAppVersion=<ver> /DStage=<dir with node.exe, launch.vbs, app\> scripts\package\windows.iss
; Output: release\PixelOffice-Setup-<ver>.exe

#ifndef AppVersion
  #error Pass /DAppVersion=<version>
#endif
#ifndef Stage
  #define Stage "..\..\build\win"
#endif

[Setup]
AppId={{6C1F3B0E-8D7A-4B52-9E0A-5F2C7D4A9B31}
AppName=Pixel Office
AppVersion={#AppVersion}
AppPublisher=YOOJUNGYU
AppPublisherURL=https://github.com/YOOJUNGYU/pixel-office-lan
AppSupportURL=https://github.com/YOOJUNGYU/pixel-office-lan/issues
DefaultDirName={autopf}\PixelOffice
DefaultGroupName=Pixel Office
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\..\release
OutputBaseFilename=PixelOffice-Setup-{#AppVersion}
UninstallDisplayName=Pixel Office
UninstallDisplayIcon={app}\node.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "{#Stage}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Pixel Office 열기"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\launch.vbs"" --open"; WorkingDir: "{app}"
Name: "{commonstartup}\Pixel Office"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\launch.vbs"""; WorkingDir: "{app}"

[Run]
; Replace (not duplicate) the rule on reinstall/upgrade.
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Pixel Office"""; Flags: runhidden
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""Pixel Office"" dir=in action=allow program=""{app}\node.exe"" enable=yes profile=any"; Flags: runhidden
; postinstall entries run as the original (non-elevated) user, so ~\.pixel-office lands in their home.
Filename: "{sys}\wscript.exe"; Parameters: """{app}\launch.vbs"" --open"; Description: "Pixel Office 열기"; Flags: postinstall nowait

[UninstallRun]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Pixel Office"""; Flags: runhidden; RunOnceId: "DelFirewallRule"

[Code]
{ Ask a running office to exit (POST /api/quit, loopback only) so node.exe is not locked. Errors are ignored. }
procedure QuitRunningOffice;
var
  Code: Integer;
begin
  Exec('powershell.exe',
    '-NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing -Method Post -Uri http://127.0.0.1:47801/api/quit -TimeoutSec 3 | Out-Null; Start-Sleep -Seconds 2 } catch {}"',
    '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  QuitRunningOffice;
  Result := '';
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
    QuitRunningOffice;
end;
