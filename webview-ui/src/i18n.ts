// Per-viewer UI language (Korean / English). No server round-trip: the choice
// lives in this browser's localStorage, so read-only LAN viewers get it too.
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

  'tag.subagent': '↳ 서브에이전트',
  'tag.shell': '↳ 셸',
  'bubble.permission': '❗ 확인 필요',
  'nickname.unset': '이름없음',

  'app.loading': '불러오는 중…',
  'app.readOnly': '보기 전용',
  'app.rotateHint': '회전 (R)',
  'app.importConfirm': '현재 레이아웃을 바꿀까요? 저장하지 않은 편집은 사라집니다.',
  'app.importInvalid': '올바른 레이아웃 파일이 아닙니다.',
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
  'office.remoteView': '다른 PC 브라우저에서 보기 허용',
  'office.remoteViewWarning':
    '켜면 이 PC의 공개 오피스 화면을 같은 망의 다른 브라우저가 평문(HTTP)으로 볼 수 있습니다',
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
  'install.body': '바로가기를 누르면 탭이 아닌 앱 창으로 열립니다.',
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
  'edit.saveTitle': '레이아웃 저장',
  'edit.reset': '되돌리기',
  'edit.resetTitle': '마지막 저장 상태로 되돌리기',
  'edit.resetConfirm': '되돌릴까요?',
  'edit.yes': '예',
  'edit.no': '아니요',

  'profile.title': '내 프로필',
  'profile.firstRunTitle': '프로필 만들기',
  'profile.nickname': '닉네임',
  'profile.nicknamePlaceholder': '다른 사람에게 보이는 이름',
  'profile.nicknameEmpty': '닉네임을 입력하세요.',
  'profile.nicknameTooLong': '닉네임은 20자 이하여야 합니다.',
  'profile.character': '캐릭터',
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
  'editor.pets': '반려동물',
  'editor.petsTitle': '반려동물 놓기',
  'editor.areas': '방 영역',
  'editor.areasTitle': '방 영역 지정',
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
  'editor.areasHint':
    '지도에 영역을 칠한 뒤 작업 폴더를 지정하세요. 에이전트가 그 영역에 앉습니다.',
  'editor.noAreas': '아직 영역이 없습니다 — 위에서 추가하세요',
  'editor.areaName': '영역 이름…',
  'editor.addArea': '영역 추가',
  'editor.addAreaTitle': '새 영역 추가',
  'editor.areaColor': '영역 색상',
  'editor.renameArea': '{t} — 더블클릭해 이름 변경',
  'editor.removeArea': '영역 삭제',
  'editor.noFolders': '지정된 폴더 없음',
  'editor.unmapFolder': '폴더 지정 해제',
  'editor.allMapped': '모든 폴더가 이미 지정됨',
  'editor.mapFolder': '폴더 지정…',
  'editor.addFolder': '폴더 추가…',

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

  'tag.subagent': '↳ Subagent',
  'tag.shell': '↳ Shell',
  'bubble.permission': '❗ Needs attention',
  'nickname.unset': 'Unnamed',

  'app.loading': 'Loading…',
  'app.readOnly': 'View only',
  'app.rotateHint': 'Rotate (R)',
  'app.importConfirm': 'Replace the current layout? Unsaved edits will be lost.',
  'app.importInvalid': 'This is not a valid layout file.',
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
  'office.remoteView': 'Allow viewing from other browsers',
  'office.remoteViewWarning':
    "When on, other browsers on the same network can watch this PC's public office unencrypted (HTTP)",
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
  'install.body': 'Shortcuts then open it in its own app window instead of a tab.',
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
  'edit.saveTitle': 'Save layout',
  'edit.reset': 'Reset',
  'edit.resetTitle': 'Revert to the last saved layout',
  'edit.resetConfirm': 'Reset?',
  'edit.yes': 'Yes',
  'edit.no': 'No',

  'profile.title': 'My profile',
  'profile.firstRunTitle': 'Create your profile',
  'profile.nickname': 'Nickname',
  'profile.nicknamePlaceholder': 'The name others see',
  'profile.nicknameEmpty': 'Enter a nickname.',
  'profile.nicknameTooLong': 'Nickname must be 20 characters or fewer.',
  'profile.character': 'Character',
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
  'editor.pets': 'Pets',
  'editor.petsTitle': 'Place pets',
  'editor.areas': 'Areas',
  'editor.areasTitle': 'Define room areas',
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
  'editor.areasHint':
    "Paint areas on the map, then assign workspace folders. Agents will sit in their folder's area.",
  'editor.noAreas': 'No areas yet — add one above',
  'editor.areaName': 'Area name…',
  'editor.addArea': 'Add Area',
  'editor.addAreaTitle': 'Add a new Area',
  'editor.areaColor': 'Area color',
  'editor.renameArea': '{t} — double-click to rename',
  'editor.removeArea': 'Remove area',
  'editor.noFolders': 'No folders mapped',
  'editor.unmapFolder': 'Unmap folder',
  'editor.allMapped': 'All folders already mapped',
  'editor.mapFolder': 'Map a folder…',
  'editor.addFolder': 'Add folder…',

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
