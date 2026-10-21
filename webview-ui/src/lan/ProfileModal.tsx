import { useEffect, useRef, useState } from 'react';

import { isValidManualPeer } from '../../../core/src/lan.js';
import type { ProfileMessage } from '../../../core/src/messages.js';
import { Button } from '../components/ui/Button.js';
import { Checkbox } from '../components/ui/Checkbox.js';
import { Modal } from '../components/ui/Modal.js';
import { CHARACTER_SKIN_COLORS, MAX_HUE_DEG, PALETTE_COUNT } from '../constants.js';
import { t, useLang } from '../i18n.js';
import { adjustSprite } from '../office/colorize.js';
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

/** One standing frame of a character, drawn at an integer scale (pixel-perfect). */
function CharacterPreview({
  palette,
  hueShift,
  scale,
}: {
  palette: number;
  hueShift: number;
  scale: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    // Shift just this frame, uncached: slider ticks must not fill the shared sprite cache.
    const base = getCharacterSprites(palette).walk[Direction.DOWN][1];
    const sprite = adjustSprite(base, { h: hueShift, s: 0, b: 0, c: 0 }, CHARACTER_SKIN_COLORS);
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
  }, [palette, hueShift, scale]);
  return <canvas ref={ref} style={{ imageRendering: 'pixelated' }} />;
}

interface ProfileModalProps {
  profile: ProfileMessage;
  /** No profile yet: the modal cannot be dismissed until a valid one is saved. */
  firstRun: boolean;
  /** The server rejected the last save; the form keeps the user's input. */
  saveError: boolean;
  onSave: (profile: ProfileMessage) => void;
  onClose: () => void;
}

export function ProfileModal({ profile, firstRun, saveError, onSave, onClose }: ProfileModalProps) {
  useLang();
  const [nickname, setNickname] = useState(profile.nickname);
  const [palette, setPalette] = useState(profile.palette);
  const [hueShift, setHueShift] = useState(profile.hueShift);
  const [hideDetails, setHideDetails] = useState(profile.hideDetails);
  const [peersText, setPeersText] = useState(profile.manualPeers.join('\n'));
  const [submitted, setSubmitted] = useState(false);

  const trimmed = nickname.trim();
  const manualPeers = peersText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const badPeers = manualPeers.filter((p) => !isValidManualPeer(p));
  const errors = {
    nickname:
      trimmed === ''
        ? t('profile.nicknameEmpty')
        : trimmed.length > MAX_NICKNAME
          ? t('profile.nicknameTooLong')
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
    setSubmitted(true);
    if (!valid) return;
    onSave({ nickname: trimmed, palette, hueShift, hideDetails, manualPeers });
  };

  return (
    <Modal
      isOpen
      onClose={firstRun ? () => {} : onClose}
      hideClose={firstRun}
      title={firstRun ? t('profile.firstRunTitle') : t('profile.title')}
    >
      <div className="flex flex-col gap-8 py-4 px-10 text-sm">
        <div className="flex gap-12 items-start">
          <div className="shrink-0 border-2 border-border bg-bg-dark p-4">
            <CharacterPreview palette={palette} hueShift={hueShift} scale={PREVIEW_SCALE} />
          </div>
          <div className="flex-1 min-w-0 flex flex-col gap-4">
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
            {(submitted || nickname !== '') && errors.nickname && (
              <span className="text-xs text-danger">{errors.nickname}</span>
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
              aria-pressed={palette === i}
              onClick={() => setPalette(i)}
              className={`p-2 rounded-none cursor-pointer bg-bg-dark border-2 ${palette === i ? 'border-accent-bright' : 'border-border'}`}
            >
              <CharacterPreview palette={i} hueShift={hueShift} scale={SWATCH_SCALE} />
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
              <CharacterPreview palette={palette} hueShift={h} scale={SWATCH_SCALE} />
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

        <Checkbox
          label={t('profile.hideDetails')}
          checked={hideDetails}
          onChange={() => setHideDetails((v) => !v)}
        />
        <div className="text-xs text-text-muted">{t('profile.hideDetailsHint')}</div>

        <label htmlFor="profile-peers">{t('profile.manualPeers')}</label>
        <textarea
          id="profile-peers"
          rows={3}
          value={peersText}
          onChange={(e) => setPeersText(e.target.value)}
          className="w-full py-2 px-4 bg-bg border-2 border-border rounded-none text-text text-xs"
        />
        <div className="text-xs text-text-muted">{t('profile.manualPeersHint')}</div>
        {errors.peers && <span className="text-xs text-danger">{errors.peers}</span>}

        {saveError && <span className="text-xs text-danger">{t('profile.saveRejected')}</span>}
        <Button variant="accent" onClick={save} className="self-end">
          {t('profile.save')}
        </Button>
      </div>
    </Modal>
  );
}
