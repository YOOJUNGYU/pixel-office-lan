import { useEffect, useRef, useState } from 'react';

import type { OfficeErrorReason, OfficesState } from '../../../core/src/messages.js';
import { Button } from '../components/ui/Button.js';
import { Checkbox } from '../components/ui/Checkbox.js';
import { MAX_OFFICE_NAME, OFFICE_COPIED_MS } from '../constants.js';
import type { OfficeReply } from '../hooks/useExtensionMessages.js';
import { t } from '../i18n.js';
import { transport } from '../transport/index.js';
import { normalizeCodeInput } from './offices.js';

const INPUT = 'flex-1 min-w-0 py-2 px-4 bg-bg border-2 border-border rounded-none text-text';
/** Created office's code panel key in `copied` (list rows use the office tag). */
const CREATED = 'created';

interface OfficeSettingsProps {
  state: Omit<OfficesState, 'type'>;
  reply: OfficeReply | null;
  /** Consumes `reply`: a remount (Settings reopened) must not apply it again. */
  onReplyHandled: () => void;
}

/** Settings → 오피스: create, join, copy code / leave, remote viewing. This PC's browser only. */
export function OfficeSettings({ state, reply, onReplyHandled }: OfficeSettingsProps) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [joinName, setJoinName] = useState('');
  const [created, setCreated] = useState<{ tag: string; code: string } | null>(null);
  /** Codes fetched for re-copying, shown too in case the clipboard is unavailable. */
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<OfficeErrorReason | null>(null);
  const [leftPublic, setLeftPublic] = useState(false);
  const prevCount = useRef(state.offices.length);

  const copy = (key: string, text: string) => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(key);
        setTimeout(() => setCopied((k) => (k === key ? null : k)), OFFICE_COPIED_MS);
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (!reply) return;
    if (reply.type === 'officeError') {
      setError(reply.reason);
    } else if (reply.type === 'officeCreated') {
      setError(null);
      setName('');
      setCreated({ tag: reply.tag, code: reply.code });
    } else {
      setCodes((c) => ({ ...c, [reply.tag]: reply.code }));
      copy(reply.tag, reply.code);
    }
    onReplyHandled();
  }, [reply, onReplyHandled]);

  // Joined/created the first team: say that this PC left the public office.
  useEffect(() => {
    const n = state.offices.length;
    if (prevCount.current === 0 && n > 0) setLeftPublic(true);
    if (n === 0) setLeftPublic(false);
    if (n > prevCount.current) {
      setCode('');
      setJoinName('');
    }
    prevCount.current = n;
  }, [state.offices.length]);

  const trimmedName = name.trim();
  const nameOk = trimmedName.length >= 1 && trimmedName.length <= MAX_OFFICE_NAME;
  const create = () => {
    if (!nameOk) return;
    setError(null);
    transport.send({ type: 'createOffice', name: trimmedName });
  };
  const join = () => {
    const c = normalizeCodeInput(code);
    if (!c) return;
    setError(null);
    setCreated(null);
    const n = joinName.trim();
    transport.send({ type: 'joinOffice', code: c, ...(n && { name: n }) });
  };

  return (
    <div className="flex flex-col gap-6 py-4 px-10 text-sm border-t-2 border-border mt-4">
      <div data-tour="settings-offices" className="flex flex-col gap-6">
        <div className="text-accent-bright">{t('settings.offices')}</div>

        <label htmlFor="office-name">{t('office.create')}</label>
        <div className="flex gap-4">
          <input
            id="office-name"
            type="text"
            value={name}
            maxLength={MAX_OFFICE_NAME}
            placeholder={t('office.namePlaceholder')}
            onChange={(e) => setName(e.target.value)}
            className={INPUT}
          />
          <Button size="sm" variant={nameOk ? 'accent' : 'disabled'} onClick={create}>
            {t('office.createButton')}
          </Button>
        </div>
        {created && (
          <div className="flex flex-col gap-4 p-6 border-2 border-accent bg-bg-dark">
            <span>{t('office.shareHint')}</span>
            <div className="flex items-center gap-8">
              <code data-testid="office-created-code" className="flex-1 select-all break-all">
                {created.code}
              </code>
              <Button size="sm" onClick={() => copy(CREATED, created.code)}>
                {copied === CREATED ? t('office.copied') : t('office.copy')}
              </Button>
            </div>
          </div>
        )}

        <label htmlFor="office-code">{t('office.join')}</label>
        <input
          id="office-code"
          type="text"
          value={code}
          placeholder="PO2-…"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setCode(normalizeCodeInput(e.target.value))}
          className={INPUT}
        />
        <div className="flex gap-4">
          <input
            type="text"
            value={joinName}
            maxLength={MAX_OFFICE_NAME}
            aria-label={t('office.joinNamePlaceholder')}
            placeholder={t('office.joinNamePlaceholder')}
            onChange={(e) => setJoinName(e.target.value)}
            className={INPUT}
          />
          <Button size="sm" variant={code ? 'accent' : 'disabled'} onClick={join}>
            {t('office.joinButton')}
          </Button>
        </div>

        {error && (
          <span role="alert" className="text-xs text-danger">
            {t(`office.error.${error}`)}
          </span>
        )}
        {leftPublic && <span className="text-xs text-accent-bright">{t('office.leftPublic')}</span>}

        <div>{t('office.list')}</div>
        {state.offices.length === 0 && <div className="text-text-muted">{t('office.none')}</div>}
        {state.offices.map((o) => {
          const label = o.name || t('office.unnamed');
          return (
            <div key={o.tag} className="flex flex-col gap-2">
              <div className="flex items-center gap-4">
                <span className="flex-1 min-w-0 truncate">🔒 {label}</span>
                <Button
                  size="sm"
                  onClick={() =>
                    codes[o.tag]
                      ? copy(o.tag, codes[o.tag])
                      : transport.send({ type: 'getOfficeCode', tag: o.tag })
                  }
                >
                  {copied === o.tag ? t('office.copied') : t('office.copy')}
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    if (window.confirm(t('office.leaveConfirm', { name: label }))) {
                      transport.send({ type: 'leaveOffice', tag: o.tag });
                    }
                  }}
                >
                  {t('office.leave')}
                </Button>
              </div>
              {codes[o.tag] && (
                <code className="text-xs text-text-muted select-all break-all">{codes[o.tag]}</code>
              )}
            </div>
          );
        })}
      </div>

      <div data-tour="settings-remote" className="flex flex-col gap-6">
        <Checkbox
          label={t('office.remoteView')}
          checked={state.remoteView}
          onChange={() => transport.send({ type: 'setRemoteView', enabled: !state.remoteView })}
          className="px-0!"
        />
        <div className="text-xs text-text-muted">{t('office.remoteViewWarning')}</div>
      </div>
    </div>
  );
}
