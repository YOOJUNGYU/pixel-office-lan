# Installing Pixel Office

> 한국어: [설치-안내.md](설치-안내.md)

Pixel Office shows the coding agents (Claude Code, Codex) of every PC on the same LAN as characters in one pixel office. **Install it once on each PC**: it starts automatically at login and finds the other PCs on the network by itself. Nothing else (such as Node) needs to be installed.

## 1. Download

Get the file for your PC from [GitHub Releases](https://github.com/YOOJUNGYU/pixel-office-lan/releases/latest).

| PC                           | File                          |
| ---------------------------- | ----------------------------- |
| Windows 10/11 (64-bit)       | `PixelOffice-Setup-<ver>.exe` |
| Mac with Apple silicon (M1+) | `PixelOffice-<ver>-arm64.pkg` |
| Mac with Intel               | `PixelOffice-<ver>-x64.pkg`   |

## 2. Windows

1. Run `PixelOffice-Setup-<ver>.exe`.
2. If **"Windows protected your PC"** (SmartScreen) appears, click **More info** → **Run anyway**. The installer is not code-signed.
3. Approve the **User Account Control** prompt. Admin rights are used only to install into Program Files and add the Windows Firewall rule "Pixel Office".
4. On **Select Additional Tasks** both options are checked by default; untick what you don't want:
   - **Create a desktop shortcut**
   - **Start automatically at login** (registered in your own user's Startup folder; you can change it later in the office's **Settings**)
5. Finish the wizard; the office opens in your browser. Just pick a nickname, character and colour.

## 3. Mac

1. Double-click the `.pkg`.
2. If it is blocked as from an **unidentified developer**, click OK, go to **System Settings → Privacy & Security**, click **Open Anyway**, and run the installer again (admin password).
3. When asked **Do you want the application "node" to accept incoming network connections?**, click **Allow** — otherwise other PCs cannot see your agents.
4. Open **Applications → Pixel Office** to open the office (`http://localhost:47801`).

It starts at every login (`~/Library/LaunchAgents/com.pixeloffice.agent.plist`, can be turned off in the office's **Settings**); the log is `~/Library/Logs/PixelOffice.log`.

## 4. How to open

- **Start at login**: runs in the background without a window. Turn it off or on in the office under **Settings → Start at login** (applies from the next login; the running office keeps running). Installing an update keeps your choice.
- **Open the office**
  - Windows: the **Pixel Office** desktop shortcut, or Start → **Pixel Office 열기**
  - Mac: **Pixel Office** in **Applications** or **Launchpad**. Following macOS convention there is no desktop alias (drag it to the Dock if you like).
  - On any PC: `http://localhost:47801` in a browser
- If the office is already running a shortcut just reopens the browser; otherwise it starts it first.

## 5. Other PCs do not show up

- PCs on the same network appear automatically; no IP needs to be entered. They have to be on the **same network** (same router / subnet); guest Wi-Fi, VPN or other subnets may block discovery.
- Only for PCs on another floor or network: add the other PC's IP under **Settings → My profile → Advanced: when a PC isn't found automatically → PC IPs to connect directly** (one per line) and save. Doing it on both PCs is the most reliable.
- Make sure UDP 47800 and TCP 47801 are not blocked.
- If **corporate security software** (antivirus, EDR, AppLocker, company firewall) blocks it, ask IT for an exception rather than working around it: program `C:\Program Files\PixelOffice\node.exe` / `/Applications/Pixel Office.app`, ports UDP 47800 and TCP 47801, LAN only.

Other people's offices are **read-only**: nobody can run or change anything on your PC.

## 6. Uninstall

- **Windows**: Settings → Apps → Installed apps → **Pixel Office** → Uninstall (stops the office and removes the firewall rule, shortcuts and the start-at-login entry).
- **Mac**:

  ```bash
  curl -s -X POST http://127.0.0.1:47801/api/quit
  launchctl bootout gui/$(id -u)/com.pixeloffice.agent
  rm -f ~/Library/LaunchAgents/com.pixeloffice.agent.plist
  sudo rm -rf "/Applications/Pixel Office.app"
  ```

Your settings and layout in `~/.pixel-office/` are kept; delete that folder to remove them too.
