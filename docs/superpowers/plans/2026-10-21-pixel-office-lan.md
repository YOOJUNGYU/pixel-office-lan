# Pixel Office LAN Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** pixel-agents 를 포크해, 같은 LAN 의 설치자 전원의 Claude/Codex 에이전트를 하나의 픽셀 사무실에 닉네임과 함께, 하는 일별 방(코딩실·자료실·서버실·대기실)에 모아 보여 주는 설치형 앱을 만든다.

**Architecture:** 원작의 업스트림 감지 파이프라인(훅·fileWatcher·transcriptParser·agentRuntime·터미널)은 걷어내고, 작은 **리포터**(기록 파일 tail → 세션 상태 → `AgentView`)를 새로 쓴다. 각 PC 는 자기 `AgentView[]` 를 UDP 브로드캐스트로 뿌리고 남의 것을 모아(서버 없음) 로컬 Fastify 가 WebSocket `officeSnapshot` 으로 브라우저에 보낸다. 웹뷰는 원작 Canvas 엔진(레이아웃·스프라이트·길찾기·에디터)을 유지하고, 스냅샷을 캐릭터로 맞추는 reconciler 와 방 이동·손잡기·이름표·hover 를 더한다.

**Tech Stack:** GitHub(공개 저장소 `YOOJUNGYU/pixel-office-lan`, Actions, Releases), TypeScript, Node 22+ (`node:dgram`, `node:fs`), Fastify + @fastify/websocket (기존), React 19 + Vite + Canvas 2D (기존), Vitest (기존), Inno Setup(Windows), pkgbuild(macOS), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-21-pixel-office-lan-design.md`

## Global Constraints

- 원작 MIT `LICENSE` 와 캐릭터 에셋 출처(JIK-A-4 Metro City) 표기 유지.
- 새 런타임 의존성 추가 금지 — UDP·파일 감시·경로 처리는 Node 표준 라이브러리로.
- 포트: UDP **47800**(피어), HTTP **47801**(화면). 데이터 디렉터리 **`~/.pixel-office/`** (원작 `~/.pixel-agents/` 와 분리).
- 방 이름(정확히): `코딩실`, `자료실`, `서버실`, `대기실`. 내부 키는 `coding|library|server|lounge`.
- 공유는 상태(읽기 전용)뿐. 피어/원격 브라우저로부터 받은 어떤 데이터도 실행·파일 변경에 쓰지 않는다. 프로필·레이아웃 저장 등 쓰기 동작은 **loopback 클라이언트만** 허용.
- 사용자의 `~/.claude/settings.json`·Codex 설정을 수정하지 않는다(훅 미사용).
- 상세 숨기기(`hideDetails`, 기본 `true`)가 켜지면 경로·사용자 홈·IP·URL 경로/쿼리·토큰류는 **패킷과 원격 브라우저로 나가지 않는다**. 내 PC loopback 화면은 내 에이전트를 원문으로 본다.
- 세션 표시 TTL 30분, 방 이동 디바운스 3초, 피어 만료 5초, 송신 주기 1초.
- 사용자에게 보이는 문구는 한국어.

## Review Focus

1. **악성/깨진 UDP 패킷**(크기 초과, 타입 불일치, 닉네임에 `<script>`) → 무시되거나 텍스트로만 보이고 프로세스는 죽지 않아야 한다. → Task 2 `parsePeerPacket` 테스트, Task 12 오버레이는 텍스트 노드만 사용.
2. **오래되고 큰 기록 파일**(수천 개, 수백 MB) → 시작 시 전체 재생하지 않고 마지막 64KB 만 읽어 상태를 잡는다. → Task 7 테스트.
3. **쓰다 만 줄**(append 가 줄 중간에서 끊김) → 버퍼링 후 다음 poll 에서 완성, 파싱 에러 없음. → Task 7 테스트.
4. **숨기기 켠 상태의 Windows/WSL/UNC/`~` 경로, 토큰 붙은 URL** → 패킷에 원문이 없어야 한다. → Task 3 테스트.
5. **이미 실행 중일 때 다시 실행**(포트 47801 점유) → 기존 화면을 열고 정상 종료. → Task 9 테스트.

---

### Task 0: 저장소 준비 (업스트림 포크)

**Files:**

- Create: `/home/yoojungyu/GIT/PRIVATE/pixel-office-lan/` 를 업스트림 전체 이력 클론으로 만들고 기존 `docs/superpowers/` 를 보존
- Modify: `package.json` (`name: "pixel-office"`, `displayName: "Pixel Office"`, `bin: {"pixel-office": "./dist/cli.js"}`)

- [ ] **Step 1: 클론 후 docs 합치기**

```bash
cd /home/yoojungyu/GIT/PRIVATE
git clone https://github.com/pixel-agents-hq/pixel-agents pixel-office-tmp
cp -r pixel-office-lan/docs/superpowers pixel-office-tmp/docs/
rm -rf pixel-office-lan && mv pixel-office-tmp pixel-office-lan
cd pixel-office-lan && git remote rename origin upstream
```

- [ ] **Step 2: 기준선 확인** — Run: `npm install && npm run build && npm test` → Expected: 모두 PASS (실패 시 기준선 실패 목록을 기록하고 진행).
- [ ] **Step 3: package.json 이름 변경 후 커밋** — `git commit -am "chore: fork as pixel-office" && git add docs && git commit -m "docs: LAN design spec and plan"`
- [ ] **Step 4: 공개 저장소 생성·push** — `gh repo create YOOJUNGYU/pixel-office-lan --public --source . --remote origin --push` (기본 브랜치 `main` 에서 작업). `upstream` 으로는 절대 push 하지 않는다.

---

### Task 1: 업스트림 감지·터미널·VS Code 걷어내기

남길 것: 정적 서빙, 에셋 로딩(`assetLoader.ts`), 레이아웃 저장/로드, 웹뷰 핸드셰이크(스프라이트·설정·레이아웃 전송), 레이아웃 에디터. 나머지 에이전트 파이프라인은 Task 2~9 가 새로 만든다.

**Files:**

- Delete: `adapters/vscode/`, `server/src/terminal/`, `core/src/terminalFrames.ts`, `core/src/terminalAdapter.ts`, `server/src/hookEventHandler.ts`, `server/src/sessionRouter.ts`, `server/src/providers/`, `server/src/fileWatcher.ts`, `server/src/transcriptParser.ts`, `server/src/agentRuntime.ts`, `server/src/timerManager.ts`, `server/src/subagentWatch.ts`, `server/src/teamUtils.ts`, `server/src/dismissalTracker.ts`, `server/src/agentActivityResend.ts`, `server/src/contextUsage.ts`, `server/src/agentDiagnostics.ts`, `server/src/directories.ts`, `server/src/directorySuggestions.ts`, `server/src/hostDirectory.ts`, `server/src/serverToken.ts`, `server/src/wsAuth.ts`, `e2e/`, 위 모듈의 `server/__tests__/*`
- Delete (webview): `webview-ui/src/terminal/`, `webview-ui/src/mobile/`, `components/{TerminalDrawer,TerminalPane,TerminalPaneStack,LaunchDrawer,MobileTerminalPage,MobileAgentBar,MobileKeyBar,DirectoryModal,AgentCard,AgentCardBar,DebugView,MigrationNotice}.tsx`, `hooks/{useTerminalDrawer,useDirectoryEditor}.ts`, `office/components/ToolOverlay.tsx`
- Modify: `server/src/cli.ts`, `server/src/server.ts`, `server/src/httpServer.ts`, `server/src/clientMessageHandler.ts`, `server/src/types.ts`, `server/src/assetLoader.ts` (vscode import 제거), `webview-ui/src/App.tsx`, `webview-ui/src/hooks/useExtensionMessages.ts` (에이전트 메시지 핸들러 전부 제거), `esbuild.js` (`buildCli` + `copyAssets` 만), `package.json` (vscode `contributes`/`activationEvents`/`main`, `@lydell/node-pty`, xterm, e2e 스크립트 제거), `core/asyncapi.yaml` (삭제된 메시지 제거 후 `npm run asyncapi:generate`)
- Modify: 데이터 디렉터리 상수(`server/src/constants.ts` 의 `.pixel-agents`) → `.pixel-office`

**Interfaces:**

- Produces: `server.start({..., host, port, staticDir, assetCache})` 이 아무 에이전트 없이 사무실을 서빙. WS 연결별로 `isLoopback(req): boolean` (`server/src/httpServer.ts`) — 원격 주소가 `127.0.0.1`/`::1`/`::ffff:127.0.0.1` 이면 true. 기존 토큰 기반 권한 검사는 전부 이 함수로 대체.

- [ ] **Step 1: 삭제 및 import 정리** — 위 목록 삭제 후 `npm run check-types` 가 0 에러가 될 때까지 참조 제거. 레이아웃 저장(`saveLayout` 등 쓰기 메시지)은 `isLoopback` 일 때만 처리.
- [ ] **Step 2: 확인** — Run: `npm run check-types && npm run lint && npm test` → PASS. Run: `npm run build && node dist/cli.js --port 47801` → 브라우저 `http://localhost:47801` 에 빈 사무실이 뜨고 콘솔 에러 없음.
- [ ] **Step 3: 커밋** — `git commit -am "refactor: strip upstream detection, terminal and vscode adapter"`

---

### Task 2: LAN 공용 타입과 패킷 검증

**Files:**

- Create: `core/src/lan.ts`, `server/__tests__/lan/packet.test.ts`
- Modify: `core/src/index.ts` (re-export)

**Interfaces:**

- Produces:

```ts
export type Room = 'coding' | 'library' | 'server' | 'lounge';
export const ROOM_LABELS: Record<Room, string>; // { coding:'코딩실', library:'자료실', server:'서버실', lounge:'대기실' }
export type Provider = 'claude' | 'codex';
export type ViewKind = 'main' | 'subagent' | 'shell';
export interface AgentView {
  id: string; // 피어 안에서 유일. main=세션 id, subagent=`${parentId}/sub/${name}`, shell=`${parentId}/sh/${shellId}`
  provider: Provider;
  kind: ViewKind;
  num: number; // main 의 #n, 자식은 0
  parentId?: string; // 자식만
  room: Room;
  permission: boolean; // 승인/입력 대기
  summary: string; // ≤120자
  reason: string; // ≤200자, 없으면 ''
}
export interface PeerInfo {
  id: string;
  nickname: string;
  palette: number;
  hueShift: number;
}
export interface PeerPacket {
  v: 1;
  peer: PeerInfo;
  views: AgentView[];
}
export interface OfficeAgent extends AgentView {
  key: string;
  parentKey?: string;
  peer: PeerInfo;
} // key=`${peer.id}:${id}`
export const LAN_UDP_PORT = 47800;
export const LAN_HTTP_PORT = 47801;
export const MAX_PACKET_BYTES = 60_000;
export function parsePeerPacket(text: string): PeerPacket | null;
```

- [ ] **Step 1: 실패 테스트 작성** — `packet.test.ts`:
  - 정상 패킷 왕복: `parsePeerPacket(JSON.stringify(p))` deep-equals `p`.
  - `v !== 1`, `views` 가 배열 아님, `room: 'kitchen'`, `palette: 9`, `hueShift: 400`, 길이 > `MAX_PACKET_BYTES` → `null`.
  - 닉네임 30자 → 20자로 잘림, `summary` 500자 → 120자, `reason` → 200자, `views` 80개 → 앞 50개.
  - 닉네임 `'<img src=x onerror=alert(1)>'` 은 문자열 그대로 보존(이스케이프는 렌더 쪽 책임) — 반환값의 `nickname` 이 동일 문자열.
  - JSON 파싱 실패 → `null`, 예외 없음.
- [ ] **Step 2: 실패 확인** — Run: `cd server && npx vitest run __tests__/lan/packet.test.ts` → FAIL (모듈 없음)
- [ ] **Step 3: 구현** — 손으로 쓴 필드별 검증(새 의존성 금지). palette 0–5 정수, hueShift 0–360, provider/kind/room 은 열거값만.
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(lan): shared view types and packet validation"`

---

### Task 3: 상세 숨기기 필터

**Files:**

- Create: `server/src/lan/redact.ts`, `server/__tests__/lan/redact.test.ts`

**Interfaces:**

- Consumes: `AgentView` (Task 2)
- Produces: `redactText(s: string): string`, `redactView(v: AgentView): AgentView` (`summary`·`reason` 에 `redactText` 적용)

- [ ] **Step 1: 실패 테스트** — 정확한 기대값:

```ts
expect(redactText('/home/kim/proj/src/auth/login.ts 수정 중')).toBe('login.ts 수정 중');
expect(redactText('C:\\Users\\kim\\proj\\a.ts 읽는 중')).toBe('a.ts 읽는 중');
expect(redactText('\\\\wsl.localhost\\Ubuntu\\home\\kim\\x.py')).toBe('x.py');
expect(redactText('~/secret/notes.md 열기')).toBe('notes.md 열기');
expect(redactText('https://api.corp.com/v1/users?token=abc 보는 중')).toBe('api.corp.com 보는 중');
expect(redactText('10.1.2.3:8080 접속')).toBe('[IP] 접속');
expect(redactText('키 sk-ant-api03-AbCdEf0123456789xyz 설정')).toBe('키 [비밀] 설정');
expect(redactText('ghp_0123456789abcdefABCDEF0123456789abcd')).toBe('[비밀]');
expect(redactText('토큰 만료 시 재로그인이 안 되는 문제 수정')).toBe(
  '토큰 만료 시 재로그인이 안 되는 문제 수정',
);
expect(redactText('npm test 실행')).toBe('npm test 실행');
```

- [ ] **Step 2: 실패 확인** — Run: `cd server && npx vitest run __tests__/lan/redact.test.ts` → FAIL
- [ ] **Step 3: 구현** — 순서: URL→호스트, UNC/드라이브/절대/`~` 경로→basename, IPv4(옵션 포트)→`[IP]`, 비밀 패턴(`sk-`, `ghp_`, `gho_`, `xox[bp]-`, `AKIA`, 32자 이상 base64/hex 덩어리)→`[비밀]`.
- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(lan): detail redaction"`

---

### Task 4: 세션 상태 모델 (방 디바운스·대기/승인 타이머·자식 셸)

**Files:**

- Create: `server/src/lan/session.ts`, `server/__tests__/lan/session.test.ts`

**Interfaces:**

- Consumes: `Room`, `AgentView`, `Provider`, `ViewKind`
- Produces:

```ts
export const ROOM_DEBOUNCE_MS = 3_000,
  PERMISSION_DELAY_MS = 7_000,
  TEXT_IDLE_DELAY_MS = 5_000;
export interface SessionState {
  provider: Provider;
  id: string;
  kind: 'main' | 'subagent';
  num: number;
  parentId?: string;
  room: Room; // 표시 중인 방
  candidate: Room;
  candidateSince: number;
  summary: string;
  reason: string;
  permission: boolean;
  lastLineAt: number;
  pendingTool: { name: string; since: number; exempt: boolean } | null;
  textOnlyAt: number | null;
  turnEnded: boolean;
  shells: Map<string, string>; // shellId → summary
}
export function newSession(
  provider: Provider,
  id: string,
  kind: 'main' | 'subagent',
  now: number,
  parentId?: string,
): SessionState; // room/candidate='lounge', summary='대기 중'
export function setActivity(s: SessionState, room: Room | null, summary: string, now: number): void; // room=null 은 방 유지
export function setIdle(s: SessionState, now: number): void; // candidate lounge, summary '대기 중', pendingTool/permission 해제, turnEnded=true
export function tick(s: SessionState, now: number): void;
export function toViews(s: SessionState): AgentView[]; // 본인 + shells 를 kind 'shell', room 'server', parentId=s.id
```

`tick` 규칙: (1) `pendingTool && !exempt && now - lastLineAt >= PERMISSION_DELAY_MS` → `permission=true`, candidate `lounge`(즉시 반영, 디바운스 없음). (2) `textOnlyAt && !pendingTool && now - textOnlyAt >= TEXT_IDLE_DELAY_MS` → `setIdle`. (3) `candidate !== room && now - candidateSince >= ROOM_DEBOUNCE_MS` → `room = candidate`. `setActivity` 는 candidate 가 바뀔 때만 `candidateSince=now`.

- [ ] **Step 1: 실패 테스트** — 시각을 인자로 주입:
  - `setActivity(s,'coding',…, 0)` 후 `tick(s, 2_999)` → `room==='lounge'`; `tick(s, 3_000)` → `'coding'`.
  - coding→library→coding 을 1초 간격으로 오가면 3초 안에는 방이 안 바뀐다.
  - `pendingTool={name:'Edit',since:0,exempt:false}`, `lastLineAt=0`, `tick(s,7_000)` → `permission===true && room==='lounge'`.
  - exempt 도구는 7초 지나도 `permission===false`.
  - `textOnlyAt=0`, `tick(s,5_000)` → `summary==='대기 중'`, 3초 뒤 `room==='lounge'`.
  - `shells.set('b1','명령 실행: npm run dev')` → `toViews` 길이 2, 두 번째 `{kind:'shell', room:'server', parentId:s.id, id:\`${s.id}/sh/b1\`}`.
- [ ] **Step 2: 실패 확인** — `cd server && npx vitest run __tests__/lan/session.test.ts` → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(lan): session state model"`

---

### Task 5: Claude 기록 파서

**Files:**

- Create: `server/src/lan/claudeParser.ts`, `server/__tests__/lan/claudeParser.test.ts`, `server/__tests__/lan/fixtures/claude-*.jsonl` (수작업 최소 픽스처)

**Interfaces:**

- Consumes: Task 4 전부
- Produces: `applyClaudeLine(s: SessionState, line: string, now: number): void` — 모든 줄에서 `lastLineAt=now`, 잘못된 JSON 은 무시.

매핑 (assistant `message.content[]` 의 블록 순서대로; 같은 메시지의 직전 `text` 블록이나 같은 턴 직전 assistant text 를 `reason` 으로, 앞뒤 공백 정리 후 200자):

| tool_use name                        | room       | summary                                                  |
| ------------------------------------ | ---------- | -------------------------------------------------------- |
| Edit, Write, MultiEdit, NotebookEdit | coding     | `${basename(file_path ?? notebook_path)} 수정 중`        |
| Read                                 | library    | `${basename(file_path)} 읽는 중`                         |
| Grep                                 | library    | `"${pattern}" 검색 중`                                   |
| Glob                                 | library    | `"${pattern}" 파일 찾는 중`                              |
| WebSearch                            | library    | `웹 검색: ${query}`                                      |
| WebFetch                             | library    | `${url} 보는 중`                                         |
| `mcp__<srv>__<tool>`                 | library    | `${srv}:${tool} 사용 중`                                 |
| Bash, PowerShell                     | server     | `명령 실행: ${description ?? command}` (command 는 80자) |
| Task, Agent                          | lounge     | `서브에이전트에게 맡김: ${description}` — exempt         |
| AskUserQuestion, ExitPlanMode        | lounge     | `답변 기다리는 중` — 즉시 `permission=true`, exempt      |
| KillShell / TaskStop                 | (유지)     | (유지) — `input.shell_id ?? input.task_id` 셸 제거       |
| 그 외                                | null(유지) | `${name} 사용 중`                                        |

그 밖의 줄: `user` 의 `tool_result` → `pendingTool=null`, `permission=false`; 그 내용에 `Command running in background with ID: (\S+)` 가 있고 해당 tool_use 가 `run_in_background:true` 였으면 `shells.set(id, 그 Bash summary)`. `user` 일반 텍스트 → 새 턴(`turnEnded=false`, `permission=false`, `textOnlyAt=null`); 텍스트에 `<task-id>X</task-id>` 와 `<status>(completed|failed|killed)</status>` 가 있으면 `shells.delete(X)`. tool_use 없이 text 만 있는 assistant → `textOnlyAt=now`. `system` + `subtype:'turn_duration'` → `setIdle`. 비-exempt tool_use → `pendingTool={name,since:now,exempt:false}`.

- [ ] **Step 1: 실패 테스트** — 픽스처 줄을 순서대로 넣고 `tick(s, now+3_000)` 후 확인:
  - text "토큰 만료 시 재로그인 문제를 고치겠습니다" + Edit `/a/b/login.ts` → `room 'coding'`, `summary 'login.ts 수정 중'`, `reason` 이 그 문장.
  - Grep `pattern:"refreshToken"` → `'"refreshToken" 검색 중'`, `room 'library'`.
  - Bash `{command:"npm run dev", description:"개발 서버 실행", run_in_background:true}` + tool_result `Command running in background with ID: bash_1` → `toViews` 에 `id: '<sid>/sh/bash_1'`, `summary: '명령 실행: 개발 서버 실행'`. 이어서 user 텍스트 `<task-id>bash_1</task-id><status>completed</status>` → 셸 사라짐.
  - AskUserQuestion → 즉시 `permission===true`.
  - `{"type":"system","subtype":"turn_duration"}` → 3초 뒤 `room 'lounge'`, `summary '대기 중'`.
  - `'{not json'` → 예외 없음.
- [ ] **Step 2: 실패 확인** — `cd server && npx vitest run __tests__/lan/claudeParser.test.ts` → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** → PASS. 추가로 실제 기록 하나로 스모크: `node -e` 대신 테스트에 `it.skipIf(!process.env.REAL_CLAUDE_JSONL)` 케이스를 두고 `REAL_CLAUDE_JSONL=<경로> npx vitest run …` 가 예외 없이 끝나는지 확인.
- [ ] **Step 5: 커밋** — `git commit -m "feat(lan): claude transcript parser"`

---

### Task 6: Codex 기록 파서

Codex 기록은 버전마다 다르다. 이 PC 의 최신 형식(2026-08, `custom_tool_call name:'exec'` 의 `input` 이 `tools.exec_command({cmd:"…"})` 같은 스크립트)과 구형(`function_call name:'shell'|'exec_command'`, `custom_tool_call name:'apply_patch'`, `web_search_call`) 둘 다 처리한다.

**Files:**

- Create: `server/src/lan/codexParser.ts`, `server/__tests__/lan/codexParser.test.ts`, `server/__tests__/lan/fixtures/codex-*.jsonl`

**Interfaces:**

- Consumes: Task 4
- Produces: `applyCodexLine(s: SessionState, line: string, now: number): void`, `codexSessionMeta(firstLine: string): { id: string; parentId?: string } | null`, `classifyShell(cmd: string): Room` (`library` 또는 `server`)

규칙:

- `response_item` `custom_tool_call` `name:'exec'`: `input` 에서 첫 `tools.<fn>(` 로 판정 — `apply_patch` → coding, summary `${basename(*** (Update|Add|Delete) File: <path>)} 수정 중`; `exec_command` → `cmd:"…"` 추출, `classifyShell(cmd)`, summary library 면 `읽는 중: ${cmd}` / server 면 `명령 실행: ${cmd}` (80자); `web__run`·`web_search` → library `웹 검색 중`; `view_image` → library `이미지 보는 중`; `request_user_input*` → lounge `답변 기다리는 중`, `permission=true`; `write_stdin`·`update_plan`·기타 → 방·요약 유지.
- 구형: `function_call` `shell`/`exec_command`/`local_shell_call` (arguments JSON 의 `command` 배열 또는 `cmd`), `custom_tool_call` `apply_patch`, `response_item` `web_search_call` 을 위와 같은 결과로.
- `classifyShell`: 첫 토큰(파이프 앞)이 `rg|grep|cat|head|tail|ls|find|fd|wc|nl|tree|less` 이거나 `sed -n`, `git (log|show|diff|status|grep|blame)` 이면 `library`, 그 외 `server`.
- `reason`: `event_msg/item_completed` 의 `item.type==='AgentMessage'` 텍스트, 또는 `response_item` `message` `role:'assistant'` 의 output_text.
- `custom_tool_call_output`/`function_call_output`: `pendingTool=null`. 출력 텍스트에서 `"session_id":(\d+)` 이 있고 `"exit_code"` 가 없으면 `shells.set(N, 직전 exec summary)`, 있으면 `shells.delete(N)`.
- `event_msg` `task_complete`·`turn_aborted` → `setIdle`. `task_started` → 새 턴.
- Codex 는 승인 기록을 남기지 않으므로 모든 도구 `exempt:true` (승인 대기 감지는 `request_user_input` 만). `// ponytail: Codex 승인 대기 미감지, 기록에 승인 이벤트가 생기면 추가`
- `codexSessionMeta`: 첫 줄 `session_meta.payload.id`. `payload.source` 가 객체이고 `source.subagent.thread_spawn.parent_thread_id` 가 있으면 `parentId`. `// ponytail: Codex 서브에이전트 포맷 미검증(로컬 표본 없음), 실제 표본 확보 시 픽스처로 고정`

- [ ] **Step 1: 실패 테스트** — 최신 형식 픽스처:
  - `exec` input `text(await tools.exec_command({cmd:"rg -n 'refresh' src"}))` → library, `"읽는 중: rg -n 'refresh' src"`.
  - `exec` input 에 `tools.apply_patch("*** Begin Patch\n*** Update File: /x/y/login.ts\n…")` → coding, `'login.ts 수정 중'`.
  - `exec_command({cmd:"pnpm build"})` → server, `'명령 실행: pnpm build'`.
  - 출력 `{"session_id":7933,"output":""}` → 셸 `7933` 생성. 이후 `{"session_id":7933,"exit_code":0}` → 제거.
  - `item_completed` AgentMessage "검색 배치를 확인해 수정하겠습니다" → `reason` 이 그 문장.
  - `task_complete` → 3초 뒤 lounge.
  - 구형 `function_call name:'shell' arguments:'{"command":["bash","-lc","cat a.ts"]}'` → library.
  - `codexSessionMeta('{"type":"session_meta","payload":{"id":"c1","source":{"subagent":{"thread_spawn":{"parent_thread_id":"p1","depth":1}}}}}')` → `{id:'c1', parentId:'p1'}`; `source:"cli"` → `{id:'c1'}`.
- [ ] **Step 2: 실패 확인** — `cd server && npx vitest run __tests__/lan/codexParser.test.ts` → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** → PASS. 실제 기록 스모크: `REAL_CODEX_JSONL=$(ls -t ~/.codex/sessions/*/*/*/*.jsonl | head -1)` 로 skipIf 케이스 실행 → 예외 없음.
- [ ] **Step 5: 커밋** — `git commit -m "feat(lan): codex transcript parser"`

---

### Task 7: 스캐너 (루트 탐색·활성 파일·tail·서브에이전트)

**Files:**

- Create: `server/src/lan/scanner.ts`, `server/__tests__/lan/scanner.test.ts`

**Interfaces:**

- Consumes: Task 4–6
- Produces:

```ts
export const SESSION_TTL_MS = 30 * 60_000,
  CHILD_IDLE_TTL_MS = 120_000,
  TAIL_BYTES = 64 * 1024;
export interface Roots {
  claude: string[];
  codex: string[];
} // claude: …/.claude/projects, codex: …/.codex/sessions
export function discoverRoots(
  env?: NodeJS.ProcessEnv,
  platform?: NodeJS.Platform,
  home?: string,
): Promise<Roots>;
export class Scanner {
  constructor(roots: Roots, now?: () => number);
  discover(): Promise<void>; // 활성 파일 찾기 (10초마다 호출)
  poll(): Promise<void>; // 알려진 파일 tail + 모든 세션 tick (1초마다)
  views(): AgentView[];
  start(): void;
  stop(): void;
}
```

- `discoverRoots`: `CLAUDE_CONFIG_DIR ?? ~/.claude` + `/projects`, `CODEX_HOME ?? ~/.codex` + `/sessions`. `platform==='win32'` 이면 `wsl.exe -l -q` (UTF-16LE 디코드, 실패 시 무시)로 배포판 목록을 얻어 `\\wsl.localhost\<배포판>\home\*\` 와 `\\wsl.localhost\<배포판>\root\` 아래 같은 두 경로 중 존재하는 것 추가.
- `discover`: Claude 루트는 `*/*.jsonl`(메인)과 `*/<sessionId>/subagents/*.jsonl`(서브에이전트, `parentId=sessionId`, id=`${sessionId}/sub/${파일명}`); Codex 루트는 오늘·어제 날짜 디렉터리(`YYYY/MM/DD`)만. mtime 이 `SESSION_TTL_MS` 이내인 파일만 등록. 신규 등록 시 파일 끝 `TAIL_BYTES` 만 읽어(첫 줄 조각은 버림) 상태를 만든다. Codex 는 첫 줄로 `codexSessionMeta` 를 따로 읽는다.
- `poll`: 등록 파일의 크기 증가분만 읽고 마지막 개행 이후는 다음 poll 까지 버퍼링. 줄마다 해당 파서 호출 후 `tick`. 메인 세션은 mtime 이 TTL 을 넘으면 제거, 서브에이전트는 `turnEnded` 상태로 10초 지나거나 `CHILD_IDLE_TTL_MS` 동안 변화 없으면 제거.
- 메인 번호 `num` 은 비어 있는 가장 작은 양수.
- `start()` 는 `setInterval` 두 개(10초 discover, 1초 poll), 겹침 방지 플래그. `// ponytail: 폴링 기반, WSL 9P 위 수천 파일에서 느리면 루트별 간격 조정`

- [ ] **Step 1: 실패 테스트** — `fs.mkdtemp` 로 가짜 루트 구성, `now` 주입:
  - 40분 전 mtime 파일은 무시, 방금 파일은 `views()` 에 `num:1`.
  - 2MB 파일 끝에 Edit 줄 → 등록 직후 `poll` + 3초 tick 뒤 coding (전체를 파싱하지 않았음을 `readNewLines` 스파이 대신 결과로 확인: 앞부분의 Grep 줄이 reason/summary 에 영향 없음).
  - 줄을 두 번에 나눠 append(`'{"type":"assi'` 다음 `'stant",…}\n'`) → 두 번째 poll 후 정상 반영, 예외 없음.
  - `<sid>/subagents/agent-x.jsonl` → `views()` 에 `{kind:'subagent', parentId:'<sid>'}`.
  - 두 세션 중 #1 이 사라진 뒤 새 세션 → `num:1` 재사용.
  - `discoverRoots({CLAUDE_CONFIG_DIR:'/c', CODEX_HOME:'/x'}, 'linux', '/h')` → `{claude:['/c/projects'], codex:['/x/sessions']}`.
- [ ] **Step 2: 실패 확인** — `cd server && npx vitest run __tests__/lan/scanner.test.ts` → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(lan): transcript scanner"`

---

### Task 8: 프로필과 피어 네트워크(UDP)

**Files:**

- Create: `server/src/lan/profile.ts`, `server/src/lan/peerNet.ts`, `server/__tests__/lan/profile.test.ts`, `server/__tests__/lan/peerNet.test.ts`

**Interfaces:**

- Consumes: Task 2, Task 3
- Produces:

```ts
// profile.ts
export interface Profile {
  peerId: string;
  nickname: string;
  palette: number;
  hueShift: number;
  hideDetails: boolean;
  manualPeers: string[];
}
export function loadProfile(dir?: string): Profile; // 기본 ~/.pixel-office/profile.json, 없으면 peerId=randomUUID, nickname='', palette=0, hueShift=0, hideDetails=true, manualPeers=[]
export function saveProfile(p: Profile, dir?: string): void;
export function validateProfileUpdate(x: unknown): Omit<Profile, 'peerId'> | null; // nickname 1–20자(trim), palette 0–5, hueShift 0–360, manualPeers ≤20개 IPv4/호스트명
// peerNet.ts
export const PEER_TTL_MS = 5_000,
  SEND_INTERVAL_MS = 1_000;
export function broadcastAddresses(ifaces?: ReturnType<typeof os.networkInterfaces>): string[]; // 내부 아닌 IPv4 각각의 directed broadcast + '255.255.255.255'
export class PeerNet {
  constructor(opts: {
    port: number;
    selfId: string;
    getPacket: () => PeerPacket;
    manualPeers: () => string[];
    targets?: () => string[];
    now?: () => number;
  });
  start(): Promise<void>; // dgram udp4, reuseAddr, setBroadcast(true), bind 0.0.0.0:port
  stop(): void;
  sendNow(): void;
  peers(): PeerPacket[]; // 만료 안 된 것, selfId 제외
}
```

- `getPacket` 은 호출자가 만든다: `hideDetails` 면 views 에 `redactView` 적용. 직렬화 결과가 `MAX_PACKET_BYTES` 를 넘으면 뒤쪽 views 를 잘라 맞춘다. `// ponytail: 단일 데이터그램(IP 단편화 의존), 손실이 보이면 분할 전송`
- 수신은 `parsePeerPacket(msg.toString('utf8'))` 결과만 저장, `null` 은 무시.

- [ ] **Step 1: 실패 테스트**
  - profile: 임시 디렉터리에서 첫 `loadProfile` 은 `nickname===''`, `hideDetails===true`, 두 번째 호출은 같은 `peerId`. `validateProfileUpdate({nickname:'  ',…})` → null, `{palette:7}` → null, 정상 → 객체.
  - peerNet: 포트 0 대신 임의 포트 2개로 두 인스턴스를 띄우고 `targets: () => ['127.0.0.1']` 로 서로 보내기 → 상대 `peers()` 에 상대 peer.id 가 보이고, 자기 id 는 안 보임. `now` 를 5_001ms 앞당기면 `peers()` 가 빈 배열. 쓰레기 바이트 수신 후에도 `peers()` 정상.
  - `broadcastAddresses({eth0:[{family:'IPv4',address:'192.168.0.10',netmask:'255.255.255.0',internal:false}]})` 에 `'192.168.0.255'` 포함.
- [ ] **Step 2: 실패 확인** — `cd server && npx vitest run __tests__/lan/profile.test.ts __tests__/lan/peerNet.test.ts` → FAIL
- [ ] **Step 3: 구현** — 송신 대상 = `targets?.() ?? [...broadcastAddresses(), ...manualPeers()]`.
- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(lan): profile and udp peer network"`

---

### Task 9: 서버 배선 (스냅샷 WS·프로필 메시지·단일 실행)

**Files:**

- Create: `server/src/lan/office.ts`, `server/__tests__/lan/office.test.ts`, `server/__tests__/lan/singleInstance.test.ts`
- Modify: `server/src/cli.ts`, `server/src/httpServer.ts`, `server/src/clientMessageHandler.ts`, `core/asyncapi.yaml` (+ `npm run asyncapi:generate`)

**Interfaces:**

- Consumes: Task 1 `isLoopback`, Task 2–8
- Produces:

```ts
// office.ts
export function buildOffice(
  self: PeerInfo,
  local: AgentView[],
  peers: PeerPacket[],
  redactLocal: boolean,
): OfficeAgent[];
// key=`${peer.id}:${id}`, parentKey=`${peer.id}:${parentId}`; redactLocal 이면 local 에만 redactView 적용(피어 것은 이미 송신자가 처리)
export function checkExisting(port: number): Promise<boolean>; // GET http://127.0.0.1:port/api/ping 이 {app:'pixel-office'} 면 true
```

WS 메시지 (asyncapi 에 추가):

- 서버→클라: `officeSnapshot { agents: OfficeAgent[]; selfPeerId: string }` — 1초마다, 연결별로 `redactLocal = profile.hideDetails && !isLoopback(conn)`.
- 서버→클라: `profileLoaded { profile: Omit<Profile,'peerId'>; canEdit: boolean }` — 핸드셰이크와 저장 직후. `canEdit = isLoopback`.
- 클라→서버: `saveProfile { profile: Omit<Profile,'peerId'> }` — loopback 만, `validateProfileUpdate` 통과 시 저장 후 즉시 `peerNet.sendNow()`.

HTTP: `GET /api/ping` → `{app:'pixel-office'}`. `POST /api/quit` (loopback 만) → 프로세스 정상 종료(제거 프로그램이 사용).

cli.ts: `Scanner`·`PeerNet` 을 시작하고, `getPacket = () => ({v:1, peer, views: hideDetails ? scanner.views().map(redactView) : scanner.views()})` (+ `MAX_PACKET_BYTES` 자르기). 기본 `--host 0.0.0.0 --port 47801`. 시작 전 `checkExisting(47801)` 이 true 면 `--open` 일 때 브라우저만 열고 exit 0. `--open` 이면 기동 후 `http://localhost:47801` 을 기본 브라우저로 연다(`start`/`open`/`xdg-open`). 프로필 `nickname===''` 이면 nickname 은 `'이름없음'` 으로 송신.

- [ ] **Step 1: 실패 테스트**
  - `buildOffice` : 로컬 view summary `/home/kim/a.ts 수정 중` → `redactLocal=true` 면 `a.ts 수정 중`, false 면 원문. 피어 자식 view 의 `parentKey === '<peerId>:<parentId>'`.
  - `checkExisting`: 테스트에서 fastify 로 `/api/ping` 을 띄운 포트 → true, 닫힌 포트 → false.
  - httpServer WS 테스트(기존 `httpServerWs.test.ts` 패턴): loopback 연결은 `profileLoaded.canEdit===true`, 원격으로 위장한 연결(`isLoopback` 주입/모킹)의 `saveProfile` 은 무시되어 파일이 안 바뀜.
- [ ] **Step 2: 실패 확인** — `cd server && npx vitest run __tests__/lan/office.test.ts __tests__/lan/singleInstance.test.ts __tests__/httpServerWs.test.ts` → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** → PASS. 수동: `npm run build && node dist/cli.js` 실행 후 Claude 세션 하나 돌리며 브라우저 개발자도구 WS 프레임에 `officeSnapshot` 의 내 에이전트가 1초마다 오는지 확인. 두 번째 `node dist/cli.js --open` 은 즉시 종료.
- [ ] **Step 5: 커밋** — `git commit -m "feat(lan): wire scanner, peers and office snapshot"`

---

### Task 10: 4개 방 기본 레이아웃

**Files:**

- Create: `scripts/generate-lan-layout.mjs`, `webview-ui/test/lanLayout.test.ts`
- Modify: `webview-ui/public/assets/default-layout-1.json` (생성 결과로 교체)

**Interfaces:**

- Produces: 레이아웃 `areas: [{label:'코딩실'},{label:'자료실'},{label:'서버실'},{label:'대기실'}]` (+ 각 color), `areaTiles` 로 칠해진 4개 방. 가구 타입은 기존 매니페스트(`webview-ui/public/assets/furniture/`)의 책상·의자·PC·책장·소파·서버랙 비슷한 것을 사용. 방 사이 문(벽 틈)으로 모든 방이 서로 걸어서 연결.

좌석 하한(의자 타일 수): 코딩실 ≥ 32, 자료실 ≥ 24, 서버실 ≥ 24, 대기실 ≥ 48. 전체 ≤ 64×64.

- [ ] **Step 1: 실패 테스트** — `lanLayout.test.ts`: JSON 을 읽어 기존 `OfficeState` 를 그 레이아웃으로 만들고, `seats` 를 `seatZone` 으로 묶어 각 방 좌석 수가 하한 이상, 네 라벨 모두 존재, 각 방의 아무 타일에서 다른 방 타일로 경로가 존재(기존 길찾기 함수 사용).
- [ ] **Step 2: 실패 확인** — `cd webview-ui && npx vitest run test/lanLayout.test.ts` → FAIL
- [ ] **Step 3: 생성 스크립트 작성·실행** — `node scripts/generate-lan-layout.mjs > webview-ui/public/assets/default-layout-1.json`
- [ ] **Step 4: 통과 확인** → PASS. 브라우저로 방 4개가 보기 좋게 보이는지 눈으로 확인(스크린샷 첨부).
- [ ] **Step 5: 커밋** — `git commit -m "feat(lan): four-room default layout"`

---

### Task 11: 웹뷰 — 방 이동·방 안 배회·손잡기 엔진

**Files:**

- Create: `webview-ui/src/lan/lanAgents.ts`, `webview-ui/test/lanAgents.test.ts`
- Modify: `webview-ui/src/office/engine/officeState.ts`, `webview-ui/src/office/engine/characters.ts` (배회 범위), `webview-ui/src/office/types.ts` (Character 필드), `webview-ui/src/hooks/useExtensionMessages.ts` (`officeSnapshot`·`profileLoaded` 처리)

**Interfaces:**

- Consumes: `OfficeAgent`, `ROOM_LABELS` (core), 기존 `OfficeState.addAgent/removeAgent/walkToTile/showPermissionBubble/clearPermissionBubble`
- Produces:

```ts
// officeState.ts 추가
moveToArea(id: number, areaLabel: string): void;   // 좌석 해제 → 그 방의 빈 좌석(PC 향한 좌석 우선) → 없으면 방 안 빈 바닥 타일 → 걸어가기. ch.homeArea=areaLabel
setParentLink(childId: number, parentId: number | null, sameRoom: boolean): void; // ch.linkParentId, ch.followParent=sameRoom
// Character 추가 필드: homeArea?: string; linkParentId?: number; followParent?: boolean
// lanAgents.ts
export class LanAgents {
  constructor(os: OfficeState);
  apply(agents: OfficeAgent[]): void;
  idFor(key: string): number | undefined;
  agentFor(id: number): OfficeAgent | undefined;
  all(): OfficeAgent[];
}
```

- `apply`: 새 key → 증가 id 로 `addAgent(id, palette, hueShift)` 후 `moveToArea`. 외형: main 은 peer 의 palette/hueShift, subagent 는 peer palette + `hueShift+120 (mod 360)`, shell 은 palette 3 + hueShift 0 _(설계상 우리 판단)_. room 변경 → `moveToArea`. `permission` → show/clear permission bubble. 사라진 key → `removeAgent`. 마지막에 자식마다 `setParentLink(child, parent, child.room===parent.room)`; 부모가 없으면 `null`.
- `followParent` 인 자식은 좌석에 앉지 않고, 매 업데이트에서 부모와 체비셰프 거리 > 1 이면 부모 옆 가장 가까운 빈 walkable 타일로 길찾기. 여러 자식은 줄지어(앞 자식 옆) 선다.
- 배회: `homeArea` 가 있으면 그 방 타일 안에서만 배회.

- [ ] **Step 1: 실패 테스트** (`lanAgents.test.ts`, Task 10 레이아웃 사용):
  - `apply([main(room coding)])` → 캐릭터 1개, 목표 타일의 `seatZone`/area 가 `'코딩실'`.
  - 같은 key 로 room lounge → 목표가 `'대기실'` 안.
  - 대기실 좌석 수+5 명을 lounge 로 넣어도 예외 없이 전원 대기실 타일 위에 있다(서 있는 인원 포함).
  - 자식이 부모와 같은 방 → `followParent===true`; 다른 방 → `linkParentId` 설정 & `followParent===false`.
  - 목록에서 빠진 key → 캐릭터 제거, 그 자식 링크는 null.
  - 같은 스냅샷 두 번 apply → id 변화 없음.
- [ ] **Step 2: 실패 확인** — `cd webview-ui && npx vitest run test/lanAgents.test.ts` → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(lan): room movement, confined wander and parent links"`

---

### Task 12: 웹뷰 — 이름표·hover 말풍선·연결선

**Files:**

- Create: `webview-ui/src/lan/LanOverlay.tsx`
- Modify: `webview-ui/src/office/engine/renderer.ts` (연결선), `webview-ui/src/App.tsx` (ToolOverlay 자리에 LanOverlay)

**Interfaces:**

- Consumes: `LanAgents` (Task 11), 기존 `overlayProjection(...).toScreenX/Y`, `officeState.hoveredAgentId`
- Produces: `LanOverlay(props: { officeState: OfficeState; lan: LanAgents; containerRef: RefObject<HTMLDivElement>; zoom: number; panRef: MutableRefObject<{x:number;y:number}> })`

- 이름표(항상, 캐릭터 발 아래): main `${nickname} · ${provider==='claude' ? 'Claude' : 'Codex'} #${num}` + 앞에 제공자 배지(Claude 주황 `#D97757`, Codex 초록 `#10A37F` 작은 점). subagent `↳ 서브에이전트`, shell `↳ 셸`.
- hover 말풍선: 1행 `${ROOM_LABELS[room]}`, 2행 `summary`, 3행 `reason`(있을 때, 따옴표). `permission` 이면 1행에 `❗ 확인 필요`.
- 모든 텍스트는 React 텍스트 노드로만(`dangerouslySetInnerHTML` 금지).
- renderer: 연결선 없음(사용자 변경). 손잡기는 Task 11 의 따라가기 배치로 표현하고, `ghostOf` 캐릭터(다른 방에 있는 부모의 반투명 분신)는 hover 시 실제 부모 정보를 보여 준다.

- [ ] **Step 1: 구현**
- [ ] **Step 2: 확인** — `npm run check-types && cd webview-ui && npx vitest run` → PASS. 수동: 두 Claude 세션(하나는 서브에이전트 사용)과 Codex 세션 하나를 돌리고 브라우저에서 이름표·hover·손잡기·점선·❗ 를 확인, 닉네임을 `<b>x</b>` 로 저장해 글자 그대로 보이는지 확인. 스크린샷을 PR 설명에 첨부.
- [ ] **Step 3: 커밋** — `git commit -m "feat(lan): name tags, hover bubble and link lines"`

---

### Task 13: 웹뷰 — 왼쪽 드래그 이동·휠 확대/축소

**Files:**

- Create: `webview-ui/src/office/zoomAtPoint.ts`, `webview-ui/test/zoomAtPoint.test.ts`
- Modify: `webview-ui/src/office/components/OfficeCanvas.tsx` (`handleMouseDown/Move/Up`, `handleClick`, `handleWheel`)

**Interfaces:**

- Produces: `zoomAtPoint(pan: {x:number;y:number}, oldZoom: number, newZoom: number, cursor: {x:number;y:number}, viewport: {w:number;h:number}): {x:number;y:number}` — 기존 렌더러의 월드→화면 변환식(`overlayProjection`/renderer 의 offset 계산)을 따라, 커서 아래 월드 좌표가 줌 후에도 같은 화면 위치에 남도록 하는 새 pan.

- 편집 모드가 아닐 때: 왼쪽 버튼 누른 채 4px 이상 움직이면 팬 시작(`breakCameraFollow()`), 그 뒤 `click` 의 `performTap` 은 무시. 4px 미만이면 기존 클릭 동작. 가운데 버튼 팬은 유지. 편집 모드는 기존 그대로.
- 휠: 수식키 없이 줌(기존 Ctrl+휠 누적·임계값 `ZOOM_SCROLL_THRESHOLD` 로직을 기본 동작으로), 정수 단계 `ZOOM_MIN..ZOOM_MAX` 유지, `zoomAtPoint` 로 pan 보정 후 `clampPan`.

- [ ] **Step 1: 실패 테스트** — 렌더러와 같은 투영 함수로 커서 위치의 월드 좌표를 줌 전/후 계산해 차이 < 1px (줌 2→3, 3→2, 커서 화면 모서리/중앙 3케이스).
- [ ] **Step 2: 실패 확인** — `cd webview-ui && npx vitest run test/zoomAtPoint.test.ts` → FAIL
- [ ] **Step 3: 구현 (헬퍼 + 캔버스 이벤트)**
- [ ] **Step 4: 통과 확인** → PASS. 수동: 드래그 이동, 휠 확대/축소, 캐릭터 클릭 선택, 편집 모드 그리기가 모두 동작.
- [ ] **Step 5: 커밋** — `git commit -m "feat(lan): drag to pan, wheel to zoom"`

---

### Task 14: 웹뷰 — 프로필(닉네임·캐릭터)과 설정

**Files:**

- Create: `webview-ui/src/lan/ProfileModal.tsx`
- Modify: `webview-ui/src/components/SettingsModal.tsx` (원작 항목 중 훅·디렉터리·터미널 관련 제거, "내 프로필" 진입 버튼 추가), `webview-ui/src/App.tsx`

**Interfaces:**

- Consumes: `profileLoaded`/`saveProfile` (Task 9), 기존 `CharacterMugShot`, `getCharacterSprites(paletteIndex, hueShift)`
- Produces: `ProfileModal(props: { profile: Omit<Profile,'peerId'>; firstRun: boolean; onSave(p): void; onClose(): void })`

- `canEdit && nickname===''` 이면 첫 실행으로 닫을 수 없는 모달을 띄운다. `canEdit===false`(원격 구경꾼)면 프로필/설정 편집 UI 를 숨긴다.
- 항목: 닉네임(1–20자), 캐릭터 6종 미리보기 선택, 색상(hueShift 0–360 슬라이더, 미리보기 즉시 반영), "상세 내용 숨기기" 체크(설명: "켜면 파일 경로·주소·토큰 같은 민감 정보는 다른 사람에게 보내지 않습니다"), "직접 연결할 PC IP" 목록(줄바꿈 구분).
- 저장 시 `saveProfile` 전송.

- [ ] **Step 1: 구현**
- [ ] **Step 2: 확인** — `npm run check-types && npm test` → PASS. 수동: `~/.pixel-office/profile.json` 삭제 후 실행 → 첫 실행 모달, 저장 후 내 캐릭터 외형·이름표 반영, 다른 PC(또는 `http://<내IP>:47801`)에서 열면 편집 UI 없음.
- [ ] **Step 3: 커밋** — `git commit -m "feat(lan): profile and settings"`

---

### Task 15: 설치 파일 (Windows·macOS) 과 설치 안내

**Files:**

- Create: `scripts/package/node-version.txt` (Node 22 LTS 정확 버전 1줄), `scripts/package/fetch-node.mjs`, `scripts/package/windows.iss`, `scripts/package/launch.vbs`, `scripts/package/macos.sh`, `scripts/package/com.pixeloffice.agent.plist`, `.github/workflows/package.yml`, `docs/설치-안내.md`
- Modify: `esbuild.js` (fastify 계열을 번들에 포함 — `dist/` 만으로 `node_modules` 없이 실행 가능해야 함), `README.md` (상단에 이 포크 설명·설치 안내 링크, 원작 크레딧 유지)

**Interfaces:**

- Consumes: `dist/` (빌드 결과), `GET /api/ping`, `POST /api/quit`, `--open`
- Produces: `PixelOffice-Setup-<ver>.exe`, `PixelOffice-<ver>-arm64.pkg`, `PixelOffice-<ver>-x64.pkg` (GitHub Actions 아티팩트)

- 앱 구성: 공식 Node 바이너리(`fetch-node.mjs` 가 nodejs.org 에서 `node-version.txt` 버전을 내려받고 SHASUMS256 검증) + `app/`(= `dist/`).
- Windows(`windows.iss`): `PrivilegesRequired=admin`, `{autopf}\PixelOffice`. 설치 후 `netsh advfirewall firewall add rule name="Pixel Office" dir=in action=allow program="{app}\node.exe" enable=yes profile=any`. 시작프로그램(`{commonstartup}`)에 `wscript "{app}\launch.vbs"`(창 없이 `node.exe app\cli.js` 실행). 시작 메뉴 "Pixel Office 열기" = `node.exe app\cli.js --open` 를 launch.vbs 로. 설치 마지막에 실행+열기. 제거 시 `POST /api/quit` 호출 후 방화벽 규칙 삭제.
- macOS(`macos.sh`, macOS 러너에서): `/Applications/Pixel Office.app`(실행 파일은 `node app/cli.js --open` 을 띄우는 셸 스크립트, Resources 에 node·app), postinstall 이 콘솔 사용자 `~/Library/LaunchAgents/com.pixeloffice.agent.plist` 생성 후 `launchctl bootstrap gui/<uid>`. `pkgbuild` 로 arch 별 pkg.
- CI: `windows-latest`(Inno Setup `iscc`), `macos-latest`(arm64), `macos-13`(x64). 태그 `v*` 푸시 시 실행, 마지막 job 이 `gh release create <tag> <파일들> --generate-notes` 로 **GitHub Release** 에 첨부(태그에 `-rc` 가 있으면 `--prerelease`). 앱 버전은 태그에서 주입(`package.json` version 과 일치 검사).
- `docs/설치-안내.md`: Windows SmartScreen "추가 정보 → 실행" → UAC 승인; Mac "시스템 설정 → 개인정보 보호 및 보안 → 그래도 열기", 방화벽 "들어오는 연결 허용"; 같은 망인데 안 보일 때 "직접 연결할 PC IP" 사용; 회사 보안 솔루션이 막으면 IT 예외 요청. 스크린샷 자리 표시.

- [ ] **Step 1: 번들 확인** — `npm run build && rm -rf /tmp/po && cp -r dist /tmp/po && node /tmp/po/cli.js --port 47899` → 사무실이 뜸(`node_modules` 없이). 실패하면 esbuild external 조정.
- [ ] **Step 2: 스크립트·워크플로 작성**
- [ ] **Step 3: CI 실행** — `git tag v0.1.0-rc1 && git push origin main v0.1.0-rc1`. **`upstream`(원작 저장소)으로는 절대 push 하지 않는다.** 성공 기준: Release `v0.1.0-rc1` 에 세 설치 파일이 첨부됨(`gh release view v0.1.0-rc1`).
- [ ] **Step 4: 실기 검증 (사람 필요)** — Windows PC 와 Mac 에 각각 설치 → 재부팅 후 자동 실행 → 서로의 에이전트(Windows 네이티브 Claude, WSL Claude, Mac Codex)가 한 사무실에 보이고, 한쪽을 끄면 5초 안에 그 캐릭터가 사라짐. 결과를 `docs/설치-안내.md` 하단 "검증 기록"에 날짜와 함께 남김.
- [ ] **Step 5: 커밋** — `git commit -m "build: windows and macos installers"`

---

### Task 16: 업데이트 확인과 설치

**Files:**

- Create: `server/src/lan/updater.ts`, `server/__tests__/lan/updater.test.ts`, `webview-ui/src/lan/UpdateBanner.tsx`
- Modify: `server/src/cli.ts`, `server/src/clientMessageHandler.ts`, `core/asyncapi.yaml` (+ generate), `webview-ui/src/App.tsx`

**Interfaces:**

- Consumes: Task 15 의 Release 자산 이름 규칙(`PixelOffice-Setup-<ver>.exe`, `PixelOffice-<ver>-arm64.pkg`, `PixelOffice-<ver>-x64.pkg`), Task 9 `isLoopback`
- Produces:

```ts
export const RELEASES_API =
  'https://api.github.com/repos/YOOJUNGYU/pixel-office-lan/releases/latest';
export const UPDATE_CHECK_MS = 6 * 60 * 60_000;
export interface UpdateInfo {
  version: string;
  assetUrl: string;
  assetName: string;
  notesUrl: string;
}
export function isNewer(latest: string, current: string): boolean; // 'v0.2.0' > '0.1.9', prerelease 무시
export function pickAsset(
  assets: { name: string; browser_download_url: string }[],
  platform: NodeJS.Platform,
  arch: string,
): { name: string; url: string } | null;
export function checkForUpdate(
  current: string,
  fetchFn?: typeof fetch,
  platform?: NodeJS.Platform,
  arch?: string,
): Promise<UpdateInfo | null>; // 네트워크 실패 → null
export function downloadAndRun(info: UpdateInfo, dir?: string): Promise<void>; // ~/.pixel-office/updates 에 저장 후 Windows: 설치 파일 실행(`/SILENT`, UAC 는 OS 가 띄움), Mac: `open <pkg>`. 실행 직후 자기 프로세스 종료는 설치기에 맡김
```

- 서버→클라 `updateAvailable { version; notesUrl }` (핸드셰이크와 확인 시), 클라→서버 `installUpdate {}` — **loopback 만**. 다운로드 URL 은 `https://github.com/YOOJUNGYU/pixel-office-lan/releases/download/` 로 시작할 때만 허용.
- 시작 1분 뒤 첫 확인, 이후 `UPDATE_CHECK_MS` 마다.
- `UpdateBanner`: loopback 화면에만 "새 버전 v0.2.0 이 있습니다" + [업데이트] [변경 내용] 버튼.

- [ ] **Step 1: 실패 테스트** — `isNewer('v0.2.0','0.1.9')===true`, `isNewer('v0.1.0','0.1.0')===false`, `isNewer('v0.2.0-rc1','0.1.0')===false`; `pickAsset` 이 win32→`.exe`, darwin/arm64→`-arm64.pkg`, darwin/x64→`-x64.pkg`, linux→null; 가짜 `fetchFn` 이 404/예외면 `checkForUpdate` → null; 허용 prefix 밖 URL 은 `downloadAndRun` 이 reject.
- [ ] **Step 2: 실패 확인** — `cd server && npx vitest run __tests__/lan/updater.test.ts` → FAIL
- [ ] **Step 3: 구현** (Node 내장 `fetch` 사용)
- [ ] **Step 4: 통과 확인** → PASS. 실기: `v0.1.0-rc1` 설치 PC 에서 `v0.1.0-rc2` Release 후 배너 → 업데이트 → 새 버전 실행 확인(rc 는 `isNewer` 에서 무시되므로 이 검증만 `PIXEL_OFFICE_ALLOW_PRERELEASE=1` 환경변수로 허용).
- [ ] **Step 5: 커밋** — `git commit -m "feat: update check via github releases"`
