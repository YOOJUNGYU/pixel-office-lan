// Per-viewer UI language (Korean / English). No server round-trip: the choice
// lives in this browser's localStorage.
import { useSyncExternalStore } from 'react';

import type { Act, Lang, Room } from '../../core/src/lan.js';
import { ROOM_LABELS } from '../../core/src/lan.js';
import { LANG_STORAGE_KEY } from './constants.js';

const ko = {
  'room.coding': '코딩실',
  'room.library': '자료실',
  'room.server': '서버실',
  'room.lounge': '대기실',

  'act.idle': '대기 중',
  'act.edit': '{t} 수정 중',
  'act.edit.empty': '파일 수정 중',
  'act.read': '{t} 읽는 중',
  'act.search': '"{t}" 검색 중',
  'act.find': '"{t}" 파일 찾는 중',
  'act.web': '웹 검색: {t}',
  'act.web.empty': '웹 검색 중',
  'act.fetch': '{t} 보는 중',
  'act.mcp': '{t} 사용 중',
  'act.run': '명령 실행: {t}',
  'act.delegate': '서브에이전트에게 맡김: {t}',
  'act.ask': '답변 기다리는 중',
  'act.image': '이미지 보는 중',
  'act.tool': '{t} 사용 중',

  'bubble.permission': '확인 필요',
  'legend.title': '방 안내',
  'legend.coding': '파일을 직접 고칠 때 (Edit·Write, Codex apply_patch)',
  'legend.library':
    '파일 읽기·코드 검색·웹 검색 (Read·Grep·WebSearch, rg·cat·git log 같은 읽기 명령)',
  'legend.server': '명령 실행 — 빌드·테스트·설치·서버 (Bash, Codex 셸), 백그라운드 셸',
  'legend.lounge': '입력·승인 대기, 작업 끝남 (머리 위 빨간 ! = 확인 필요)',
  'tour.roomLegend.title': '방 안내',
  'tour.roomLegend.body':
    '어떤 일을 하면 어느 방으로 가는지 여기서 언제든 볼 수 있습니다. 제목을 누르면 접히고 펼쳐집니다.',
  'app.restarting': '새 버전으로 다시 시작합니다…',
  'people.title': '접속 중 {n}명',
  'people.you': '(나)',
  'people.noAgents': '에이전트 없음',
  'people.retry': '잠시 후 다시 시도',
  'people.show': '접속자 목록 펼치기',
  'people.hide': '접속자 목록 접기',
  'people.status.attention': '확인을 기다림',
  'people.status.working': '작업 중',
  'people.status.idle': '쉬는 중',
  'nickname.conflict':
    '이 닉네임은 다른 PC가 먼저 쓰고 있었습니다. 다른 사람에게는 내 닉네임 뒤에 짧은 구분 표시가 붙어 보이니 닉네임을 바꿔 주세요.',
  'nickname.change': '닉네임 바꾸기',
  'profile.nicknameTaken': '이미 사용 중인 닉네임입니다',

  'app.loading': '불러오는 중…',
  'app.readOnly': '보기 전용',
  'app.rotateHint': '회전 (R)',
  'app.importConfirm': '현재 레이아웃을 바꿀까요? 저장하지 않은 편집은 사라집니다.',
  'app.resetDefaultConfirm':
    '기본 사무실(90×60)로 바꿀까요? 지금 배치는 사라집니다(먼저 내보내기로 저장해 둘 수 있습니다).',
  'settings.resetDefaultLayout': '기본 사무실로 되돌리기',
  'app.resetEditorConfirm': '기본 레이아웃으로 되돌릴까요? 직접 꾸민 내용이 모두 사라집니다.',
  'app.importInvalid': '올바른 레이아웃 파일이 아닙니다.',
  'app.layoutSaveRejected': '레이아웃을 저장하지 못했습니다 (올바르지 않은 레이아웃).',
  'app.layoutSaveTimeout': '레이아웃 저장 응답이 없습니다. 서버 연결을 확인해 주세요.',
  'app.importFailed': '레이아웃 파일을 읽지 못했습니다.',

  'conn.connecting': '연결 중…',
  'conn.reconnecting': '다시 연결 중…',
  'conn.disconnected': '연결 끊김',

  'toolbar.layout': '레이아웃',
  'toolbar.layoutTitle': '사무실 배치 편집',
  'toolbar.settings': '설정',

  'settings.profile': '내 프로필',
  'settings.export': '레이아웃 내보내기',
  'settings.import': '레이아웃 가져오기',
  'settings.sound': '알림 소리',
  'settings.autostart': '로그인할 때 자동 실행',
  'settings.showAreas': '방 영역 표시',
  'settings.language': '언어 / Language',
  'settings.theme': '테마 / Theme',
  'theme.dark': '다크',
  'theme.light': '라이트',
  'theme.system': '시스템',
  'settings.checkUpdate': '업데이트 확인',
  'settings.offices': '오피스',

  'office.label': '오피스',
  'office.public': '🌐 공개 오피스',
  'office.unnamed': '이름 모를 팀',
  'office.publicDisabled': '팀 오피스에 있는 동안은 공개 오피스에 보이지 않습니다',
  'office.create': '팀 오피스 만들기',
  'office.namePlaceholder': '팀 이름 (1–20자)',
  'office.createButton': '만들기',
  'office.shareHint': '이 코드를 팀원에게 공유하세요',
  'office.copy': '코드 복사',
  'office.copied': '복사됨',
  'office.join': '코드로 참여',
  'office.joinNamePlaceholder': '팀 이름 (선택)',
  'office.joinButton': '참여',
  'office.list': '내 팀 오피스',
  'office.none': '아직 팀 오피스가 없습니다',
  'office.leave': '나가기',
  'office.leaveConfirm': '"{name}" 팀 오피스에서 나갈까요? 다시 들어오려면 코드가 필요합니다.',
  'office.leftPublic': '공개 오피스에서 나왔습니다 — 이제 팀 오피스에서만 보입니다',
  'office.error.invalidCode': '코드가 올바르지 않습니다. 다시 확인하세요.',
  'office.error.alreadyJoined': '이미 참여 중인 팀 오피스라 그 오피스로 전환했습니다.',
  'office.error.nameInvalid': '팀 이름은 1–20자여야 합니다.',
  'office.error.full': '팀 오피스는 10개까지 참여할 수 있습니다.',

  'update.available': '새 버전 v{v} 이 있습니다',
  'update.install': '업데이트',
  'update.notes': '변경 내용',
  'update.close': '닫기',
  'update.downloading': '내려받는 중… {p}%',
  'update.installing': '설치 프로그램을 실행했습니다. 화면의 안내를 따라 주세요.',
  'update.error': '업데이트하지 못했습니다.',
  'update.retry': '다시 시도',
  'update.upToDate': '최신 버전입니다.',

  'install.title': 'Pixel Office 를 앱으로 설치하세요',
  'install.body': 'Windows 에서는 바로가기가 탭이 아닌 앱 창으로 엽니다.',
  'install.install': '설치',
  'install.later': '나중에',
  'install.safari': 'Safari: 공유 → Dock에 추가 (Mac) / 홈 화면에 추가 (iPhone·iPad)',
  'install.other':
    '이 브라우저는 앱 설치를 지원하지 않습니다. Edge 나 Chrome 으로 열면 설치할 수 있어요.',

  'zoom.in': '확대 (마우스 휠)',
  'zoom.out': '축소 (마우스 휠)',

  'edit.undo': '실행 취소',
  'edit.undoTitle': '실행 취소 (Ctrl+Z)',
  'edit.redo': '다시 실행',
  'edit.redoTitle': '다시 실행 (Ctrl+Y)',
  'edit.save': '저장',
  'edit.saveTitle': '저장하고 편집 닫기',
  'edit.reset': '되돌리기',
  'edit.resetTitle': '기본 레이아웃으로 되돌리기',

  'profile.title': '내 프로필',
  'profile.firstRunTitle': '프로필 만들기',
  'profile.account': 'PC 계정',
  'profile.accountFixed': '— 바꿀 수 없음',
  'profile.nickname': '닉네임 (선택)',
  'profile.nicknamePlaceholder': '계정 이름 옆에 함께 보이는 이름',
  'profile.nicknameHint': '비워 두면 PC 계정 이름({account})만 표시됩니다',
  'profile.nicknameTooLong': '닉네임은 20자 이하여야 합니다.',
  'profile.character': '캐릭터',
  'profile.pet.claudio': '클로디오 (반려동물)',
  'profile.pet.gitcat': '깃캣 (반려동물)',
  'profile.color': '색상',
  'profile.hideDetails': '상세 내용 숨기기',
  'profile.hideDetailsHint':
    '켜면 파일 경로·주소·토큰 같은 민감 정보는 다른 사람에게 보내지 않습니다',
  'profile.manualPeers': '직접 연결할 PC IP',
  'profile.advanced': '고급: 자동으로 안 보일 때',
  'profile.manualPeersHint':
    '같은 망의 PC는 자동으로 보입니다. 다른 층이나 망에 있는 PC만 IP를 적으세요. (한 줄에 하나씩)',
  'profile.manualPeersTooMany': '직접 연결 PC는 20개까지 입력할 수 있습니다.',
  'profile.manualPeersInvalid': 'IP 또는 PC 이름만 입력하세요 (포트·http:// 없이): {list}',
  'profile.saveRejected': '저장하지 못했습니다. 입력을 확인하고 다시 저장하세요.',
  'profile.save': '저장',

  'editor.furniture': '가구',
  'editor.furnitureTitle': '가구 놓기',
  'editor.floor': '바닥',
  'editor.floorTitle': '바닥 타일 칠하기',
  'editor.walls': '벽',
  'editor.wallsTitle': '벽 칠하기 (클릭으로 켜고 끄기)',
  'editor.background': '배경',
  'editor.backgroundTitle': '사무실 바깥 배경 바꾸기',
  'editor.background.color': '단색',
  'editor.background.floor': '바닥',
  'editor.background.carpet': '카펫',
  'editor.backgroundHint': '지금은 기본 배경입니다. 종류를 고르세요.',
  'editor.erase': '지우기',
  'editor.eraseTitle': '타일을 빈 공간으로 지우기',
  'editor.copy': '복사',
  'editor.color': '색상',
  'editor.contrast': '대비',
  'editor.copyFloorTitle': '기존 타일의 바닥 무늬와 색상 복사',
  'editor.floorColorTitle': '바닥 색상 조정',
  'editor.floorItem': '바닥 {t}',
  'editor.wallColorTitle': '벽 색상 조정',
  'editor.wallItem': '벽 {t}',
  'editor.carpet': '카펫',
  'editor.carpetTitle': '카펫 칠하기',
  'editor.carpetItem': '카펫 {t}',
  'editor.carpetColorTitle': '카펫 기본색 + 강조색 조정',
  'editor.furnitureColorTitle': '새 가구 색상 조정',
  'editor.copyCarpetTitle': '기존 타일의 카펫 종류와 색상 복사 (P)',
  'editor.copyFurnitureTitle': '놓인 가구의 종류 복사',
  'editor.main': '기본',
  'editor.accent': '강조',
  'editor.emptyRoom': '{room} 영역이 비어 있어 이 방에 갈 에이전트가 아무 곳에나 앉습니다',

  'category.desks': '책상',
  'category.chairs': '의자',
  'category.storage': '수납',
  'category.electronics': '전자기기',
  'category.decor': '장식',
  'category.wall': '벽걸이',
  'category.misc': '기타',

  'color.hue': '색조',
  'color.saturation': '채도',
  'color.brightness': '밝기',
  'color.colorize': '색 입히기',
  'color.colorizeTitle': '색 입히기 모드 켜기/끄기',
  'color.copyTitle': '다른 물건의 색상 복사 — 사무실에서 하나를 클릭하세요',
  'color.reset': '초기화',
  'color.resetTitle': '기본값으로 되돌리기',
  'settings.replayTour': '사용법 다시 보기',

  'tour.skip': '건너뛰기',
  'tour.prev': '이전',
  'tour.next': '다음',
  'tour.finish': '시작하기',
  'tour.demo.a': 'minji',
  'tour.demo.b': 'junho',
  'tour.demo.c': 'seoyeon',
  'tour.demo.d': 'doyoon',
  'tour.demo.editReason': '로그인 버그 고치는 중',
  'tour.demo.readReason': 'API 문서 확인',
  'tour.demo.waitReason': '배포 명령을 실행해도 될까요?',
  'tour.welcome.title': 'Pixel Office LAN 에 오신 걸 환영합니다',
  'tour.welcome.body':
    '같은 망의 PC들에서 돌고 있는 Claude Code · Codex 에이전트가 이 픽셀 사무실의 캐릭터로 나타납니다.',
  'tour.welcome.bodyDemo':
    '같은 망의 PC들에서 돌고 있는 Claude Code · Codex 에이전트가 이 픽셀 사무실의 캐릭터로 나타납니다.\n지금 보이는 캐릭터 중 일부는 안내용 예시이며, 안내가 끝나면 사라집니다.',
  'tour.roomCoding.title': '코딩실',
  'tour.roomCoding.body':
    '에이전트는 하는 일에 따라 방을 옮겨 다닙니다. 파일을 고치거나 쓰는 동안은 코딩실 책상에 앉아 있습니다.',
  'tour.roomLibrary.title': '자료실',
  'tour.roomLibrary.body': '파일을 읽거나 검색하고, 웹을 찾아볼 때는 자료실로 갑니다.',
  'tour.roomLibrary.bodyDemo':
    '파일을 읽거나 검색하고, 웹을 찾아볼 때는 자료실로 갑니다. 지금 캐릭터 하나가 걸어가는 게 보이죠?',
  'tour.roomServer.title': '서버실',
  'tour.roomServer.body': '명령을 실행하거나 테스트·빌드를 돌릴 때는 서버실에서 일합니다.',
  'tour.roomLounge.title': '대기실',
  'tour.roomLounge.body':
    '할 일을 기다리거나 확인을 기다릴 때는 대기실에서 쉽니다.\n방 이동은 3초 정도 상태가 이어져야 일어나서, 잠깐씩 바뀌는 작업에 캐릭터가 왔다 갔다 하지 않습니다.',
  'tour.tag.title': '이름표',
  'tour.tag.body':
    '캐릭터 아래 이름표는 두 줄입니다. 윗줄은 "PC 계정 (닉네임)", 아랫줄은 "Claude/Codex #번호" 예요. 닉네임은 정한 사람만 보입니다. 아랫줄 앞의 색 점은 제공자예요 — 주황은 Claude, 초록은 Codex.\n메인 에이전트는 아랫줄 끝에 MAIN 배지가, 서브에이전트와 셸은 부모의 이름표 아랫줄 끝에 SUB / SHELL 배지가 붙습니다.',
  'tour.bubble.title': '말풍선',
  'tour.bubble.body':
    '캐릭터에 마우스를 올리면 어느 방에서 무엇을 하는지, 그리고 이유가 보입니다.\n머리 위 빨간 ! 는 사용자의 확인(권한 승인이나 답변)을 기다린다는 뜻입니다.',
  'tour.family.title': '서브에이전트와 셸',
  'tour.family.body':
    '에이전트가 만든 서브에이전트와 셸은 같은 방에 있는 부모와 손을 잡고 다닙니다.\n다른 방에서 일하는 아이는 그 방에서 따로 일합니다.',
  'tour.map.title': '지도 움직이기',
  'tour.map.body':
    '드래그로 지도를 옮기고, 휠로 커서 위치를 중심으로 확대·축소합니다. 왼쪽 위 + / − 버튼도 됩니다.\n지금 직접 해 보세요 — 다음으로 넘어가면 원래 화면으로 돌아옵니다.',
  'tour.map.bodyTouch':
    '한 손가락으로 끌어 지도를 옮기고, 두 손가락으로 벌리거나 오므려 확대·축소합니다.\n지금 직접 해 보세요 — 다음으로 넘어가면 원래 화면으로 돌아옵니다.',
  'tour.switcher.title': '오피스 전환',
  'tour.switcher.body':
    '🌐 공개 오피스에는 같은 망의 모든 PC가 보입니다. 🔒 팀 오피스는 코드를 가진 팀원끼리만 보입니다.\n팀 오피스에 참여한 PC는 공개 오피스에서 빠집니다.',
  'tour.people.title': '접속 중인 사람',
  'tour.people.body':
    '지금 이 오피스에 접속한 사람이 모두 보입니다. 에이전트가 없는 사람도요.\n❗ 는 확인을 기다리는 에이전트가 있다는 뜻입니다. 이름을 누르면 그 사람의 에이전트로 화면이 따라갑니다.',
  'tour.settingsButton.title': '설정',
  'tour.settingsButton.body': '언어, 테마, 프로필, 팀 오피스 같은 설정은 모두 여기에 있습니다.',
  'tour.language.title': '언어 · 테마',
  'tour.language.body':
    '화면 언어와 다크/라이트 테마는 브라우저마다 따로 고릅니다. 다른 PC의 에이전트 활동도 내가 고른 언어로 보입니다.',
  'tour.profile.title': '내 프로필',
  'tour.profile.body':
    '이 PC 에이전트들의 캐릭터(사람 6종 또는 펫 Claudio · Gitcat)와 색, 선택 닉네임을 정합니다. 이름은 항상 PC 계정 이름이 먼저 보이고, 계정 이름은 바꿀 수 없습니다.\n"상세 내용 숨기기" 를 켜면 다른 사람에게는 파일 이름이나 이유 없이 방과 활동 종류만 보입니다.',
  'tour.offices.title': '팀 오피스',
  'tour.offices.body':
    '팀 이름을 정해 만들면 초대 코드(PO2-…)가 나옵니다. 팀원은 그 코드로 참여합니다.\n팀 오피스의 내용은 팀원끼리만 암호화되어 오가고, 언제든 나갈 수 있습니다.',
  'tour.system.title': '자동 실행 · 업데이트',
  'tour.system.body':
    '로그인할 때 자동으로 켜지게 하거나, 새 버전이 있는지 바로 확인할 수 있습니다. 새 버전이 나오면 화면에 알림도 뜹니다.',
  'tour.system.bodyNoAutostart':
    '새 버전이 있는지 바로 확인할 수 있습니다. 새 버전이 나오면 화면에 알림도 뜹니다.',
  'tour.layoutButton.title': '레이아웃 편집',
  'tour.layoutButton.body': '사무실 배치를 직접 꾸밀 수 있습니다. 편집기를 열어 볼게요.',
  'tour.floor.title': '바닥',
  'tour.floor.body':
    '바닥 무늬를 고르고 색을 정해 타일 위를 칠합니다. [복사] 로 이미 칠해진 바닥을 집어 올 수도 있습니다.',
  'tour.walls.title': '벽',
  'tour.walls.body': '벽 모양과 색을 고르고, 칠해서 세우거나 다시 클릭해 없앱니다.',
  'tour.furniture.title': '가구',
  'tour.furniture.body':
    '목록에서 골라 놓고, 드래그로 옮기고, Alt+드래그로 복사합니다.\nR 은 회전, T 는 켜기/끄기(모니터 등), 색 버튼으로 색을 바꿉니다. 카펫도 여기 있습니다.',
  'tour.background.title': '배경',
  'tour.background.body': '사무실 바깥을 단색, 바닥 무늬, 카펫 무늬 중 하나로 채웁니다.',
  'tour.editorMore.title': '지우기 · 실행 취소',
  'tour.editorMore.body':
    '[지우기] 로 타일을 지울 수 있습니다. Ctrl+Z / Ctrl+Y 로 실행 취소 · 다시 실행.\n배치를 바꿔도 캐릭터는 있던 자리에 그대로 있습니다.',
  'tour.save.title': '저장',
  'tour.save.body':
    '배치는 이 PC 에만 저장되고(공개·팀 오피스 모두), 다른 PC 의 화면은 바뀌지 않습니다. 편집한 내용은 바로바로 저장되고, [레이아웃] 버튼 옆 막대의 [저장] 은 저장한 뒤 편집을 닫습니다. [되돌리기] 는 확인 후 기본 레이아웃으로 되돌리고 편집을 닫습니다(직접 꾸민 내용은 사라집니다).\n배치를 나눠 쓰려면 설정 → [레이아웃 내보내기] 로 파일을 만들어 건네고, 받은 사람은 [레이아웃 가져오기] 로 엽니다.',
  'tour.install.title': '앱으로 설치',
  'tour.install.body':
    '이 PC의 브라우저에서는 Pixel Office 를 앱으로 설치할 수 있습니다(Edge·Chrome). 설치하면 바로가기가 탭이 아닌 앱 창으로 열립니다.\n안내 창을 닫았다면 주소창의 설치 아이콘을 쓰세요.',
  'tour.done.title': '준비 끝!',
  'tour.done.body':
    '이제 에이전트를 실행하면 사무실에 나타납니다.\n이 안내는 설정 → "사용법 다시 보기" 에서 언제든 다시 볼 수 있습니다.',
  'tour.done.bodyDemo':
    '이제 에이전트를 실행하면 사무실에 나타납니다. 안내 캐릭터는 사라집니다.\n이 안내는 설정 → "사용법 다시 보기" 에서 언제든 다시 볼 수 있습니다.',
};

export type Key = keyof typeof ko;

const en: Record<Key, string> = {
  'room.coding': 'Coding Room',
  'room.library': 'Library',
  'room.server': 'Server Room',
  'room.lounge': 'Lounge',

  'act.idle': 'Idle',
  'act.edit': 'Editing {t}',
  'act.edit.empty': 'Editing a file',
  'act.read': 'Reading {t}',
  'act.search': 'Searching "{t}"',
  'act.find': 'Finding files "{t}"',
  'act.web': 'Web search: {t}',
  'act.web.empty': 'Searching the web',
  'act.fetch': 'Viewing {t}',
  'act.mcp': 'Using {t}',
  'act.run': 'Running: {t}',
  'act.delegate': 'Delegating: {t}',
  'act.ask': 'Waiting for your answer',
  'act.image': 'Viewing an image',
  'act.tool': 'Using {t}',

  'bubble.permission': 'Needs attention',
  'legend.title': 'Rooms',
  'legend.coding': 'Editing files',
  'legend.library': 'Reading, searching code and the web (incl. read-only shell commands)',
  'legend.server': 'Running commands — build, test, install, servers; background shells',
  'legend.lounge': 'Waiting for input/approval or done (red ! = needs you)',
  'tour.roomLegend.title': 'Rooms',
  'tour.roomLegend.body':
    'Which activity sends an agent to which room, any time. Click the title to fold or unfold it.',
  'app.restarting': 'Restarting into the new version…',
  'people.title': '{n} online',
  'people.you': '(you)',
  'people.noAgents': 'No agents',
  'people.retry': 'Try again in a moment',
  'people.show': 'Show who is online',
  'people.hide': 'Hide who is online',
  'people.status.attention': 'Needs attention',
  'people.status.working': 'Working',
  'people.status.idle': 'Idle',
  'nickname.conflict':
    'Another PC was using this nickname first. Others see yours with a short tag after it, so please change your nickname.',
  'nickname.change': 'Change nickname',
  'profile.nicknameTaken': 'This nickname is already taken',

  'app.loading': 'Loading…',
  'app.readOnly': 'View only',
  'app.rotateHint': 'Rotate (R)',
  'app.importConfirm': 'Replace the current layout? Unsaved edits will be lost.',
  'app.resetDefaultConfirm':
    'Switch to the default office (90×60)? The current layout will be lost (export it first to keep a copy).',
  'settings.resetDefaultLayout': 'Reset to the default office',
  'app.resetEditorConfirm': 'Reset to the default layout? All your customizations will be lost.',
  'app.importInvalid': 'This is not a valid layout file.',
  'app.layoutSaveRejected': 'The layout was not saved (not a valid layout).',
  'app.layoutSaveTimeout': 'No answer to the layout save. Check the server connection.',
  'app.importFailed': 'Could not read the layout file.',

  'conn.connecting': 'Connecting…',
  'conn.reconnecting': 'Reconnecting…',
  'conn.disconnected': 'Disconnected',

  'toolbar.layout': 'Layout',
  'toolbar.layoutTitle': 'Edit the office layout',
  'toolbar.settings': 'Settings',

  'settings.profile': 'My profile',
  'settings.export': 'Export layout',
  'settings.import': 'Import layout',
  'settings.sound': 'Notification sound',
  'settings.autostart': 'Start at login',
  'settings.showAreas': 'Show room areas',
  'settings.language': '언어 / Language',
  'settings.theme': '테마 / Theme',
  'theme.dark': 'Dark',
  'theme.light': 'Light',
  'theme.system': 'System',
  'settings.checkUpdate': 'Check for updates',
  'settings.offices': 'Offices',

  'office.label': 'Office',
  'office.public': '🌐 Public office',
  'office.unnamed': 'Unnamed team',
  'office.publicDisabled': "While you're in a team office you are not shown in the public office",
  'office.create': 'Create a team office',
  'office.namePlaceholder': 'Team name (1–20 chars)',
  'office.createButton': 'Create',
  'office.shareHint': 'Share this code with your teammates',
  'office.copy': 'Copy code',
  'office.copied': 'Copied',
  'office.join': 'Join with a code',
  'office.joinNamePlaceholder': 'Team name (optional)',
  'office.joinButton': 'Join',
  'office.list': 'Your team offices',
  'office.none': 'No team offices yet',
  'office.leave': 'Leave',
  'office.leaveConfirm': 'Leave the "{name}" team office? You will need the code to come back.',
  'office.leftPublic': "You left the public office — you're now only visible in team offices",
  'office.error.invalidCode': 'That code is not valid. Check it and try again.',
  'office.error.alreadyJoined': 'You are already in this team office — switched to it.',
  'office.error.nameInvalid': 'Team name must be 1–20 characters.',
  'office.error.full': 'You can be in up to 10 team offices.',

  'update.available': 'Version v{v} is available',
  'update.install': 'Update',
  'update.notes': "What's new",
  'update.close': 'Close',
  'update.downloading': 'Downloading… {p}%',
  'update.installing': 'The installer is running. Follow the steps on screen.',
  'update.error': 'The update failed.',
  'update.retry': 'Retry',
  'update.upToDate': 'You are up to date.',

  'install.title': 'Install Pixel Office as an app',
  'install.body': 'On Windows, shortcuts then open it in its own app window instead of a tab.',
  'install.install': 'Install',
  'install.later': 'Later',
  'install.safari': 'Safari: Share → Add to Dock (Mac) / Add to Home Screen (iPhone·iPad)',
  'install.other': "This browser can't install apps. Open it in Edge or Chrome to install.",

  'zoom.in': 'Zoom in (mouse wheel)',
  'zoom.out': 'Zoom out (mouse wheel)',

  'edit.undo': 'Undo',
  'edit.undoTitle': 'Undo (Ctrl+Z)',
  'edit.redo': 'Redo',
  'edit.redoTitle': 'Redo (Ctrl+Y)',
  'edit.save': 'Save',
  'edit.saveTitle': 'Save and close the editor',
  'edit.reset': 'Reset',
  'edit.resetTitle': 'Reset to the default layout',

  'profile.title': 'My profile',
  'profile.firstRunTitle': 'Create your profile',
  'profile.account': 'PC account',
  'profile.accountFixed': '— cannot be changed',
  'profile.nickname': 'Nickname (optional)',
  'profile.nicknamePlaceholder': 'Shown next to your account name',
  'profile.nicknameHint': 'Leave empty to show only your PC account name ({account})',
  'profile.nicknameTooLong': 'Nickname must be 20 characters or fewer.',
  'profile.character': 'Character',
  'profile.pet.claudio': 'Claudio (pet)',
  'profile.pet.gitcat': 'Gitcat (pet)',
  'profile.color': 'Color',
  'profile.hideDetails': 'Hide details',
  'profile.hideDetailsHint':
    'When on, sensitive info such as file paths, addresses and tokens is never sent to others',
  'profile.manualPeers': 'PC IPs to connect directly',
  'profile.advanced': "Advanced: when a PC isn't found automatically",
  'profile.manualPeersHint':
    'PCs on the same network appear automatically. Only add IPs of PCs on another floor or network. (One per line)',
  'profile.manualPeersTooMany': 'You can enter up to 20 PCs.',
  'profile.manualPeersInvalid': 'Enter only an IP or PC name (no port or http://): {list}',
  'profile.saveRejected': 'Could not save. Check your input and save again.',
  'profile.save': 'Save',

  'editor.furniture': 'Furniture',
  'editor.furnitureTitle': 'Place furniture',
  'editor.floor': 'Floor',
  'editor.floorTitle': 'Paint floor tiles',
  'editor.walls': 'Walls',
  'editor.wallsTitle': 'Paint walls (click to toggle)',
  'editor.background': 'Background',
  'editor.backgroundTitle': 'Change the background around the office',
  'editor.background.color': 'Color',
  'editor.background.floor': 'Floor',
  'editor.background.carpet': 'Carpet',
  'editor.backgroundHint': 'Using the default background. Pick a kind.',
  'editor.erase': 'Erase',
  'editor.eraseTitle': 'Erase tiles to void',
  'editor.copy': 'Copy',
  'editor.color': 'Color',
  'editor.contrast': 'Contrast',
  'editor.copyFloorTitle': 'Copy floor pattern + color from existing tile',
  'editor.floorColorTitle': 'Adjust floor color',
  'editor.floorItem': 'Floor {t}',
  'editor.wallColorTitle': 'Adjust wall color',
  'editor.wallItem': 'Wall {t}',
  'editor.carpet': 'Carpet',
  'editor.carpetTitle': 'Paint carpets',
  'editor.carpetItem': 'Carpet {t}',
  'editor.carpetColorTitle': 'Adjust carpet main + accent colors',
  'editor.furnitureColorTitle': 'Adjust color for new furniture',
  'editor.copyCarpetTitle': 'Copy carpet variant + colors from existing tile (P)',
  'editor.copyFurnitureTitle': 'Copy furniture type from placed item',
  'editor.main': 'Main',
  'editor.accent': 'Accent',
  'editor.emptyRoom': 'The {room} area is empty, so agents headed there sit anywhere',

  'category.desks': 'Desks',
  'category.chairs': 'Chairs',
  'category.storage': 'Storage',
  'category.electronics': 'Tech',
  'category.decor': 'Decor',
  'category.wall': 'Wall',
  'category.misc': 'Misc',

  'color.hue': 'Hue',
  'color.saturation': 'Saturation',
  'color.brightness': 'Brightness',
  'color.colorize': 'Colorize',
  'color.colorizeTitle': 'Toggle colorize mode',
  'color.copyTitle': 'Copy color from another item — click one in the office',
  'color.reset': 'Reset',
  'color.resetTitle': 'Reset to default',
  'settings.replayTour': 'Replay tour',

  'tour.skip': 'Skip',
  'tour.prev': 'Back',
  'tour.next': 'Next',
  'tour.finish': 'Get started',
  'tour.demo.a': 'mina',
  'tour.demo.b': 'jun',
  'tour.demo.c': 'sara',
  'tour.demo.d': 'leo',
  'tour.demo.editReason': 'Fixing the login bug',
  'tour.demo.readReason': 'Checking the API docs',
  'tour.demo.waitReason': 'OK to run the deploy command?',
  'tour.welcome.title': 'Welcome to Pixel Office LAN',
  'tour.welcome.body':
    'Claude Code and Codex agents running on the PCs of your network show up as characters in this pixel office.',
  'tour.welcome.bodyDemo':
    'Claude Code and Codex agents running on the PCs of your network show up as characters in this pixel office.\nSome characters you see now are examples for this tour; they leave when it ends.',
  'tour.roomCoding.title': 'Coding room',
  'tour.roomCoding.body':
    'Agents move between rooms by what they are doing. While editing or writing files they sit at a desk in the coding room.',
  'tour.roomLibrary.title': 'Library',
  'tour.roomLibrary.body':
    'Reading, searching files or browsing the web takes them to the library.',
  'tour.roomLibrary.bodyDemo':
    'Reading, searching files or browsing the web takes them to the library. See the character walking over?',
  'tour.roomServer.title': 'Server room',
  'tour.roomServer.body': 'Running commands, tests or builds happens in the server room.',
  'tour.roomLounge.title': 'Lounge',
  'tour.roomLounge.body':
    'Idle agents, and agents waiting for you, rest in the lounge.\nA move only happens after the new activity lasts about 3 seconds, so characters do not bounce around on quick tasks.',
  'tour.tag.title': 'Name tags',
  'tour.tag.body':
    'The tag under a character has two lines: "PC account (nickname)" on top, "Claude/Codex #number" below; the nickname only when one is set. The dot before line 2 is the provider: orange = Claude, green = Codex.\nMain agents get a MAIN badge at the end of line 2; subagents and shells show their parent\'s tag with a SUB / SHELL badge.',
  'tour.bubble.title': 'Hover bubble',
  'tour.bubble.body':
    'Hover a character to see its room, what it is doing and why.\nA red ! over its head means it is waiting for you (a permission or an answer).',
  'tour.family.title': 'Subagents and shells',
  'tour.family.body':
    'Subagents and shells an agent starts walk hand in hand with it while they are in the same room.\nOne working in another room acts on its own there.',
  'tour.map.title': 'Moving the map',
  'tour.map.body':
    'Drag to pan, scroll to zoom at the cursor, or use the + / − buttons at the top left.\nTry it now — the view goes back when you continue.',
  'tour.map.bodyTouch':
    'Drag with one finger to pan, pinch with two to zoom.\nTry it now — the view goes back when you continue.',
  'tour.switcher.title': 'Office switcher',
  'tour.switcher.body':
    '🌐 The public office shows every PC on the network. 🔒 A team office is shared only by teammates who have its code.\nA PC in a team office leaves the public office.',
  'tour.people.title': "Who's online",
  'tour.people.body':
    "Everyone connected to this office is listed here, even people with no agents.\n❗ means one of their agents is waiting for them. Click a name and the view follows that person's agent.",
  'tour.settingsButton.title': 'Settings',
  'tour.settingsButton.body': 'Language, theme, profile, team offices and more live here.',
  'tour.language.title': 'Language & theme',
  'tour.language.body':
    'Each browser picks its own language and dark/light theme. Activity of agents on other PCs is shown in your language too.',
  'tour.profile.title': 'My profile',
  'tour.profile.body':
    'Character (six people or the pets Claudio and Gitcat), color and optional nickname of this PC’s agents. Your PC account name always shows first and cannot be changed.\n"Hide details" shows others only the room and the kind of activity — no file names or reasons.',
  'tour.offices.title': 'Team offices',
  'tour.offices.body':
    'Create a team to get an invite code (PO2-…); teammates join with it.\nA team office is encrypted between its members, and you can leave any time.',
  'tour.system.title': 'Start at login · Updates',
  'tour.system.body':
    'Start Pixel Office when you log in, or check for a new version right away. New versions are also announced on screen.',
  'tour.system.bodyNoAutostart':
    'Check for a new version right away. New versions are also announced on screen.',
  'tour.layoutButton.title': 'Layout editor',
  'tour.layoutButton.body': 'Arrange the office yourself. Let’s open the editor.',
  'tour.floor.title': 'Floor',
  'tour.floor.body':
    'Pick a floor pattern and a color, then paint tiles. [Copy] picks up an already painted floor.',
  'tour.walls.title': 'Walls',
  'tour.walls.body':
    'Pick a wall style and color; paint to build walls, click again to remove them.',
  'tour.furniture.title': 'Furniture',
  'tour.furniture.body':
    'Pick an item and place it, drag to move, Alt+drag to copy.\nR rotates, T toggles (monitors…), the color button recolors. Carpets live here too.',
  'tour.background.title': 'Background',
  'tour.background.body':
    'Fill the outside of the office with a solid color, a floor pattern or a carpet.',
  'tour.editorMore.title': 'Erase · Undo',
  'tour.editorMore.body':
    'Clear tiles with [Erase]. Ctrl+Z / Ctrl+Y undo and redo.\nChanging the layout never moves the characters.',
  'tour.save.title': 'Save',
  'tour.save.body':
    'The layout is saved on this PC only (public and team offices alike); other PCs’ screens do not change. Every edit is saved right away; [Save] in the bar next to [Layout] saves and closes the editor, and [Reset] asks first, then restores the default layout and closes the editor (your customizations are lost).\nTo share a layout, make a file with Settings → [Export layout] and hand it over; the other person opens it with [Import layout].',
  'tour.install.title': 'Install as an app',
  'tour.install.body':
    'On this PC’s browser you can install Pixel Office as an app (Edge, Chrome). Shortcuts then open it in its own window instead of a tab.\nIf you closed the prompt, use the install icon in the address bar.',
  'tour.done.title': 'All set!',
  'tour.done.body':
    'Start an agent and it walks into the office.\nReplay this tour any time from Settings → "Replay tour".',
  'tour.done.bodyDemo':
    'Start an agent and it walks into the office. The tour characters leave now.\nReplay this tour any time from Settings → "Replay tour".',
};

export const DICT: Record<Lang, Record<Key, string>> = { ko, en };
export const LANG_NAMES: Record<Lang, string> = { ko: '한국어', en: 'English' };

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    if (saved === 'ko' || saved === 'en') return saved;
  } catch {
    /* storage blocked: fall through */
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ko')
    ? 'ko'
    : 'en';
}

let lang: Lang = initialLang();
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return lang;
}

export function setLang(next: Lang): void {
  lang = next;
  try {
    localStorage.setItem(LANG_STORAGE_KEY, next);
  } catch {
    /* not persisted; still applies for this page */
  }
  for (const l of listeners) l();
}

/** Current language; re-renders the calling component when it changes. */
export function useLang(): Lang {
  return useSyncExternalStore((cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, getLang);
}

/** Translate `key`, filling `{name}` from params. A `key.empty` variant wins when `t` is ''. */
export function t(key: Key, params?: Record<string, string>): string {
  const dict = DICT[lang];
  const text =
    (params?.t === '' ? dict[`${key}.empty` as Key] : undefined) ?? dict[key] ?? (key as string);
  return text.replace(/\{(\w+)\}/g, (m, name: string) => params?.[name] ?? m);
}

/** Agent activity in the viewer's language. */
export const actText = (act: Act, target: string): string => t(`act.${act}`, { t: target });

const ROOM_BY_LABEL = new Map<string, Room>(
  (Object.entries(ROOM_LABELS) as [Room, string][]).map(([room, label]) => [label, room]),
);

/** Display name of a layout area: the four rooms are translated, custom areas stay as-is. */
export function areaName(label: string): string {
  const room = ROOM_BY_LABEL.get(label);
  return room ? t(`room.${room}`) : label;
}
