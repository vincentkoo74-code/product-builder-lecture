import { describe, it, expect } from 'vitest';
import fs, { readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { execSync } from 'node:child_process';
import path from 'node:path';
import {
  auditLayer, auditManifest, fingerprint, jwtRole, readConst, findConst,
  stripComments, classify, runGuard, loadConfig,
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

describe('[JP-ISO-1b] 레지스트리가 CI 워크플로의 계약을 만족한다', () => {
  // .github/workflows 가 jq 로 읽는 필드들이다. 타입이 어긋나면 배포/스모크가
  // 런타임에 죽는다 (예: edge_functions_deployed 를 문자열로 바꾸면 join(" ") 실패).
  const { regions } = loadConfig(ROOT);

  for (const [code, r] of Object.entries(regions)) {
    it(`${code}: supabase_project_ref 는 비어 있지 않은 문자열이다`, () => {
      expect(typeof r.supabase_project_ref).toBe('string');
      expect(r.supabase_project_ref.length).toBeGreaterThan(0);
    });

    it(`${code}: cloud_region_label 은 비어 있지 않은 문자열이다`, () => {
      expect(typeof r.cloud_region_label).toBe('string');
      expect(r.cloud_region_label.length).toBeGreaterThan(0);
    });

    it(`${code}: edge_functions_deployed 는 배열이다 (production-smoke.yml 의 join 의존)`, () => {
      expect(Array.isArray(r.edge_functions_deployed), 'jq join(" ") 이 문자열에서는 실패한다').toBe(true);
      for (const fn of r.edge_functions_deployed) expect(typeof fn).toBe('string');
    });

    it(`${code}: public_client_ids 는 문자열 값을 갖는 객체다 (R4 스캔이 의존)`, () => {
      expect(typeof r.public_client_ids).toBe('object');
      for (const v of Object.values(r.public_client_ids || {})) expect(typeof v).toBe('string');
    });
  }
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

describe('[JP-ISO-7] codex-critic 지적 사항 회귀 잠금', () => {
  const { regions, activeRegion } = loadConfig(ROOT);
  const base = { activeRegion, regions, exceptions: [] };
  const jpOk =
    `const SUPABASE_URL = "https://${regions.JP.supabase_project_ref}.supabase.co";\n` +
    `const SUPABASE_ANON_KEY = "x";`;

  // H1 — CLI 진입점이 공백/한글 경로에서 조용히 통과하던 문제.
  it('H1: 공백이 든 경로에서도 CLI 가 실제로 검사하고 종료코드를 낸다', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'guard space '));
    try {
      fs.cpSync(path.join(ROOT, 'config'), path.join(tmp, 'config'), { recursive: true });
      fs.cpSync(path.join(ROOT, 'scripts'), path.join(tmp, 'scripts'), { recursive: true });
      // index.html 없음 → R7 로 반드시 FAIL 해야 한다(조용한 exit 0 금지).
      const r = spawnSync(process.execPath, [path.join(tmp, 'scripts', 'region-guard.mjs')], { encoding: 'utf8' });
      expect(r.stdout + r.stderr, 'CLI 가 아무 출력도 없이 끝나면 검사 자체가 실행되지 않은 것이다').not.toBe('');
      expect(r.status, '검사 불가 상태가 통과로 취급되면 안 된다').not.toBe(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  // M2/R7 — 스캔 0건을 통과로 취급하지 않는다.
  it('R7: 필수 계층을 검사하지 못하면 위반으로 잡는다', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-empty-'));
    try {
      fs.cpSync(path.join(ROOT, 'config'), path.join(tmp, 'config'), { recursive: true });
      const { scanned, violations } = runGuard(tmp);
      expect(scanned).toHaveLength(0);
      expect(violations.map(v => v.rule)).toContain('R7');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  // M1 — 주석 처리된 옛 선언을 진짜 값으로 오인하지 않는다.
  it('M1: 주석 처리된 상수 선언을 값으로 읽지 않는다', () => {
    const html = `// const SUPABASE_URL = "https://commented.supabase.co";\n` +
                 `const SUPABASE_URL = "https://real.supabase.co";`;
    expect(stripComments(html)).not.toContain('commented');
    expect(readConst(html, 'SUPABASE_URL')).toBe('https://real.supabase.co');
  });

  it('M1: URL 안의 // 는 주석으로 오인하지 않는다', () => {
    expect(readConst(jpOk, 'SUPABASE_URL')).toContain(regions.JP.supabase_project_ref);
  });

  it('M1: 유효 선언이 2개 이상이면 모호하므로 통과시키지 않는다', () => {
    const dup = jpOk + `\nconst SUPABASE_URL = "https://other.supabase.co";`;
    expect(findConst(dup, 'SUPABASE_URL').count).toBe(2);
    const v = auditLayer({ ...base, layer: 'source', content: dup });
    expect(v.filter(x => x.rule === 'R1' && x.severity === 'error').length).toBeGreaterThan(0);
  });

  // M3 — 유예는 (owner_region, identifier) 쌍으로만 성립한다.
  it('M3: owner_region 이 다른 예외는 유예로 인정되지 않는다', () => {
    const kakao = regions.KR.public_client_ids.KAKAO_REST_API_KEY;
    const content = jpOk + `\nconst KAKAO_REST_API_KEY = "${kakao}";`;
    const wrongOwner = auditLayer({ ...base, layer: 'source', content,
      exceptions: [{ id: 'X', identifier: 'KAKAO_REST_API_KEY', owner_region: 'ZZ' }] });
    expect(wrongOwner.filter(x => x.rule === 'R4' && x.severity === 'error')).toHaveLength(1);

    const rightOwner = auditLayer({ ...base, layer: 'source', content,
      exceptions: [{ id: 'X', identifier: 'KAKAO_REST_API_KEY', owner_region: 'KR' }] });
    expect(rightOwner.filter(x => x.rule === 'R4' && x.severity === 'error')).toHaveLength(0);
  });

  // M4 — blocks_release 가 장식이 아니라 실제로 동작한다.
  it('M4: release 모드에서 blocks_release 유예가 차단으로 승격된다', () => {
    const kakao = regions.KR.public_client_ids.KAKAO_REST_API_KEY;
    const content = jpOk + `\nconst KAKAO_REST_API_KEY = "${kakao}";`;
    const v = auditLayer({ ...base, layer: 'source', content,
      exceptions: [{ id: 'JPX-001', identifier: 'KAKAO_REST_API_KEY', owner_region: 'KR', blocks_release: true }] });

    const r4 = v.filter(x => x.rule === 'R4');
    expect(classify(r4, { releaseMode: false }).blocking).toHaveLength(0);
    expect(classify(r4, { releaseMode: true }).blocking).toHaveLength(1);
  });

  // JP-BL-002(2026-09-01): KR 공개 키가 **source/dist 에서 제거**됐다(시장 프로필 소유로 전환).
  // 그래서 이 검증은 두 갈래로 나뉜다 — 둘 다 이전보다 강한 주장이다.
  it('M4-a: source 층에는 이제 KR 공개 식별자가 없다 (JP-BL-002 결과)', () => {
    const { violations } = runGuard(ROOT, { layers: ['source'] });
    const kakaoHits = violations.filter(v => v.rule === 'R4' && String(v.detail || '').includes('KAKAO_REST_API_KEY'));
    expect(kakaoHits, 'JP 소스에 KR 공개 키가 다시 들어오면 안 된다').toHaveLength(0);
  });

  it('M4-b: active-region.json 의 blocks_release 예외는 release 모드에서 실제로 차단된다', () => {
    // JPX-001 은 아직 재생성되지 않은 네이티브 산출물(ios/android)에 남아 있다 — 그 층에서 검증한다.
    const { violations } = runGuard(ROOT);
    const waivedBlocking = violations.filter(v => v.severity === 'waived' && v.blocksRelease);
    expect(waivedBlocking.length, 'JPX-001 이 blocks_release 로 표시되어야 한다').toBeGreaterThan(0);
    expect(classify(violations, { releaseMode: true }).blocking.length).toBeGreaterThan(0);
  });

  // H2 — index.html 외 배포 자산도 시크릿 스캔 대상이다.
  it('H2: index.html 이 아닌 배포 자산도 스캔한다', () => {
    const { scanned } = runGuard(ROOT);
    expect(scanned.some(s => s.startsWith('assets ')), 'dist/네이티브 자산 스캔이 빠졌다').toBe(true);
  });

  it('H2: 자산 파일의 service_role JWT 도 잡는다 (상수 검사 없이)', () => {
    const v = auditLayer({ ...base, layer: 'dist:main.js', checkConstants: false,
      content: `const K="${jwt({ role: 'service_role' })}";` });
    expect(v.filter(x => x.rule === 'R5' && x.severity === 'critical')).toHaveLength(1);
    expect(v.map(x => x.rule)).not.toContain('R1');
  });

  // M5 — LINE 플래그의 의도가 주석과 일치한다.
  it('M5: LINE 활성화를 지시하는 낡은 KR 주석이 남아 있지 않다', () => {
    expect(read('index.html')).not.toContain('JP 빌드 전환 시 true로 변경');
  });
});

describe('[JP-ISO-8] 재검토 잔존 갭 회귀 잠금', () => {
  // M1 잔존 — 블록 주석 안에 "유일하게 하나" 남은 선언을 실값으로 오인하면 안 된다.
  it('M1: 블록 주석 안의 단독 선언은 선언 없음으로 취급한다', () => {
    const dead = '/* 삭제 예정\nconst SUPABASE_URL = "https://stale.supabase.co";\n*/\n';
    expect(findConst(dead, 'SUPABASE_URL').count, '죽은 값을 유일한 정답으로 받아들이면 안 된다').toBe(0);
  });

  it('M1: 블록 주석 제거가 살아 있는 선언을 훼손하지 않는다', () => {
    const html = read('index.html');
    const { regions, activeRegion } = loadConfig(ROOT);
    const u = findConst(html, 'SUPABASE_URL');
    expect(u.count).toBe(1);
    expect(u.value).toContain(regions[activeRegion].supabase_project_ref);
  });

  it('M1: 선언이 전혀 없으면 R1/R2 위반으로 잡는다', () => {
    const { regions, activeRegion } = loadConfig(ROOT);
    const v = auditLayer({ activeRegion, regions, exceptions: [], layer: 'source',
      content: '/* const SUPABASE_URL = "https://x.supabase.co"; */' });
    expect(v.filter(x => x.rule === 'R1' && x.severity === 'error').length).toBeGreaterThan(0);
  });

  // M4 잔존 — 출시 모드 가드가 실제 릴리즈 파이프라인에 연결돼 있어야 한다.
  it('M4: release-gate 워크플로가 출시 모드 리전 가드를 실행한다', () => {
    const gate = read('.github/workflows/release-gate.yml');
    expect(gate, 'blocks_release 가 사람의 기억에만 의존하면 장식과 같다')
      .toMatch(/region-guard\.mjs --release/);
  });

  it('M4: 출시 절차 문서가 출시 모드 실행을 명시한다', () => {
    const dep = read('docs/DEPLOYMENT.md');
    expect(dep).toMatch(/MARU_RELEASE_BUILD=1/);
    expect(dep).toMatch(/region-guard\.mjs --release/);
  });
});
