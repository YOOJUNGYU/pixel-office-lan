# Installing Pixel Office

> 한국어: [설치-안내.md](설치-안내.md)

Pixel Office shows the coding agents (Claude Code, Codex) of every PC on the same LAN as characters in one pixel office. **Install it once on each PC**: it starts automatically at login and finds the other PCs on the network by itself. Nothing else (such as Node) needs to be installed.

## 1. Download

Get the file for your PC from [GitHub Releases](https://github.com/YOOJUNGYU/pixel-office-lan/releases/latest).

| PC                                 | File                            |
| ---------------------------------- | ------------------------------- |
| Windows 10/11 (64-bit)             | `PixelOffice-<ver>-Windows.exe` |
| Mac (Apple silicon or Intel, both) | `PixelOffice-<ver>-Mac.pkg`     |

There is one Mac file for every Mac, so no need to check your chip.

## 2. Windows

1. Run `PixelOffice-<ver>-Windows.exe`.
2. If **"Windows protected your PC"** (SmartScreen) appears, click **More info** → **Run anyway**. The installer is not code-signed.
3. Approve the **User Account Control** prompt. Admin rights are used only to install into Program Files and add the Windows Firewall rule "Pixel Office".
4. On **Select Additional Tasks** both options are checked by default; untick what you don't want:
   - **Create a desktop shortcut**
   - **Start automatically at login** (registered in your own user's Startup folder; you can change it later in the office's **Settings**)
5. Finish the wizard; the office opens in your browser. Just pick a character and colour (a nickname is optional; you are shown by your PC account name).

## 3. Mac

1. Double-click the `.pkg`.
2. If it is blocked as from an **unidentified developer**, click OK, go to **System Settings → Privacy & Security**, click **Open Anyway**, and run the installer again (admin password).
3. When asked **Do you want the application "node" to accept incoming network connections?**, click **Allow** — otherwise other PCs cannot see your agents.
4. Open **Applications → Pixel Office** to open the office (`http://localhost:47801`).

It starts at every login (`~/Library/LaunchAgents/com.pixeloffice.agent.plist`, can be turned off in the office's **Settings**); the log is `~/Library/Logs/PixelOffice.log`.

## 4. How to open

- **Start at login**: runs in the background without a window. Turn it off or on in the office under **Settings → Start at login** (applies from the next login; the running office keeps running). Installing an update keeps your choice.
- **Tray icon · quitting**: while it runs, a Pixel Office icon sits in the Windows notification area (the tray; look under **^** if hidden) or the Mac menu bar. Click it (on Windows a left click opens the office) → **Open Pixel Office** / **Quit Pixel Office**. Quitting removes this PC from the other PCs too, and it stays off until the next login (if start at login is on) or until you open it again from the shortcut / app. No icon? **Settings → Quit Pixel Office** in the office does the same (an open window then says it was quit).
- **Updates**: checked at start and every 6 hours, and installed **silently** (no admin password, no installer window); the open window reloads itself into the new version and briefly shows "Updated to v1.0.2". Turn it off under **Settings → Automatic updates**. **Install the 1.0.0 installer once yourself**; after that only releases that change the Node runtime use the **Update** button (installer) at the top right. The release's `…-app.tgz` / `.sha256` files are for the auto-update — don't download them.
- **PC notifications**: when someone joins or leaves the public office, and when one of your own Claude/Codex agents is waiting for your answer or has finished, Windows/Mac shows a notification (also with the window closed, as long as the tray icon runs). Turn them off separately in **Settings → Join/leave notifications / My agents**. On Windows they show with the "Pixel Office" name and icon (an entry "Pixel Office" appears under Settings → System → Notifications). Windows or macOS may ask you to allow notifications the first time — allow them. On a Mac they may appear under "Script Editor" or "osascript" (enable that entry in System Settings → Notifications). With Windows Focus assist / Do not disturb on they only land in the notification center.
- **Open the office**
  - Windows: the **Pixel Office** desktop shortcut, or Start → **Pixel Office 열기**
  - Mac: **Pixel Office** in **Applications** or **Launchpad**. Following macOS convention there is no desktop alias (drag it to the Dock if you like).
  - On any PC: `http://localhost:47801` in that PC's browser (the UI opens on your own PC only; other PCs' browsers can't view it)
- On Windows a shortcut starts the office if needed and opens, in this order: **the installed Pixel Office app** (Edge, else Chrome) → a new Edge (or Chrome) window, where the install popup appears → the default browser. On a Mac it opens the default browser.
- The first time you open it, a short tour walks through every feature. Replay it any time from **Settings → Replay tour**.

### Install as an app (PWA)

Open the office in this PC's browser and an **Install Pixel Office as an app** popup appears top right.

- **Edge / Chrome**: **Install** → **Install** in the browser's dialog. From then on the Windows shortcuts and Start menu open a tab-less app window (a Mac opens the default browser). The install icon at the right of the address bar works too.
- **Safari**: **Share → Add to Dock** (Mac) / **Add to Home Screen** (iPhone, iPad)
- **Firefox**: can't install apps; open it in Edge or Chrome.
- **Later** hides it for 7 days. It never shows inside the app or after installing.
- To remove the app, uninstall Pixel Office from `edge://apps` (Edge) or `chrome://apps` (Chrome). Shortcuts then open a new Edge (or Chrome) window again.

## 4-1. Public office and team offices

- You start in the 🌐 **public office** with everyone on the network who installed the app. Nothing to set up; what PCs exchange is encrypted automatically (an X25519 key per PC, AES-256-GCM under a key per pair of PCs).
- 🔒 **Create a team office**: **Settings → Offices → Create a team office**, enter a team name, **Create** → **Copy code** of the invite code (`PO2-…`) and send it to your teammates.
- **Join**: paste it under **Settings → Offices → Join with a code** and press **Join**. Switch offices with the office buttons at the top of the screen.
- **While you are in any team office you leave the public office** (neither sending nor seeing). To return, **Leave** every office in **Your team offices**.
- Team office traffic is encrypted under a key derived from the invite code. If a code leaks, create a new team office and move.
- 🏠 **Personal**: press **Personal** in the office buttons at the top for a small office of your own that exchanges nothing with other PCs (no one sees you). Your team offices are kept: press **Public office** or a team button to return, no code needed. Personal mode has its own layout.
- Watching from another PC's browser without the app (remote viewing) was removed in v0.4.0. Install the app on that PC instead.
- Mixed versions after v0.4.x: a PC running many agents now sends its state in several small packets, which v0.4.x PCs do not understand, so such a PC is missing on a v0.4.x PC (a PC with few agents still shows). Update every PC.

## 5. Other PCs do not show up

- PCs on the same network appear automatically; no IP needs to be entered. They have to be on the **same network** (same router / subnet); guest Wi-Fi, VPN or other subnets may block discovery.
- Only for PCs on another floor or network: add the other PC's IP under **Settings → My profile → Advanced: when a PC isn't found automatically → PC IPs to connect directly** (one per line) and save. Listing it on one side is enough to see each other; listing it on both is more reliable.
- Make sure **both PCs run 0.2.0 or later**: 0.2.0 does not talk to the unencrypted 0.1.0.
- If either of you is in a **team office** or 🏠 **Personal** mode, you don't see each other in the public office. Join the same team office, or both leave your teams.
- Make sure UDP 47800 is not blocked (the Windows installer adds an inbound UDP 47800 rule; a Mac needs the "Allow" from step 3). TCP 47801 is used only inside your PC and needs no opening.
- If **corporate security software** (antivirus, EDR, AppLocker, company firewall) blocks it, ask IT for an exception rather than working around it: program `C:\Program Files\PixelOffice\node.exe` / `/Applications/Pixel Office.app`, port UDP 47800 (the only inbound one; the TCP 47801 UI stays on the PC), LAN only.

Other people's offices are **read-only**: nobody can run or change anything on your PC, or open your UI.

## 6. Uninstall

- **Windows**: Settings → Apps → Installed apps → **Pixel Office** → Uninstall (stops the office and removes the firewall rule, shortcuts and the start-at-login entry).
- **Mac**:

  ```bash
  curl -s -X POST http://127.0.0.1:47801/api/quit
  launchctl bootout gui/$(id -u)/com.pixeloffice.agent
  rm -f ~/Library/LaunchAgents/com.pixeloffice.agent.plist
  rm -f ~/.pixel-office/autostart-off   # the "start at login: off" record (if left, a reinstall keeps it off)
  sudo rm -rf "/Applications/Pixel Office.app"
  ```

Your settings and layout in `~/.pixel-office/` are kept (on Windows too: if you turned start at login off in Settings, that `autostart-off` record stays; ticking the checkbox in a new interactive install turns it back on); delete that folder to remove them too.
