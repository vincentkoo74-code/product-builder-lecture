// 로컬 E2E 스택 환경 로더.
//
// 개인 스크래치패드 경로에 의존하지 않는다 — `npm run jp:e2e:bootstrap` 이 남긴
// .jp-e2e/env.json 을 읽고, 없으면 **무엇을 해야 하는지 말하면서 fail-closed 로 멈춘다.**
// (권한이 우회된 채 초록이 되는 경로를 만들지 않는 것과 같은 원칙이다.)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENV_FILE = path.join(ROOT, '.jp-e2e', 'env.json');

let cached = null;
export function localEnv() {
  if (cached) return cached;
  // 환경변수 우선(CI 등에서 외부 스택을 쓰는 경우).
  if (process.env.JP_E2E_REST_URL && process.env.JP_E2E_JWT_SECRET && process.env.JP_E2E_ADMIN_URI) {
    cached = {
      restUrl: process.env.JP_E2E_REST_URL,
      jwtSecret: process.env.JP_E2E_JWT_SECRET,
      adminUri: process.env.JP_E2E_ADMIN_URI,
      pgbin: process.env.JP_E2E_PGBIN || '/opt/homebrew/opt/postgresql@17/bin',
    };
    return cached;
  }
  if (!fs.existsSync(ENV_FILE)) {
    throw new Error(
      '로컬 E2E 스택이 없다. 먼저 실행하라:  npm run jp:e2e:bootstrap\n' +
      `(또는 JP_E2E_REST_URL / JP_E2E_JWT_SECRET / JP_E2E_ADMIN_URI 를 직접 지정)`);
  }
  cached = JSON.parse(fs.readFileSync(ENV_FILE, 'utf8'));
  if (!cached.jwtSecret || cached.jwtSecret.length < 32) {
    throw new Error('.jp-e2e/env.json 의 서명 비밀이 유효하지 않다 — 부트스트랩을 다시 실행하라.');
  }
  return cached;
}

export const REST_URL = () => localEnv().restUrl;
export const ADMIN_URI = () => localEnv().adminUri;
export const PG_ENV = () => ({ ...process.env, PATH: `${localEnv().pgbin}:${process.env.PATH}` });
