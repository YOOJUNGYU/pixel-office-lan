<h1 align="center">Pixel Office LAN</h1>

<p align="center">
  <a href="README.md">한국어</a> · <b>English</b>
</p>

<p align="center">
  See the AI coding agents of everyone on your local network (LAN)<br>
  together in <b>one pixel-art office</b>.
</p>

<p align="center">
  <a href="https://github.com/YOOJUNGYU/pixel-office-lan/releases/latest"><b>⬇️ Download</b></a> ·
  <a href="docs/INSTALL.en.md">Install guide</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#development">Development</a>
</p>

![The whole office](docs/images/office-en.png)

At a glance you see who (nickname), with which agent (Claude Code / Codex), in which room, is doing what. Install it from a single installer and it finds the other PCs on the same network by itself, **with no server**; everyone's agents meet in one office.

> A fork of [pixel-agents](https://github.com/pixel-agents-hq/pixel-agents) (MIT) with LAN sharing added. The original shows only the agents on your own PC.

## Features

### Agents move between rooms by what they do

When an agent switches activity, its character walks to the matching room. So that agents switching tools every few seconds don't make the screen hectic, a character only moves once the same activity has lasted 3 seconds.

| Room           | Activity                                                   |
| -------------- | ---------------------------------------------------------- |
| 🖥️ Coding Room | Editing files (Claude `Edit`/`Write`, Codex `apply_patch`) |
| 📚 Library     | Reading files, searching code, web search / viewing pages  |
| 🗄️ Server Room | Running commands (`Bash`, Codex shell)                     |
| 🛋️ Lounge      | Waiting for input or an answer, turn finished              |

### Name tags and hover bubbles

- Every character carries a tag: `nickname · Claude #1` / `nickname · Codex #1`.
- Hover a character to see **what it is doing right now**: which file it is editing and why, what it is searching for, which command it runs.
- A ❗ appears above an agent that is waiting for a person.

![Hover bubble](docs/images/hover-en.png)

### Subagents and shells hold hands

- **Subagents** and **background shells** running inside a session get their own characters.
- In the **same room** as their parent they walk in a line holding the parent's hand.
- In a **different room**, a **translucent ghost** of the parent appears there and leads the line from the left. The real parent stays in its own room.

### Serverless LAN sharing

- Every installed PC announces its agents' state to the network once a second and collects everyone else's to draw the office.
- **There is no server.** When someone shuts down their PC, only their characters disappear after a few seconds; everyone else is unaffected.
- PCs on the same network appear automatically, no IP needed. Only when they can't (different floors or VLANs), add the other PC's IP under **Settings → My profile → Advanced: when a PC isn't found automatically**.
- People without the app can **watch** by opening `http://<IP>:47801` of any PC that has it.

### Security and privacy

- Only **read-only state** is shared. Nobody can reach your terminals, run your agents, or change your settings; write actions are accepted only from the browser on your own PC.
- **Hide details** (on by default): file paths, user names, IPs and hostnames, URL paths, and token- or password-like strings **never leave your PC**. Commands are sent as the program name only (or Claude's own description). Your own screen still shows your agents verbatim.
- Claude Code and Codex settings are **never modified**; the app only reads the transcript files these tools already write.

### And more

- 👤 **Profile**: on first run pick a nickname, a character (6 kinds) and a color (8 swatches + slider). Skin tone stays; clothes and hair change color.
- 🌐 **한국어 / English**: each viewer chooses (Settings → Language). Text the agent wrote itself (reasons, file names, commands) is shown as-is.
- 🖱️ **Map controls**: drag an empty spot to pan; the mouse wheel (or trackpad pinch) zooms smoothly around the cursor.
- 🔄 **Updates**: when a new version is published on GitHub Releases, an **Update** button appears; it downloads and runs the installer.
- 🏗️ **Layout editor** (from the original): paint floors and walls, place furniture, define rooms (Areas). The **Background** tab fills the area around the office with a solid colour, a floor pattern or a carpet.

## Supported environments

|               | Supported                                                                       |
| ------------- | ------------------------------------------------------------------------------- |
| OS            | Windows 10/11 (64-bit), macOS (Apple silicon, Intel)                            |
| Agents        | Claude Code: Windows native · WSL · Mac / Codex CLI: Windows native · WSL · Mac |
| Prerequisites | None. The Node.js runtime ships inside the installer.                           |

Claude Code and Codex running inside WSL are read by the Windows app; there is nothing to install inside WSL. Only running WSL distributions are read, so an idle WSL is never woken up.

## Install

1. Download the file for your PC from [Releases](https://github.com/YOOJUNGYU/pixel-office-lan/releases/latest).

   | PC                  | File                              |
   | ------------------- | --------------------------------- |
   | Windows             | `PixelOffice-Setup-<version>.exe` |
   | Mac (Apple silicon) | `PixelOffice-<version>-arm64.pkg` |
   | Mac (Intel)         | `PixelOffice-<version>-x64.pkg`   |

2. Run it. It is a free project without code signing, so you will see a warning:
   - **Windows**: "Windows protected your PC" → **More info** → **Run anyway**, then User Account Control → **Yes**
   - **Mac**: if blocked, **System Settings → Privacy & Security → Open Anyway**; if the firewall is on, "Allow incoming connections"
3. The office opens in your browser; choose a nickname, a character and a colour.

### How to open

- **Start at login** — on by default. On Windows you can untick it in the installer; anytime, toggle **Settings → Start at login**.
- **Windows**: the **Pixel Office** desktop shortcut ("Create a desktop shortcut" in the installer) or Start → **Pixel Office 열기**
- **Mac**: **Pixel Office** in **Applications** or **Launchpad** (no desktop alias, following macOS convention)
- Anywhere: `http://localhost:47801` in a browser

Details, what to do when other PCs don't show up, and how to uninstall: **[Install guide](docs/INSTALL.en.md)**.

> If corporate security software (EDR, AppLocker, …) blocks it, ask your IT team for an exception.

## How it works

```
 [My PC]                                          [Teammate's PC]
 Claude / Codex transcripts ─▶ reporter ─┐     ┌─ reporter ◀─ transcripts
  (~/.claude, ~/.codex, WSL)              │ UDP │
                                          ├◀───▶┤   state every second (no server)
 browser ◀── WebSocket ── local server ◀──┘     └▶ local server ── WebSocket ──▶ browser
         http://localhost:47801                          http://localhost:47801
```

- The **reporter** reads sessions changed in the last 30 minutes under `~/.claude/projects` and `~/.codex/sessions` (and the same places in running WSL distributions).
- It turns each line into `{room, act, target, reason}`, applies the hide rules, and announces it on UDP port **47800**.
- The **local server** (HTTP **47801**) merges your state with what it received and streams it to the browser, which renders sentences in the viewer's language.
- A PC that has been silent for 5 seconds disappears from the office.

| Port      | Purpose                                                     |
| --------- | ----------------------------------------------------------- |
| UDP 47800 | State exchange between PCs (broadcast + manually added IPs) |
| TCP 47801 | Browser UI (`http://localhost:47801`)                       |

Data is stored only in `~/.pixel-office/` (profile, layout, downloaded updates).

## Known limitations

- Broadcasts reach **only the same subnet**. Across subnets, add PC IPs under **Settings → My profile → Advanced: when a PC isn't found automatically**.
- Codex doesn't record approval requests, so ❗ for Codex appears only when it asks you a question. Codex subagents are not yet verified against real transcripts.
- Hide details filters paths, addresses and token shapes, but may not catch every password fragment an agent writes in prose.
- Characters whose outfits are near-greyscale barely change with the color setting.

## Development

```bash
npm install
npm run build              # dist/ — cli.js bundles its dependencies (runs without node_modules)
node dist/cli.js --open    # http://localhost:47801
npm test                   # server + webview (Vitest)
npm run check-types && npm run lint
```

| Path               | Contents                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| `core/`            | Protocol (`asyncapi.yaml` → generated `messages.ts`), shared LAN types (`lan.ts`)                |
| `server/src/lan/`  | Reporter: transcript scanner, Claude/Codex parsers, session state, redaction, UDP peers, updater |
| `server/src/`      | Fastify HTTP/WebSocket server, CLI, layout and assets                                            |
| `webview-ui/`      | React + Canvas office, name tags and bubbles, profile, i18n                                      |
| `scripts/package/` | Windows (Inno Setup) and macOS (pkgbuild) installers                                             |

- Architecture and conventions: [CLAUDE.md](CLAUDE.md). Design and implementation plan: [docs/superpowers/](docs/superpowers/).
- **Release**: bump `version` in `package.json` and push a `v<version>` tag; GitHub Actions builds the three installers and attaches them to a Release. Tags containing `-` are published as pre-releases.

## Credits

- Original: [pixel-agents](https://github.com/pixel-agents-hq/pixel-agents) (MIT). The office engine, layout editor and furniture assets come from it.
- Characters: [JIK-A-4, Metro City](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack)
- Font: [Pretendard](https://github.com/orioncactus/pretendard) (SIL OFL 1.1)

<p align="center">
  <img src="webview-ui/public/characters.png" alt="Characters" width="320" height="72" style="image-rendering: pixelated;">
</p>

## License

[MIT](LICENSE). The original pixel-agents copyright notice is retained.
