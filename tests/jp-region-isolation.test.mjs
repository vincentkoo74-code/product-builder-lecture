import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import {
  auditLayer, auditManifest, fingerprint, jwtRole, readConst, loadConfig,
} from '../scripts/region-guard.mjs';

// V1.0_JP — KR/JP 리전 및 자격증명 혼입 방지 계약.
// 이 파일이 지키는 것: 일본 빌드에 한국 백엔드/자격증명이 섞이지 않고,
// CI 가 사람 확인 없이 타국 프로덕션에 배포할 수 없다.

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.c2lnbmF0dXJl`;

describe('[JP-ISO-1] 리전 선언과 레지스트리', () => {
  const { regions, activeRegion } = loadConfig(ROOT);

  it('이 브랜치는 JP 빌드로 선언되어 있다', () => {
    expect(activeRegion).toBe('JP');
  });

  it('KR/JP 프로필이 서로 다른 Supabase project 를 가리킨다', () => {
    expect(regions.KR.supabase_project_ref).toBeTruthy();
    expect(regions.JP.supabase_project_ref).toBeTruthy();
    expect(regions.KR.supabase_project_ref).not.toBe(regions.JP.supabase_project_ref);
  });

  it('KR/JP anon key 지문이 서로 다르다 (같은 키를 공유하지 않는다)', () => {
    expect(regions.KR.supabase_anon_key_fingerprint).not.toBe(regions.JP.supabase_anon_key_fingerprint);
  });

  it('레지스트리에 anon key 원문이 저장되어 있지 않다', () => {
    const raw = read('config/regions.json');
    expect(raw, 'regions.json 에 JWT 원문이 들어가면 안 된다').not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\./);
  });

  it('KR/JP 매치메이킹 풀이 분리되어 있다', () => {
    expect(regions.KR.matchmaking_pool).toBe('KR');
    expect(regions.JP.matchmaking_pool).toBe('JP');
  });
});

describe('[JP-ISO-2] source 계층이 JP 백엔드를 가리킨다', () => {
  const { regions, activeRegion } = loadConfig(ROOT);
  const html = read('index.html');

  it('SUPABASE_URL 이 JP(Tokyo) project ref 를 가리킨다', () => {
    expect(readConst(html, 'SUPABASE_URL')).toContain(regions[activeRegion].supabase_project_ref);
  });

  it('SUPABASE_ANON_KEY 지문이 JP 프로필과 일치한다', () => {
    expect(fingerprint(readConst(html, 'SUPABASE_ANON_KEY')))
      .toBe(regions[activeRegion].supabase_anon_key_fingerprint);
  });

  it('KR project ref 가 source 에 남아 있지 않다', () => {
    expect(html).not.toContain(regions.KR.supabase_project_ref);
  });

  it('source 에 service_role JWT 가 없다', () => {
    const tokens = html.match(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g) || [];
    expect(tokens.map(jwtRole)).not.toContain('service_role');
  });

  it('LINE 로그인은 Phase 2 까지 비활성으로 잠겨 있다', () => {
    expect(html).toContain('const ENABLE_LINE_LOGIN = false;');
  });
});

describe('[JP-ISO-3] 가드 규칙 자체가 동작한다', () => {
  const { regions, activeRegion } = loadConfig(ROOT);
  const base = { activeRegion, regions, exceptions: [] };
  const jpOk =
    `const SUPABASE_URL = "https://${regions.JP.supabase_project_ref}.supabase.co";\n` +
    `const SUPABASE_ANON_KEY = "__JP_ANON__";`;

  // 지문 검사를 통과시키려면 실제 JP anon key 가 필요하므로, 지문 규칙(R2)은
  // 별도로 검증하고 여기서는 R1/R3/R4/R5 만 본다.
  const rulesOf = (v) => new Set(v.map((x) => x.rule));

  it('R3 — KR project ref 가 섞이면 위반으로 잡는다', () => {
    const v = auditLayer({ ...base, layer: 'source',
      content: jpOk + `\n// leftover ${regions.KR.supabase_project_ref}` });
    expect(rulesOf(v)).toContain('R3');
  });

  it('R1 — 잘못된 리전을 가리키면 위반으로 잡는다', () => {
    const v = auditLayer({ ...base, layer: 'source',
      content: `const SUPABASE_URL = "https://${regions.KR.supabase_project_ref}.supabase.co";` });
    expect(rulesOf(v)).toContain('R1');
  });

  it('R4 — 타 리전 공개 식별자를 잡고, known_exceptions 로만 유예된다', () => {
    const kakao = regions.KR.public_client_ids.KAKAO_REST_API_KEY;
    const content = jpOk + `\nconst KAKAO_REST_API_KEY = "${kakao}";`;
    const strict = auditLayer({ ...base, layer: 'source', content });
    expect(strict.filter((x) => x.rule === 'R4' && x.severity === 'error')).toHaveLength(1);

    const waived = auditLayer({ ...base, layer: 'source', content,
      exceptions: [{ identifier: 'KAKAO_REST_API_KEY' }] });
    expect(waived.filter((x) => x.rule === 'R4' && x.severity === 'error')).toHaveLength(0);
    expect(waived.filter((x) => x.rule === 'R4' && x.severity === 'waived')).toHaveLength(1);
  });

  it('R5 — service_role JWT 는 어떤 예외로도 유예되지 않는다', () => {
    const content = jpOk + `\nconst LEAK = "${jwt({ role: 'service_role' })}";`;
    const v = auditLayer({ ...base, layer: 'source', content,
      exceptions: [{ identifier: 'KAKAO_REST_API_KEY' }] });
    const r5 = v.filter((x) => x.rule === 'R5');
    expect(r5).toHaveLength(1);
    expect(r5[0].severity).toBe('critical');
  });

  it('R5 — anon JWT 는 통과시킨다', () => {
    const v = auditLayer({ ...base, layer: 'source',
      content: jpOk + `\nconst OK = "${jwt({ role: 'anon' })}";` });
    expect(rulesOf(v)).not.toContain('R5');
  });

  it('R6 — 타 국가 빌드 산출물 스탬프를 잡는다', () => {
    const stale = auditManifest({ layer: 'ios:manifest', activeRegion, regions,
      content: JSON.stringify({ region: 'KR', supabase_project_ref: regions.KR.supabase_project_ref }) });
    expect(stale.length).toBeGreaterThan(0);

    const fresh = auditManifest({ layer: 'dist:manifest', activeRegion, regions,
      content: JSON.stringify({ region: 'JP', supabase_project_ref: regions.JP.supabase_project_ref }) });
    expect(fresh).toHaveLength(0);
  });

  it('R6 — region 스탬프가 없는 구형 매니페스트도 잡는다', () => {
    const v = auditManifest({ layer: 'dist:manifest', activeRegion, regions,
      content: JSON.stringify({ product: 'WooriMaru RPS', build: 37 }) });
    expect(v.length).toBeGreaterThan(0);
  });
});

describe('[JP-ISO-4] 빌드 산출물에 국가 스탬프가 찍힌다', () => {
  const { regions, activeRegion } = loadConfig(ROOT);

  it('dist/BUILD_MANIFEST.json 이 JP 로 스탬프되어 있다', () => {
    const rel = 'dist/BUILD_MANIFEST.json';
    if (!existsSync(path.join(ROOT, rel))) return; // dist 는 git 미추적 산출물
    const m = JSON.parse(read(rel));
    expect(m.region).toBe(activeRegion);
    expect(m.supabase_project_ref).toBe(regions[activeRegion].supabase_project_ref);
  });
});

describe('[JP-ISO-5] CI 가 타국 프로덕션을 자동 배포하지 못한다', () => {
  const deploy = read('.github/workflows/supabase-deploy.yml');

  it('Supabase 배포 워크플로에 자동 push 트리거가 없다', () => {
    const onBlock = deploy.slice(deploy.indexOf('\non:'), deploy.indexOf('\nconcurrency:'));
    expect(onBlock, 'push 트리거가 다시 들어오면 타국 프로덕션 자동 배포가 부활한다')
      .not.toMatch(/^\s{2}push:/m);
    expect(onBlock).toMatch(/workflow_dispatch:/);
  });

  it('배포 대상 project ref 가 하드코딩되어 있지 않다', () => {
    const { regions } = loadConfig(ROOT);
    for (const r of Object.values(regions)) {
      expect(deploy, `${r.code} project ref 하드코딩 금지`).not.toContain(r.supabase_project_ref);
    }
    expect(deploy).toContain('config/regions.json');
  });

  it('배포 전 타이핑 확인과 브랜치 리전 일치 검사를 수행한다', () => {
    expect(deploy).toContain('confirm_project_ref');
    expect(deploy).toContain('config/active-region.json');
  });

  it('smoke 테스트도 project ref 를 하드코딩하지 않는다', () => {
    const smoke = read('.github/workflows/production-smoke.yml');
    const { regions } = loadConfig(ROOT);
    for (const r of Object.values(regions)) {
      expect(smoke).not.toContain(r.supabase_project_ref);
    }
  });
});

describe('[JP-ISO-6] Supabase CLI 링크 상태가 git 에 추적되지 않는다', () => {
  it('supabase/.temp 가 추적 대상에서 빠져 있다', () => {
    const tracked = execSync('git ls-files supabase/.temp', { cwd: ROOT }).toString().trim();
    expect(tracked, 'supabase/.temp 가 추적되면 브랜치 전환 시 잘못된 프로젝트 링크가 상속된다').toBe('');
  });

  it('.gitignore 가 supabase/.temp 를 무시한다', () => {
    expect(read('.gitignore')).toMatch(/^supabase\/\.temp\/$/m);
  });
});
