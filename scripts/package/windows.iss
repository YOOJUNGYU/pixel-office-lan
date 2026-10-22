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
UninstallDisplayIcon={app}\icon.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
korean.DesktopIcon=바탕화면에 바로가기 만들기
english.DesktopIcon=Create a desktop shortcut
korean.Autostart=로그인할 때 자동으로 실행
english.Autostart=Start automatically at login
korean.OpenOffice=Pixel Office 열기
english.OpenOffice=Open Pixel Office

[Tasks]
Name: "desktopicon"; Description: "{cm:DesktopIcon}"
Name: "autostart"; Description: "{cm:Autostart}"

[Files]
Source: "{#Stage}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Pixel Office 열기"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\launch.vbs"" --open"; WorkingDir: "{app}"; IconFilename: "{app}\icon.ico"
Name: "{autodesktop}\Pixel Office"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\launch.vbs"" --open"; WorkingDir: "{app}"; IconFilename: "{app}\icon.ico"; Tasks: desktopicon
; Start at login is per user (Startup folder), so the app can toggle it later without admin
; rights. It is written by the app itself (cli.js --autostart), run as the ORIGINAL user below:
; {userstartup} here would be the elevated account's folder when a standard user typed admin
; credentials. Uninstall sweeps every profile (DeleteStartupLinks in [Code]).

[InstallDelete]
; Older versions started the office for all users from the common Startup folder.
Type: files; Name: "{commonstartup}\Pixel Office.lnk"

[Run]
; Replace (not duplicate) the rule on reinstall/upgrade. Inbound UDP 47800 (peers) only: the UI (HTTP 47801) is this PC only.
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Pixel Office"""; Flags: runhidden
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""Pixel Office"" dir=in action=allow program=""{app}\node.exe"" protocol=UDP localport=47800 enable=yes profile=any"; Flags: runhidden
; Start at login for the installing (original, non-elevated) user. An interactive install applies
; the checkbox as given. A silent update (in-app Update) ignores the remembered checkbox (Settings
; may have changed it since) and runs "default": on unless the user turned it off in Settings.
Filename: "{app}\node.exe"; Parameters: """{app}\app\cli.js"" --autostart on"; Tasks: autostart; Check: not WizardSilent; Flags: runhidden runasoriginaluser waituntilterminated
Filename: "{app}\node.exe"; Parameters: """{app}\app\cli.js"" --autostart off"; Tasks: not autostart; Check: not WizardSilent; Flags: runhidden runasoriginaluser waituntilterminated
Filename: "{app}\node.exe"; Parameters: """{app}\app\cli.js"" --autostart default"; Check: WizardSilent; Flags: runhidden runasoriginaluser waituntilterminated
; postinstall entries run as the original (non-elevated) user, so ~\.pixel-office lands in their home.
Filename: "{sys}\wscript.exe"; Parameters: """{app}\launch.vbs"" --open"; Description: "{cm:OpenOffice}"; Flags: postinstall nowait

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

{ Start at login lives in each user's own Startup folder, written by the app. The uninstaller runs
  elevated (possibly as another account), so sweep every profile for exactly our shortcut name;
  a leftover would make wscript complain about the missing launch.vbs at every login. }
procedure DeleteStartupLinks;
var
  Root, Link: String;
  F: TFindRec;
begin
  Root := ExtractFileDir(GetEnv('PUBLIC'));
  if Root = '' then
    Root := ExpandConstant('{sd}\Users');
  if FindFirst(Root + '\*', F) then
  try
    repeat
      if ((F.Attributes and FILE_ATTRIBUTE_DIRECTORY) <> 0) and (F.Name <> '.') and (F.Name <> '..') then
      begin
        Link := Root + '\' + F.Name + '\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\Pixel Office.lnk';
        if FileExists(Link) then
          DeleteFile(Link);
      end;
    until not FindNext(F);
  finally
    FindClose(F);
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
    QuitRunningOffice;
  if CurUninstallStep = usPostUninstall then
    DeleteStartupLinks;
end;
