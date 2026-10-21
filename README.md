# Pixel Office LAN

같은 사내망(LAN)에 있는 모든 PC 의 코딩 에이전트(Claude Code · Codex)를 **하나의 픽셀 사무실**에 캐릭터로 보여 주는 앱입니다. 에이전트가 하는 일에 따라 코딩실·자료실·서버실·대기실을 오가고, 이름표와 말풍선으로 누가 무엇을 하는지 한눈에 보입니다. 서버도 계정도 없이 PC 끼리 서로를 찾고, 다른 PC 의 화면은 읽기 전용입니다.

A pixel-art office where the coding agents (Claude Code, Codex) on every PC of a LAN appear as characters. No server, no accounts — PCs find each other on the local network, and other people's offices are read-only. The UI is Korean and English.

<!-- TODO: 스크린샷 (사무실 전체 · 이름표 · 말풍선) -->

**설치 / Install:** [설치 안내](docs/설치-안내.md) · [Install guide (English)](docs/INSTALL.en.md) · [Releases](https://github.com/YOOJUNGYU/pixel-office-lan/releases/latest)

- Windows 10/11 · macOS (Apple silicon, Intel). Node 등 별도 설치 불필요 — 설치 파일에 포함.
- Claude Code: Windows 네이티브 · WSL · Mac. Codex: 동일.
- 포트: UDP 47800 (PC 간), HTTP 47801 (브라우저 화면, `http://localhost:47801`). 데이터: `~/.pixel-office/`.

## 개발 / Development

```bash
npm install
npm run build          # dist/ (dist/cli.js 는 의존성까지 번들 — node_modules 없이 실행)
node dist/cli.js --open
npm test
```

설치 파일은 `.github/workflows/package.yml` 이 만듭니다 (`scripts/package/`). `v<버전>` 태그를 push 하면 Windows `.exe` 와 Mac `.pkg`(arm64·x64)를 GitHub Release 에 올립니다. 구조와 규칙은 [CLAUDE.md](CLAUDE.md), 설계는 [docs/superpowers/specs](docs/superpowers/specs/).

## 크레딧 / Credits

- [pixel-agents](https://github.com/pixel-agents-hq/pixel-agents) (MIT) 의 포크입니다 — 오피스 엔진·레이아웃 에디터·에셋은 원작에서 왔습니다.
- 캐릭터: [JIK-A-4, Metro City](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack).
- UI 글꼴: [Pretendard](https://github.com/orioncactus/pretendard) (OFL).

<p align="center">
  <img src="webview-ui/public/characters.png" alt="Characters" width="320" height="72" style="image-rendering: pixelated;">
</p>

## License

[MIT](LICENSE) — 원작 pixel-agents 의 저작권 표기를 유지합니다.
