import { describe, expect, it } from 'vitest';

import { newSession, setActivity, setIdle, tick, toViews } from '../../src/lan/session.js';

const mk = () => newSession('claude', 's1', 'main', 0);

describe('session state', () => {
  it('debounces room change by 3s', () => {
    const s = mk();
    setActivity(s, 'coding', 'x', 0);
    tick(s, 2_999);
    expect(s.room).toBe('lounge');
    tick(s, 3_000);
    expect(s.room).toBe('coding');
  });

  it('flapping rooms every 1s never moves within 3s', () => {
    const s = mk();
    setActivity(s, 'coding', 'x', 0);
    setActivity(s, 'library', 'x', 1_000);
    setActivity(s, 'coding', 'x', 2_000);
    tick(s, 4_999);
    expect(s.room).toBe('lounge');
    tick(s, 5_000);
    expect(s.room).toBe('coding');
  });

  it('pending non-exempt tool => permission + immediate lounge', () => {
    const s = mk();
    s.room = s.candidate = 'coding';
    s.pendingTool = { name: 'Edit', since: 0, exempt: false };
    tick(s, 6_999);
    expect(s.permission).toBe(false);
    tick(s, 7_000);
    expect(s.permission).toBe(true);
    expect(s.room).toBe('lounge');
    setActivity(s, 'coding', 'y', 7_500);
    expect(s.permission).toBe(false);
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
    s.summary = '작성 중';
    s.textOnlyAt = 0;
    tick(s, 5_000);
    expect(s.summary).toBe('대기 중');
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
    s.shells.set('b1', '명령 실행: npm run dev');
    const v = toViews(s);
    expect(v).toHaveLength(2);
    expect(v[1]).toMatchObject({
      kind: 'shell',
      room: 'server',
      parentId: 's1',
      id: 's1/sh/b1',
      summary: '명령 실행: npm run dev',
    });
  });
});
