<h1 align="center">Pixel Office LAN</h1>

<p align="center">
  <a href="README.md">한국어</a> · <b>English</b>
</p>

<p align="center">
  Everyone's AI coding agents on the same LAN,<br>
  together in <b>one pixel-art office</b>.
</p>

<p align="center">
  <a href="https://github.com/YOOJUNGYU/pixel-office-lan/releases/latest"><b>⬇️ Download</b></a> ·
  <a href="docs/INSTALL.en.md">Install guide</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#development">Development</a>
</p>

![The whole office](docs/images/office-en.png)

See at a glance who is doing what, with which agent (Claude Code / Codex). Install it and it finds the other PCs on the network **with no server**; everyone's agents meet in one office.

> A fork of [pixel-agents](https://github.com/pixel-agents-hq/pixel-agents) (MIT). The original shows the Claude Code agents of your own PC; this fork adds LAN sharing, Codex and installers, and drops agent launching, the terminal and the VS Code extension. It only watches: agents keep running in the CLI or desktop app you already use.

## Install

1. Download from [Releases](https://github.com/YOOJUNGYU/pixel-office-lan/releases/latest): Windows `PixelOffice-<version>-Windows.exe`, Mac (Apple silicon · Intel) `PixelOffice-<version>-Mac.pkg`. Node is bundled; nothing else to install.
2. The installers are not code-signed, so you get a warning.
   - **Windows**: "Windows protected your PC" → **More info** → **Run anyway** → User Account Control **Yes**
   - **Mac**: if blocked, **System Settings → Privacy & Security → Open Anyway**; if the firewall is on, "Allow incoming connections"
3. When the office opens in your browser, pick a character and colour (nickname optional). A short tour follows.

- It starts at login (**Settings → Start at login**). To quit: tray icon → **Quit Pixel Office**, or **Settings → Quit Pixel Office**.
- Reopen: tray → **Open Pixel Office**, the Windows desktop / Start menu shortcut, Mac **Applications**, or `http://localhost:47801`.
- Updates are automatic (see [More](#more)).

PCs not showing up, uninstalling: see the **[install guide](docs/INSTALL.en.md)**. If company security software blocks it, ask IT for an exception.

## Using it

### Room = activity

Once an activity lasts 3 seconds, the agent walks to its room and sits on a free seat. Hover a room plate for its description; the number counts main agents, `+N` subagents and shells.

| Room           | Activity                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------ |
| 🖥️ Coding Room | Editing files (Claude `Edit`/`Write`, Codex `apply_patch`)                                       |
| 📚 Library     | Reading files, searching code or the web (incl. Codex read commands like `rg`, `cat`, `git log`) |
| 🗄️ Server Room | Running commands (`Bash`, Codex shell), background shells                                        |
| 🛋️ Lounge      | Waiting for input or approval, turn finished                                                     |

- **Name tags**: top line the nickname (else the PC account), bottom line `Claude #1` / `Codex #1` + a **MAIN** / **SUB** / **SHELL** badge. Hidden until you hover; **Show agent name tags** at the top left keeps them on. People's own characters always show their tag, in the colours each person picks in their profile (yours with a yellow frame).
- **Bubble**: hover a character to see which file it edits and why, what it searches or runs. A **red !** overhead = waiting for you.
- **Subagents and shells** hold their parent's hand in the same room, and work on their own in another.
- **Map**: drag to pan, wheel to zoom (or + / − at the top left).

![Hover bubble](docs/images/hover-en.png)

### Offices (switcher at the top)

Each tab shows how many people are online there (you included; in personal mode, everyone but you).

- 🌐 **Public office** (default): everyone on the network who installed the app.
- 🔒 **Team office**: only people with the invite code (`PO2-…`). **Settings → Offices**: create (copy the code and send it), join with a code, leave. ⚠️ While you are in any team office you are **out of the public office entirely** (you neither see it nor show up in it).
- 🏠 **Personal**: a small office of your own that sends nothing to other PCs; it only listens, to count who is online. Team memberships are kept, so you go back without a code.

### Your character and chat

- Besides agents, every person has one character. Walk with the **arrow keys** (walls and furniture block); the spot is remembered across restarts.
- Type in the **chat bar** at the bottom centre and press **Enter** → a bubble over your character. One per person: a new one replaces it, **×** deletes it. No history. 100 characters, one per 2 seconds.
- Shortcuts: with nothing selected, **Space+Enter** = chat bar; **Esc** in the chat bar = back to the arrow keys.

### People panel and PC notifications

- **People panel** on the right: everyone in this office (with or without agents). Click a name to jump to their agents.
- **PC notifications** (Windows · Mac; they arrive with the window closed as long as the tray icon runs; each can be turned off in Settings):
  - **Join/leave**: someone enters or leaves the public office.
  - **My agents**: my Claude · Codex is waiting for me or finished (with the session title and project folder, on this PC only).

### More

- **Profile**: character (6 humans or the pets Claudio · Gitcat), colour, nickname, your character's name tag colours. Your PC account name always comes first and cannot be changed. Nicknames are unique (whoever set it later gets a mark like `· a1b2`).
- **Language · theme**: 한국어/English and dark/light/system, per viewer. The sun/moon button at the top left switches instantly.
- **Layout editor**: floors (one click paints a whole room), walls, furniture, the background outside. The four rooms and the office size (90×60) are fixed. Layouts are saved **on this PC only**; share with **Settings → Export / Import layout**.
- **Install as an app (PWA)**: in Edge · Chrome, the popup at the top right → a tab-less app window. Opening the app while the server is off shows **[Start]**.
- **Automatic updates**: checked at start and every 6 hours, downloaded silently and restarted into; open windows reload into the new version. A version that fails to start is rolled back. Only releases that change Node need the installer (the **Update** button at the top right). Turn off: **Settings → Automatic updates**.
- **Replay tour**: in Settings.

## Security and privacy

- PCs exchange **status only** (read-only). Nobody can reach your terminal, agents or settings, and the UI opens only in this PC's browser.
- Everything between PCs is **encrypted**: the public office uses a per-pair X25519 key agreement + AES-256-GCM, a team office AES-256-GCM with a key derived from its invite code. Codes never go on the network; a known PC whose key changes is ignored (impersonation).
- **Always**: file paths, user names, IPs/host names, URL paths, token-like strings and AI reply text never leave the PC; commands are sent as program names only. Your PC account name is the name tag, so it is always shown.
- **Hide my work** (off by default): others see only which room each of your agents is in, which AI it is and its kind (MAIN/SUB/SHELL), not what it is doing.
- Claude Code and Codex settings are never touched; only their transcript files are read.

## How it works

```
 [My PC]                                         [Colleague's PC]
 Claude / Codex transcripts ─▶ reporter ─┐    ┌─ reporter ◀─ transcripts
  (~/.claude, ~/.codex, WSL)             │ enc │
                                         ├◀───▶┤   UDP status every second (no server)
 browser ◀── WebSocket ── local server ◀─┘    └▶ local server ── WebSocket ──▶ browser
 (app window) http://localhost:47801                 http://localhost:47801 (app window)
```

- The reporter reads sessions changed in the last 30 minutes under `~/.claude/projects` and `~/.codex/sessions` (on Windows also those of running WSL distros). A closed Claude session leaves within seconds (after 30 minutes when its process can't be checked); a finished Codex session after 10 minutes.
- A PC silent for 5 seconds disappears. Layouts are never sent over the network.
- Data lives only in `~/.pixel-office/` (files with keys and codes are 0600).

| Port      | Purpose                                      |
| --------- | -------------------------------------------- |
| UDP 47800 | Status between PCs (broadcast + IPs you add) |
| TCP 47801 | Browser UI (`127.0.0.1` only)                |

## Known limits

- Broadcasts stay inside one subnet. Across floors or VLANs, add the other PC's IP under **Settings → My profile → Advanced: when a PC isn't found automatically**.
- The public office can't keep out anyone who installs the app. Use a team office to choose who joins.
- Codex doesn't record approval requests, so ❗ appears for Codex only when it asks you a question.
- The redaction may miss a password typed directly into a command or search.
- Mixed versions hide things from older PCs (0.4.x: PCs with very many agents, pets; ≤ 1.0.0: people's characters and chat). Update everyone.
- Mac notifications may appear as "Script Editor". Linux and WSL have no tray or notifications.

## Development

```bash
npm install
npm run build              # dist/ — cli.js bundles its dependencies (runs without node_modules)
node dist/cli.js --open    # http://localhost:47801
npm test                   # server + webview (Vitest)
npm run check-types && npm run lint
```

- Structure and rules: [CLAUDE.md](CLAUDE.md). Design and plan: [docs/superpowers/](docs/superpowers/).
- **Release**: bump `version` in `package.json` and push a `v<version>` tag; GitHub Actions builds the Windows and Mac installers and the auto-update bundle into a Release. A tag with `-` is a prerelease; a full release deletes the older ones.

## Credits

- Original: [pixel-agents](https://github.com/pixel-agents-hq/pixel-agents) (MIT). The office engine, layout editor and furniture assets come from it.
- Characters: [JIK-A-4, Metro City](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack)
- Font: [Pretendard](https://github.com/orioncactus/pretendard) (SIL OFL 1.1)

<p align="center">
  <img src="webview-ui/public/characters.png" alt="Characters" width="320" height="72" style="image-rendering: pixelated;">
</p>

## License

[MIT](LICENSE). The original pixel-agents copyright notice is kept.
