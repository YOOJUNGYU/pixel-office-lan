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
4. Finish the wizard; the office opens in your browser.

It then starts at every login without a window. Reopen it from Start → **Pixel Office 열기** or `http://localhost:47801`.

## 3. Mac

1. Double-click the `.pkg`.
2. If it is blocked as from an **unidentified developer**, click OK, go to **System Settings → Privacy & Security**, click **Open Anyway**, and run the installer again (admin password).
3. When asked **Do you want the application "node" to accept incoming network connections?**, click **Allow** — otherwise other PCs cannot see your agents.
4. Open **Applications → Pixel Office** to open the office (`http://localhost:47801`).

It starts at every login (`~/Library/LaunchAgents/com.pixeloffice.agent.plist`); the log is `~/Library/Logs/PixelOffice.log`.

## 4. Other PCs do not show up

- PCs find each other automatically only on the **same network** (same router / subnet). Guest Wi-Fi, VPN or other subnets may block discovery.
- Then add the other PC's IP under **Settings → My profile → PC IPs to connect directly** (one per line) and save. Doing it on both PCs is the most reliable.
- Make sure UDP 47800 and TCP 47801 are not blocked.
- If **corporate security software** (antivirus, EDR, AppLocker, company firewall) blocks it, ask IT for an exception rather than working around it: program `C:\Program Files\PixelOffice\node.exe` / `/Applications/Pixel Office.app`, ports UDP 47800 and TCP 47801, LAN only.

Other people's offices are **read-only**: nobody can run or change anything on your PC.

## 5. Uninstall

- **Windows**: Settings → Apps → Installed apps → **Pixel Office** → Uninstall (stops the office and removes the firewall rule).
- **Mac**:

  ```bash
  curl -s -X POST http://127.0.0.1:47801/api/quit
  launchctl bootout gui/$(id -u)/com.pixeloffice.agent
  rm ~/Library/LaunchAgents/com.pixeloffice.agent.plist
  sudo rm -rf "/Applications/Pixel Office.app"
  ```

Your settings and layout in `~/.pixel-office/` are kept; delete that folder to remove them too.
