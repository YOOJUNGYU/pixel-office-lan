import { describe, expect, it } from 'vitest';

import {
  newSession,
  programName,
  setActivity,
  setIdle,
  tick,
  toViews,
} from '../../src/lan/session.js';

const mk = () => newSession('claude', 's1', 'main', 0);

describe('session state', () => {
  it('debounces room change by 3s', () => {
    const s = mk();
    setActivity(s, 'coding', 'edit', 'x', 0);
    tick(s, 2_999);
    expect(s.room).toBe('lounge');
    tick(s, 3_000);
    expect(s.room).toBe('coding');
  });

  it('flapping rooms every 1s never moves within 3s', () => {
    const s = mk();
    setActivity(s, 'coding', 'edit', 'x', 0);
    setActivity(s, 'library', 'read', 'x', 1_000);
    setActivity(s, 'coding', 'edit', 'x', 2_000);
    tick(s, 4_999);
    expect(s.room).toBe('lounge');
    tick(s, 5_000);
    expect(s.room).toBe('coding');
  });

  it('silent non-exempt tool => permission in place (no room change)', () => {
    const s = mk();
    s.room = s.candidate = 'server';
    s.pendingTool = { name: 'Bash', since: 0, exempt: false };
    tick(s, 6_999);
    expect(s.permission).toBe(false);
    tick(s, 7_000);
    expect(s.permission).toBe(true);
    tick(s, 30_000);
    expect(s.room).toBe('server');
    setActivity(s, 'coding', 'edit', 'y', 30_500);
    expect(s.permission).toBe(false);
  });

  it('bypassPermissions never guesses a permission prompt', () => {
    const s = mk();
    s.bypass = true;
    s.pendingTool = { name: 'Bash', since: 0, exempt: false };
    tick(s, 60_000);
    expect(s.permission).toBe(false);
  });

  it('programName: first token after env assignments, basename', () => {
    expect(programName('OPENAI_API_KEY=sk-x /usr/bin/npm test')).toBe('npm');
    expect(programName('"C:\\tools\\git.exe" status')).toBe('git.exe');
    expect(programName('ssh dev@db01.acme.local')).toBe('ssh');
    expect(programName('')).toBe('');
  });

  it('exempt tool never sets permission', () => {
    const s = mk();
    s.pendingTool = { name: 'Task', since: 0, exempt: true };
    tick(s, 60_000);
    expect(s.permission).toBe(false);
  });

  it('text-only idles after 5s, lounge after 3 more', () => {
    const s = mk();
    s.room = s.candidate = 'coding';
    s.act = 'edit';
    s.target = 'a.ts';
    s.textOnlyAt = 0;
    tick(s, 5_000);
    expect(s).toMatchObject({ act: 'idle', target: '' });
    expect(s.turnEnded).toBe(true);
    expect(s.room).toBe('coding');
    tick(s, 8_000);
    expect(s.room).toBe('lounge');
  });

  it('setIdle clears pending state', () => {
    const s = mk();
    s.pendingTool = { name: 'Edit', since: 0, exempt: false };
    s.permission = true;
    setIdle(s, 1);
    expect(s.pendingTool).toBeNull();
    expect(s.permission).toBe(false);
  });

  it('toViews appends shell views in server room', () => {
    const s = mk();
    s.shells.set('b1', { target: 'npm run dev', brief: 'npm' });
    s.target = 'ssh dev@db01';
    s.brief = 'ssh';
    expect(toViews(s, true).map((x) => x.target)).toEqual(['ssh', 'npm']);
    const v = toViews(s);
    expect(v).toHaveLength(2);
    expect(v[1]).toMatchObject({
      kind: 'shell',
      room: 'server',
      parentId: 's1',
      id: 's1/sh/b1',
      act: 'run',
      target: 'npm run dev',
    });
  });
});
