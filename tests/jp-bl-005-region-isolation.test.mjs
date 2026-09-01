// JP-BL-005 — JP 런타임이 KR/Seoul 백엔드에 도달할 수 없다 (구조적 잠금)
//
// 라이브 검증(tests/e2e/jp-region-isolation-live.spec.mjs)은 "지금 그렇다"를 관측한다.
// 이 스위트는 그 결과를 지탱하는 **구조**를 잠근다 — 백엔드 선택 지점이 하나뿐이고,
// 그 하나가 런타임 입력으로 바뀌지 않는다는 것.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const regions = JSON.parse(readFileSync(new URL('../config/regions.json', import.meta.url), 'utf8'));
const active = JSON.parse(readFileSync(new URL('../config/active-region.json', import.meta.url), 'utf8'));
// 주석만 걷어낸다. `https://` 의 `//` 를 주석으로 오인하지 않도록 앞 문자가 ':' 이면 남긴다 —
// 그러지 않으면 백엔드 URL 리터럴이 통째로 사라져 검사가 공허해진다(실제로 그랬다).
const codeOnly = (b) => b.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
const CODE = codeOnly(html);

const JP_REF = 'cmfxhehpreanijwanwrr';
const KR_REF = regions.regions.KR.supabase_project_ref;

describe('[JP-BL-005] §4 리전 단일 기준', () => {
  it('선언 리전이 JP 다', () => {
    expect(active.region).toBe('JP');
    expect(regions.regions.JP.supabase_project_ref).toBe(JP_REF);
    expect(regions.regions.JP.cloud_region_label).toMatch(/ap-northeast-1|Tokyo/i);
  });
  it('백엔드 URL 리터럴이 정확히 하나이고 JP ref 를 가리킨다', () => {
    const urls = CODE.match(/https:\/\/[a-z0-9]+\.supabase\.co/g) || [];
    expect([...new Set(urls)], 'supabase 호스트 리터럴은 하나여야 한다').toEqual([`https://${JP_REF}.supabase.co`]);
  });
  it('createClient 호출이 정확히 하나이고 그 상수만 쓴다', () => {
    expect((CODE.match(/createClient\(/g) || []).length).toBe(1);
    expect(CODE).toContain('createClient(SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_AUTH_OPTIONS)');
  });
  it('anon key 의 ref 클레임이 JP 다 (URL 과 키가 같은 프로젝트)', () => {
    const key = (html.match(/const SUPABASE_ANON_KEY = "([^"]+)"/) || [])[1];
    expect(key).toBeTruthy();
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64').toString('utf8'));
    expect(payload.ref, 'anon key 가 다른 프로젝트를 가리키면 격리가 깨진다').toBe(JP_REF);
    expect(payload.role).toBe('anon');
  });
});

describe('[JP-BL-005] §5 KR/Seoul 참조 인벤토리 — A 등급(활성 의존) 0건', () => {
  it('실행 코드에 KR project ref 가 없다', () => {
    expect(CODE).not.toContain(KR_REF);
  });
  it('실행 코드에 KR 리전/도시 식별자가 없다', () => {
    expect(CODE).not.toMatch(/ap-northeast-2/i);
    expect(CODE, 'Seoul 언급은 주석에만 허용된다').not.toMatch(/["'`][^"'`]*[Ss]eoul[^"'`]*["'`]/);
  });
  it('KR 공개 클라이언트 식별자가 실행 코드에 없다', () => {
    for (const [, v] of Object.entries(regions.regions.KR.public_client_ids || {})) {
      expect(CODE, `KR 공개 식별자 유출`).not.toContain(v);
    }
  });
});

describe('[JP-BL-005] §11-E,F,G 런타임 입력으로 백엔드를 바꿀 수 없다', () => {
  it('URL 쿼리에서 project/region/backend 를 읽지 않는다', () => {
    for (const k of ['ref', 'region', 'supabase_url', 'project', 'project_ref', 'backend', 'endpoint']) {
      // 수신자를 특정하지 않는다 — `new URLSearchParams(...).get("ref")` 같은 형태도 잡아야 한다.
      // (수신자를 params/searchParams 로 좁혔더니 그 형태를 놓쳤다 — 비공허성 점검에서 드러났다.)
      expect(CODE, `쿼리 파라미터 '${k}' 로 백엔드가 바뀌면 안 된다`)
        .not.toMatch(new RegExp(`\\.get\\(\\s*["']${k}["']`, 'i'));
    }
  });
  it('저장소(localStorage/sessionStorage)에서 백엔드를 읽지 않는다', () => {
    for (const k of ['supabaseUrl', 'supabase_url', 'rpsRegion', 'projectRef', 'region']) {
      expect(CODE, `저장된 '${k}' 로 백엔드가 바뀌면 안 된다`)
        .not.toMatch(new RegExp(`(localStorage|sessionStorage)\\.getItem\\(\\s*["']${k}["']`, 'i'));
    }
  });
  it('SUPABASE_URL 이 재할당되지 않는다 (const 선언 1회)', () => {
    expect((CODE.match(/\bSUPABASE_URL\s*=/g) || []).length, 'SUPABASE_URL 대입은 선언 1회뿐이어야 한다').toBe(1);
    expect(CODE).toMatch(/const SUPABASE_URL = "https:\/\//);
  });
  it('db 는 같은 팩토리로만 만들어진다', () => {
    const assigns = CODE.split('\n').filter((l) => /\bdb\s*=\s*/.test(l) && !/==/.test(l));
    for (const a of assigns) expect(a, `db 대입: ${a.trim()}`).toMatch(/createSupabaseClient\(\)|null/);
  });
});

describe('[JP-BL-005] §10 현재 매칭 표면 — 열린 매치메이킹이 없다', () => {
  it('공개 방 검색/랜덤 매칭 경로가 없다', () => {
    for (const bad of ['auto_match', 'autoMatch', 'randomMatch', 'quickMatch', 'matchmaking', 'findOpenRoom']) {
      expect(CODE, `${bad} 경로가 생기면 리전 격리를 다시 검증해야 한다`).not.toContain(bad);
    }
  });
  it('방 조회는 항상 id/invite_token 으로 좁혀진다 (전체 스캔 없음)', () => {
    const roomSelects = CODE.split('\n').filter((l) => /from\('rooms'\)\s*\.select\(/.test(l));
    expect(roomSelects.length).toBeGreaterThan(0);
    for (const l of roomSelects) {
      // 허용: 단건 조회(.eq id/invite_token) 또는 **본인이 최근 참여한 방 목록**(.in('id', …)).
      // 둘 다 클라이언트가 이미 아는 식별자로 좁힌다 — 공개 검색이 아니다.
      expect(l, `좁혀지지 않은 rooms 조회: ${l.trim().slice(0, 90)}`)
        .toMatch(/\.eq\(['"](id|invite_token)['"]|\.in\(['"]id['"]/);
    }
  });

  it('recent-room 탐색은 로컬에 저장된 자기 방 코드로만 좁힌다 (공개 검색 아님)', () => {
    // CEO §10 인벤토리 대상: 유일한 "방 발견" 표면이다.
    const blk = html.slice(html.indexOf('const recentRooms = getRecentRoomCodes()'));
    const seg = blk.slice(0, blk.indexOf('\n    }'));
    expect(seg).toContain("db.from('rooms').select('id,status').in('id', recentRooms)");
    // 목록이 비면 조회 자체를 하지 않는다 — 빈 필터로 전체를 긁지 않는다.
    expect(seg).toContain('if (!recentRooms.length) return;');
    // 그리고 그 코드는 자기 단말이 저장한 것이다(서버 검색이 아니다).
    expect(html).toContain('function getRecentRoomCodes');
  });
});

describe('[JP-BL-005] §13 설정/CI 리전 가드', () => {
  const deploy = readFileSync(new URL('../.github/workflows/supabase-deploy.yml', import.meta.url), 'utf8');
  const gate = readFileSync(new URL('../.github/workflows/release-gate.yml', import.meta.url), 'utf8');

  it('배포 워크플로가 자동 트리거되지 않는다 (수동 dispatch 전용)', () => {
    expect(deploy).toContain('workflow_dispatch');
    expect(deploy, 'push 트리거가 있으면 머지만으로 프로덕션에 나간다').not.toMatch(/^\s{2}push:/m);
  });
  it('project ref 를 하드코딩하지 않고 레지스트리에서 도출한다', () => {
    expect(deploy).toContain('config/regions.json');
    expect(deploy).not.toContain(JP_REF);
    expect(deploy).not.toContain(KR_REF);
  });
  it('오배포 방지: 대상 ref 를 타이핑해야 진행된다 + 환경 승인 게이트', () => {
    expect(deploy).toContain('confirm_project_ref');
    expect(deploy).toMatch(/environment:\s*supabase-\$\{\{\s*inputs\.region\s*\}\}/);
  });
  it('릴리스 게이트가 region-guard 를 release 모드로 돌린다', () => {
    expect(gate).toContain('region-guard.mjs --release');
  });
});
