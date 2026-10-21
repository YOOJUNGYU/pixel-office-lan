import { describe, expect, it } from 'vitest';

import type { AgentView } from '../../../core/src/lan.js';
import { redactText, redactView } from '../../src/lan/redact.js';

const cases: Array<[string, string]> = [
  ['/home/kim/proj/src/auth/login.ts 수정 중', 'login.ts 수정 중'],
  ['C:\\Users\\kim\\proj\\a.ts 읽는 중', 'a.ts 읽는 중'],
  ['\\\\wsl.localhost\\Ubuntu\\home\\kim\\x.py', 'x.py'],
  ['~/secret/notes.md 열기', 'notes.md 열기'],
  ['https://api.corp.com/v1/users?token=abc 보는 중', 'api.corp.com 보는 중'],
  ['10.1.2.3:8080 접속', '[IP] 접속'],
  ['키 sk-ant-api03-AbCdEf0123456789xyz 설정', '키 [비밀] 설정'],
  ['ghp_0123456789abcdefABCDEF0123456789abcd', '[비밀]'],
  ['토큰 만료 시 재로그인이 안 되는 문제 수정', '토큰 만료 시 재로그인이 안 되는 문제 수정'],
  ['npm test 실행', 'npm test 실행'],
  // extras
  ['"C:\\Users\\kim lee\\my proj\\a b.ts" 열기', 'a b.ts 열기'],
  ['/Users/kim/dev/app/main.swift 빌드', 'main.swift 빌드'],
  ['src/auth/login.ts 수정', 'login.ts 수정'],
  ['./src/a.ts 와 ../x/y.json', 'a.ts 와 y.json'],
  ['http://192.168.0.5:3000/x 호출', '[IP] 호출'],
  ['Authorization: Bearer abcdEFGH1234567890zzzz', 'Authorization: Bearer [비밀]'],
  ['hash 0123456789abcdef0123456789abcdef01234567 확인', 'hash [비밀] 확인'],
  ['npm v1.2.3 README.md 읽기 and/or /clear', 'npm v1.2.3 README.md 읽기 and/or /clear'],
  [
    'some_very_long_snake_case_identifier_name_here 호출',
    'some_very_long_snake_case_identifier_name_here 호출',
  ],
];

describe('redactText', () => {
  it.each(cases)('%s', (input, expected) => {
    expect(redactText(input)).toBe(expected);
  });
});

describe('redactView', () => {
  it('redacts summary and reason only', () => {
    const v = {
      id: 's1',
      summary: '/a/b/c.ts',
      reason: '10.0.0.1',
      num: 1,
    } as unknown as AgentView;
    expect(redactView(v)).toEqual({ ...v, summary: 'c.ts', reason: '[IP]' });
  });
});
