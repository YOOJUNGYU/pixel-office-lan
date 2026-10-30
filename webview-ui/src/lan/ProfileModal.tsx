import { useEffect, useRef, useState } from 'react';

import type { PetId } from '../../../core/src/lan.js';
import { isValidManualPeer, nicknameKey, PET_IDS } from '../../../core/src/lan.js';
import type { ProfileErrorReason, ProfileMessage, TagColors } from '../../../core/src/messages.js';
import { Button } from '../components/ui/Button.js';
import { Checkbox } from '../components/ui/Checkbox.js';
import { Modal } from '../components/ui/Modal.js';
import {
  AVATAR_TAG_DEFAULT_BG,
  AVATAR_TAG_DEFAULT_FG,
  CHARACTER_SKIN_COLORS,
  MAX_HUE_DEG,
  PALETTE_COUNT,
} from '../constants.js';
import { t, useLang } from '../i18n.js';
import { adjustSprite } from '../office/colorize.js';
import { getPetSprites, tintPetSprite } from '../office/sprites/petSpriteData.js';
import { getCharacterSprites } from '../office/sprites/spriteData.js';
import { Direction } from '../office/types.js';

const MAX_NICKNAME = 20;
const MAX_MANUAL_PEERS = 20;
/** Color presets: hueShift degrees. */
const HUE_PRESETS = [0, 45, 90, 135, 180, 225, 270, 315];
const PREVIEW_SCALE = 4;
/** keyCode of a key event the IME is still processing */
const IME_KEYCODE = 229;
const SWATCH_SCALE = 2;

/** One standing frame of a character, drawn at an integer scale (pixel-perfect):
 *  the pet's front idle frame when `pet` is a loaded pet, else the palette human.
 *  `crop` = only sprite rows [top, top + rows) (the people panel's face). */
export function CharacterPreview({
  palette,
  hueShift,
  pet,
  scale,
  crop,
}: {
  palette: number;
  hueShift: number;
  pet?: string;
  scale: number;
  crop?: { top: number; rows: number };
}) {
  const top = crop?.top ?? 0;
  const rows = crop?.rows;
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    // Shift just this frame, uncached: slider ticks must not fill the shared sprite cache.
    const petFrames = pet ? getPetSprites(pet) : null;
    const sprite = (
      pet && petFrames
        ? tintPetSprite(petFrames.idleDown[0], pet, hueShift)
        : adjustSprite(
            getCharacterSprites(palette).walk[Direction.DOWN][1],
            { h: hueShift, s: 0, b: 0, c: 0 },
            CHARACTER_SKIN_COLORS,
          )
    ).slice(top, rows === undefined ? undefined : top + rows);
    canvas.width = sprite[0].length * scale;
    canvas.height = sprite.length * scale;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    sprite.forEach((row, y) =>
      row.forEach((color, x) => {
        if (color === '') return;
        ctx.fillStyle = color;
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }),
    );
  }, [palette, hueShift, pet, scale, top, rows]);
  return <canvas ref={ref} style={{ imageRendering: 'pixelated' }} />;
}

interface ProfileModalProps {
  profile: ProfileMessage;
  /** No profile yet: the modal cannot be dismissed until a valid one is saved. */
  firstRun: boolean;
  /** The server rejected the last save (why, when it said); the form keeps the user's input. */
  saveError: ProfileErrorReason | 'rejected' | null;
  /** nicknameKeys of the other people in view: live duplicate hint (the server decides). */
  takenNicknames: ReadonlySet<string>;
  /** This PC's OS account name: fixed, always shown before the nickname. */
  account: string;
  onSave: (profile: ProfileMessage) => void;
  onClose: () => void;
}

export function ProfileModal({
  profile,
  firstRun,
  saveError,
  takenNicknames,
  account,
  onSave,
  onClose,
}: ProfileModalProps) {
  useLang();
  const [nickname, setNickname] = useState(profile.nickname);
  const [palette, setPalette] = useState(profile.palette);
  const [hueShift, setHueShift] = useState(profile.hueShift);
  const [pet, setPet] = useState<PetId | undefined>(profile.pet);
  const [tagColors, setTagColors] = useState<TagColors | undefined>(profile.tagColors);
  const [hideWork, setHideWork] = useState(profile.hideWork);
  const [peersText, setPeersText] = useState(profile.manualPeers.join('\n'));
  // Advanced (manual peers) starts collapsed unless some are already set.
  const [peersOpen] = useState(profile.manualPeers.length > 0);

  const trimmed = nickname.trim();
  const key = nicknameKey(trimmed);
  const taken = takenNicknames.has(key) && key !== nicknameKey(profile.nickname);
  const manualPeers = peersText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const badPeers = manualPeers.filter((p) => !isValidManualPeer(p));
  const errors = {
    nickname:
      trimmed.length > MAX_NICKNAME
        ? t('profile.nicknameTooLong')
        : taken
          ? t('profile.nicknameTaken')
          : '',
    peers:
      manualPeers.length > MAX_MANUAL_PEERS
        ? t('profile.manualPeersTooMany')
        : badPeers.length
          ? t('profile.manualPeersInvalid', { list: badPeers.join(', ') })
          : '',
  };
  const valid = !errors.nickname && !errors.peers;

  const save = () => {
    if (!valid) return;
    onSave({
      nickname: trimmed,
      palette,
      hueShift,
      ...(pet && { pet }),
      ...(tagColors && { tagColors }),
      hideWork,
      manualPeers,
    });
  };

  return (
    <Modal
      isOpen
      onClose={firstRun ? () => {} : onClose}
      hideClose={firstRun}
      dataTour="profile-modal"
      title={firstRun ? t('profile.firstRunTitle') : t('profile.title')}
    >
      <div className="flex flex-col gap-8 py-4 px-10 text-sm">
        <div className="flex gap-12 items-start">
          <div className="shrink-0 border-2 border-border bg-bg-dark p-4">
            <CharacterPreview
              palette={palette}
              hueShift={hueShift}
              pet={pet}
              scale={PREVIEW_SCALE}
            />
          </div>
          <div className="flex-1 min-w-0 flex flex-col gap-4">
            <div>
              {t('profile.account')}: <strong>{account}</strong>{' '}
              <span className="text-xs text-text-muted">{t('profile.accountFixed')}</span>
            </div>
            <label htmlFor="profile-nickname">{t('profile.nickname')}</label>
            <input
              id="profile-nickname"
              type="text"
              value={nickname}
              placeholder={t('profile.nicknamePlaceholder')}
              autoFocus
              onChange={(e) => setNickname(e.target.value)}
              onKeyDown={(e) => {
                // Korean IME: Enter that commits a syllable is not a submit
                if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== IME_KEYCODE) {
                  save();
                }
              }}
              className="w-full py-2 px-4 bg-bg border-2 border-border rounded-none text-text"
            />
            {errors.nickname ? (
              <span className="text-xs text-danger">{errors.nickname}</span>
            ) : (
              <span className="text-xs text-text-muted">
                {t('profile.nicknameHint', { account })}
              </span>
            )}
          </div>
        </div>

        <div>{t('profile.character')}</div>
        <div className="flex gap-4 flex-wrap">
          {Array.from({ length: PALETTE_COUNT }, (_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`${t('profile.character')} ${i + 1}`}
              aria-pressed={!pet && palette === i}
              onClick={() => {
                setPalette(i);
                setPet(undefined);
              }}
              className={`p-2 rounded-none cursor-pointer bg-bg-dark border-2 ${!pet && palette === i ? 'border-accent-bright' : 'border-border'}`}
            >
              <CharacterPreview palette={i} hueShift={hueShift} scale={SWATCH_SCALE} />
            </button>
          ))}
          {/* Pets: the palette stays as the look for peers that do not know pets. */}
          {PET_IDS.filter((id) => getPetSprites(id)).map((id) => (
            <button
              key={id}
              type="button"
              aria-label={t(`profile.pet.${id}`)}
              title={t(`profile.pet.${id}`)}
              aria-pressed={pet === id}
              data-testid={`profile-pet-${id}`}
              onClick={() => setPet(id)}
              className={`p-2 rounded-none cursor-pointer bg-bg-dark border-2 flex items-end ${pet === id ? 'border-accent-bright' : 'border-border'}`}
            >
              <CharacterPreview
                palette={palette}
                hueShift={hueShift}
                pet={id}
                scale={SWATCH_SCALE}
              />
            </button>
          ))}
        </div>

        <div>{t('profile.color')}</div>
        <div className="flex gap-4 flex-wrap">
          {HUE_PRESETS.map((h) => (
            <button
              key={h}
              type="button"
              aria-label={`${t('profile.color')} ${h}°`}
              aria-pressed={hueShift === h}
              onClick={() => setHueShift(h)}
              className={`p-2 rounded-none cursor-pointer bg-bg-dark border-2 ${hueShift === h ? 'border-accent-bright' : 'border-border'}`}
            >
              <CharacterPreview palette={palette} hueShift={h} pet={pet} scale={SWATCH_SCALE} />
            </button>
          ))}
        </div>
        <div className="flex items-center gap-8">
          <input
            type="range"
            min={0}
            max={MAX_HUE_DEG}
            step={1}
            value={hueShift}
            aria-label={t('profile.color')}
            onChange={(e) => setHueShift(Number(e.target.value))}
            className="flex-1 min-w-0"
          />
          <span className="w-30 text-right text-text-muted">{hueShift}°</span>
        </div>

        {/* My avatar's name tag: colours picked here, else the theme's default tag. */}
        <div>{t('profile.tagColors')}</div>
        <div className="flex items-center gap-8 flex-wrap">
          <span
            data-testid="profile-tag-preview"
            className="whitespace-nowrap text-sm leading-none px-3 py-1"
            style={{
              background: tagColors?.bg ?? 'var(--avatar-tag-bg)',
              color: tagColors?.fg ?? 'var(--avatar-tag-fg)',
            }}
          >
            {trimmed || account}
          </span>
          {(['bg', 'fg'] as const).map((k) => (
            <label key={k} className="flex items-center gap-4">
              {t(k === 'bg' ? 'profile.tagBg' : 'profile.tagFg')}
              <input
                type="color"
                data-testid={`profile-tag-${k}`}
                value={(
                  tagColors?.[k] ?? (k === 'bg' ? AVATAR_TAG_DEFAULT_BG : AVATAR_TAG_DEFAULT_FG)
                ).toLowerCase()}
                onChange={(e) =>
                  setTagColors({
                    bg: tagColors?.bg ?? AVATAR_TAG_DEFAULT_BG,
                    fg: tagColors?.fg ?? AVATAR_TAG_DEFAULT_FG,
                    [k]: e.target.value.toUpperCase(),
                  })
                }
                className="w-28 h-20 p-0 bg-bg border-2 border-border rounded-none cursor-pointer"
              />
            </label>
          ))}
          {tagColors && (
            <Button size="sm" onClick={() => setTagColors(undefined)}>
              {t('profile.tagDefault')}
            </Button>
          )}
        </div>

        {/* First run asks only for name, character and colour; hideWork keeps
            its default and the rest lives in Settings → My profile. */}
        {!firstRun && (
          <>
            <Checkbox
              label={t('profile.hideWork')}
              checked={hideWork}
              onChange={() => setHideWork((v) => !v)}
            />
            {/* w-0 min-w-full: the long hint wraps to the modal's width
                instead of widening it. */}
            <div className="w-0 min-w-full text-xs text-text-muted">
              {t('profile.hideWorkHint')}
            </div>

            <details open={peersOpen}>
              <summary className="cursor-pointer select-none">{t('profile.advanced')}</summary>
              <div className="flex flex-col gap-4 pt-4">
                <div className="text-xs text-text-muted">{t('profile.manualPeersHint')}</div>
                <label htmlFor="profile-peers">{t('profile.manualPeers')}</label>
                <textarea
                  id="profile-peers"
                  rows={3}
                  value={peersText}
                  onChange={(e) => setPeersText(e.target.value)}
                  className="w-full py-2 px-4 bg-bg border-2 border-border rounded-none text-text text-xs"
                />
              </div>
            </details>
            {errors.peers && <span className="text-xs text-danger">{errors.peers}</span>}
          </>
        )}

        {saveError && (
          <span className="text-xs text-danger">
            {t(saveError === 'nicknameTaken' ? 'profile.nicknameTaken' : 'profile.saveRejected')}
          </span>
        )}
        <Button variant="accent" onClick={save} className="self-end">
          {t('profile.save')}
        </Button>
      </div>
    </Modal>
  );
}
