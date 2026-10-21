import { describe, expect, it } from 'vitest';

import type { AgentView } from '../../../core/src/lan.js';
import { redactText, redactView } from '../../src/lan/redact.js';

const cases: Array<[string, string]> = [
  ['/home/kim/proj/src/auth/login.ts 수정 중', 'login.ts 수정 중'],
  ['C:\\Users\\kim\\proj\\a.ts 읽는 중', 'a.ts 읽는 중'],
  ['\\\\wsl.localhost\\Ubuntu\\home\\kim\\x.py', 'x.py'],
  ['~/secret/notes.md 열기', 'notes.md 열기'],
  ['https://api.corp.com/v1/users?token=abc 보는 중', 'api.corp.com 보는 중'],
  ['10.1.2.3:8080 접속', '*** 접속'],
  ['키 sk-ant-api03-AbCdEf0123456789xyz 설정', '키 *** 설정'],
  ['ghp_0123456789abcdefABCDEF0123456789abcd', '***'],
  ['토큰 만료 시 재로그인이 안 되는 문제 수정', '토큰 만료 시 재로그인이 안 되는 문제 수정'],
  ['npm test 실행', 'npm test 실행'],
  // extras
  ['"C:\\Users\\kim lee\\my proj\\a b.ts" 열기', 'a b.ts 열기'],
  ['/Users/kim/dev/app/main.swift 빌드', 'main.swift 빌드'],
  ['src/auth/login.ts 수정', 'login.ts 수정'],
  ['./src/a.ts 와 ../x/y.json', 'a.ts 와 y.json'],
  ['http://192.168.0.5:3000/x 호출', '*** 호출'],
  ['Authorization: Bearer abcdEFGH1234567890zzzz', 'Authorization: Bearer ***'],
  ['hash 0123456789abcdef0123456789abcdef01234567 확인', 'hash *** 확인'],
  ['npm v1.2.3 README.md 읽기 and/or /clear', 'npm v1.2.3 README.md 읽기 and/or /clear'],
  [
    'some_very_long_snake_case_identifier_name_here 호출',
    'some_very_long_snake_case_identifier_name_here 호출',
  ],
  // fix round 1
  ['/Users/kim 확인', '~ 확인'],
  ['C:\\Users\\kim 확인', '~ 확인'],
  ['cd /home/kim', 'cd ~'],
  ['/home/kim/ 에서', '~ 에서'],
  ['/home/kim/proj/ 에서', '… 에서'],
  ['C:\\Users\\kim lee\\proj\\a.ts 열기', 'a.ts 열기'],
  ['\\\\wsl.localhost\\Ubuntu\\home\\kim lee\\x.py', 'x.py'],
  ['localhost:3000/api/users?token=x 호출', 'localhost 호출'],
  ['api.corp.com/v1/users?token=abc 호출', 'api.corp.com 호출'],
  ['192.168.0.5:3000/x 호출', '*** 호출'],
  ['a.ts login.ts README.md v1.2.3 읽기', 'a.ts login.ts README.md v1.2.3 읽기'],
  // final review (I2): hosts, user@host, inline secrets, relative dirs, Hangul, JWT
  ['ssh dev@db01.acme.local', 'ssh ***'],
  ['ping db01.internal', 'ping ***'],
  ['scp file kim@192.168.0.10:/tmp', 'scp file ***:/tmp'],
  ['export OPENAI_API_KEY=sk-abcd1234efgh', 'export OPENAI_API_KEY=***'],
  ['DB_PASSWORD="a b" npm start', 'DB_PASSWORD=*** npm start'],
  ['mysql -u root -pS3cretPass!', 'mysql -u root -p***'],
  ['mysql -h db.corp.com -pPassword', 'mysql -h *** -p***'],
  ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abc 확인', '*** 확인'],
  ['ls server/src/lan', 'ls lan'],
  ['ls server/src/', 'ls …'],
  ['open docs/고객사/계약.md', 'open 계약.md'],
  ['고객사/계약서.hwp 읽기', '계약서.hwp 읽기'],
  ['cd ./apps/hospital-x', 'cd hospital-x'],
  ['git checkout origin/main', 'git checkout origin/main'],
  ['npm i @types/node react@18.3.1', 'npm i @types/node react@18.3.1'],
  ['https://docs.example.com/a 참고', 'docs.example.com 참고'],
];

describe('redactText', () => {
  it.each(cases)('%s', (input, expected) => {
    expect(redactText(input)).toBe(expected);
  });
});

describe('redactView', () => {
  it('redacts target and reason only', () => {
    const v = {
      id: 's1',
      act: 'edit',
      target: '/a/b/c.ts',
      reason: '10.0.0.1',
      num: 1,
    } as unknown as AgentView;
    expect(redactView(v)).toEqual({ ...v, target: 'c.ts', reason: '***' });
  });
});
