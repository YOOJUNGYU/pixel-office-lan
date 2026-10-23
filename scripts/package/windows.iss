; Pixel Office — Windows installer (Inno Setup 6).
; Build: iscc /DAppVersion=<ver> /DStage=<dir with node.exe, PixelOfficeTray.exe, launch.vbs, app\> scripts\package\windows.iss
; PixelOfficeTray.exe (tray, notifications, Startup .lnk) lives here, not in app\: silent updates
; replace app\ only, so a change to the helper needs an installer release.
; Output: release\PixelOffice-<ver>-Windows.exe

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
OutputBaseFilename=PixelOffice-{#AppVersion}-Windows
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
korean.DeleteUserData=설정·레이아웃·사무실 정보까지 모두 삭제할까요?%n%n(%1)%n%n[아니요]를 누르면 남겨 두어 다시 설치했을 때 그대로 이어서 쓸 수 있습니다.
english.DeleteUserData=Also delete your settings, layouts and office info?%n%n(%1)%n%nChoose No to keep them for a later reinstall.

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

[Registry]
; pixeloffice: URL scheme for the page's [시작] button (shown when the server is off, e.g. the
; installed PWA opened alone). The browser asks once "Open Pixel Office?". The command is FIXED
; and never gets the URL (no %1): launch.vbs forwards its arguments to cli.js, so passing the URL
; would let any website add CLI flags. No --open: the page that asked reloads itself.
; HKA = HKLM\Software\Classes here (admin install), i.e. every user; removed on uninstall.
; server/__tests__/installer.test.ts checks the command.
Root: HKA; Subkey: "Software\Classes\pixeloffice"; ValueType: string; ValueName: ""; ValueData: "URL:Pixel Office"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\pixeloffice"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKA; Subkey: "Software\Classes\pixeloffice\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: """{app}\icon.ico"",0"
Root: HKA; Subkey: "Software\Classes\pixeloffice\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{sys}\wscript.exe"" ""{app}\launch.vbs"""

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
; Interactive install: the finish page's "open" checkbox. Silent (in-app Update): start the server
; only, without --open: a window that was open reloads itself into the new version, and the
; app's reopen marker (~\.pixel-office\updates\reopen) opens one only if none was open.
Filename: "{sys}\wscript.exe"; Parameters: """{app}\launch.vbs"" --open"; Description: "{cm:OpenOffice}"; Flags: postinstall nowait skipifsilent
Filename: "{sys}\wscript.exe"; Parameters: """{app}\launch.vbs"""; Check: WizardSilent; Flags: postinstall nowait

[UninstallDelete]
; Everything left in the install folder (files written after install) and the folder itself.
Type: filesandordirs; Name: "{app}"

[UninstallRun]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Pixel Office"""; Flags: runhidden; RunOnceId: "DelFirewallRule"

[Code]
{ Ask a running office to exit (POST /api/quit, loopback only) so node.exe is not locked. Errors are
  ignored (first install: no node.exe yet). Uses the installed node.exe, never PowerShell: endpoint AV
  (Kaspersky PDM) flags hidden PowerShell started around our files. }
procedure QuitRunningOffice;
var
  Code: Integer;
begin
  Exec(ExpandConstant('{app}\node.exe'),
    '-e "fetch(''http://127.0.0.1:47801/api/quit'',{method:''POST'',signal:AbortSignal.timeout(3000)}).then(()=>new Promise(r=>setTimeout(r,2000)),()=>{})"',
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

{ Uninstall: quit the office, then make sure the tray helper (it exits ~1 s after the server pid is
  gone) is not left holding PixelOfficeTray.exe: a locked exe keeps the install folder. taskkill by
  OUR image name only (never node.exe: other Node apps share that name). }
procedure StopOfficeForUninstall;
var
  Code: Integer;
begin
  QuitRunningOffice;
  Sleep(1500);
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM PixelOfficeTray.exe', '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

{ User data (~\.pixel-office: keys, layouts, staged updates) only on an explicit Yes (default No), never
  in a silent uninstall. The uninstaller runs elevated: {%USERPROFILE} is the account that runs it,
  i.e. the user's own folder unless another admin account typed its credentials. }
procedure AskDeleteUserData;
var
  Dir: String;
begin
  Dir := ExpandConstant('{%USERPROFILE}\.pixel-office');
  if UninstallSilent or not DirExists(Dir) then
    exit;
  if MsgBox(FmtMessage(CustomMessage('DeleteUserData'), [Dir]), mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
    DelTree(Dir, True, True, True);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
    StopOfficeForUninstall;
  if CurUninstallStep = usPostUninstall then
  begin
    DeleteStartupLinks;
    AskDeleteUserData;
  end;
end;
