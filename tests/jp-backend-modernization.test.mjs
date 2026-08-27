import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

// V1.0_JP — 백엔드 현대화 마이그레이션 계약.
//
// 이 파일이 지키는 것: 클라이언트가 **실제로 호출하는 연산**과 마이그레이션이 **부여하는
// 권한/정책**이 정확히 일치한다. 부족하면 게임이 깨지고, 남으면 최소 권한이 아니다.
// CEO 요구에 따라 모든 allow 경로에는 대응하는 deny 단언을 둔다.

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const MIG = 'supabase/migrations';
// 실행되는 SQL 만 남긴다. deny 단언은 반드시 이 위에서 수행해야 한다 —
// 주석(근거 설명·Rollback 절)에 등장하는 문자열을 결함으로 오인하지 않기 위함이다.
const execSql = (s) => s.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');

const mig = (frag) => {
  const f = readdirSync(path.join(ROOT, MIG)).find((n) => n.includes(frag));
  if (!f) throw new Error(`마이그레이션을 찾지 못했다: ${frag}`);
  return read(path.join(MIG, f));
};

// ── 클라이언트 호출 지점에서 필요한 연산을 도출한다(정적 추출) ──────────────
function callSiteOps() {
  // 주석 줄을 먼저 제거한다 — 주석 안의 `.from(...)` 예시를 호출 지점으로 세지 않는다.
  const html = read('index.html').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const lines = html.split('\n');
  const pat = /\.from\(\s*['"]([a-z_]+)['"]\s*\)/g;
  const ops = {};
  lines.forEach((line, i) => {
    for (const m of line.matchAll(pat)) {
      const tbl = m[1];
      // 체이닝 범위를 **문장 경계까지**로 자른다: 다음 `.from(` 또는 `;` 중 먼저 오는 곳.
      // (이 경계를 두지 않으면 인접한 다른 테이블 호출의 연산자를 잘못 귀속시킬 수 있다.)
      let chain = (line.slice(m.index + m[0].length) + ' ' + lines.slice(i + 1, i + 5).join(' '))
        .replace(/\s+/g, ' ');
      const nextFrom = chain.indexOf('.from(');
      if (nextFrom >= 0) chain = chain.slice(0, nextFrom);
      const semi = chain.indexOf(';');
      if (semi >= 0) chain = chain.slice(0, semi);

      for (const k of ['insert', 'upsert', 'update', 'delete', 'select']) {
        if (new RegExp(`\\.${k}\\(`).test(chain)) {
          (ops[tbl] ??= new Set()).add(k === 'upsert' ? 'insert+update' : k);
          break;
        }
      }
    }
  });
  return ops;
}

const OPS = callSiteOps();
const has = (tbl, op) => {
  const s = OPS[tbl];
  if (!s) return false;
  return [...s].some((x) => x === op || (x === 'insert+update' && (op === 'insert' || op === 'update')));
};

describe('[JP-MOD-1] 호출 지점 접근 행렬', () => {
  it('4개 테이블 모두 호출 지점이 추출된다', () => {
    for (const t of ['rooms', 'participants', 'user_game_stats', 'user_game_history']) {
      expect(OPS[t], `${t} 호출 지점 추출 실패`).toBeTruthy();
    }
  });

  // allow 경로
  it('rooms: select / insert / update 를 사용한다', () => {
    for (const op of ['select', 'insert', 'update']) expect(has('rooms', op), `rooms.${op}`).toBe(true);
  });
  it('participants: select / insert / update / delete 를 사용한다', () => {
    for (const op of ['select', 'insert', 'update', 'delete']) expect(has('participants', op), `participants.${op}`).toBe(true);
  });
  it('user_game_stats: select 와 upsert(insert+update) 를 사용한다', () => {
    expect(has('user_game_stats', 'select')).toBe(true);
    expect(has('user_game_stats', 'insert')).toBe(true);
    expect(has('user_game_stats', 'update')).toBe(true);
  });
  it('user_game_history: select 와 insert 를 사용한다', () => {
    expect(has('user_game_history', 'select')).toBe(true);
    expect(has('user_game_history', 'insert')).toBe(true);
  });

  // deny 경로 — 이 단언이 깨지면 GRANT 를 넓혀야 한다는 신호다.
  it('rooms 를 DELETE 하는 호출 지점이 없다 (rooms DELETE 회수의 근거)', () => {
    expect(has('rooms', 'delete'), 'rooms.delete 호출이 생겼다면 GRANT/RLS 설계를 재검토해야 한다').toBe(false);
  });
  it('user_game_history 를 UPDATE/DELETE 하는 호출 지점이 없다', () => {
    expect(has('user_game_history', 'update')).toBe(false);
    expect(has('user_game_history', 'delete')).toBe(false);
  });
  it('user_game_stats 를 DELETE 하는 호출 지점이 없다', () => {
    expect(has('user_game_stats', 'delete')).toBe(false);
  });
});

describe('[JP-MOD-2] GRANT 마이그레이션이 호출 행렬과 정확히 일치한다', () => {
  const sql = mig('jp_v1_grants_least_privilege');
  const norm = sql.replace(/\s+/g, ' ');

  it('클라이언트 롤의 기존 권한을 전부 회수한 뒤 재부여한다', () => {
    for (const t of ['rooms', 'participants', 'user_game_stats', 'user_game_history']) {
      expect(norm).toMatch(new RegExp(`revoke all on public\\.${t} from anon, authenticated`));
    }
    expect(norm).toMatch(/revoke all on sequence public\.user_game_history_id_seq from anon, authenticated/);
  });

  // allow
  it('rooms: anon/authenticated 에 select,insert,update 부여', () => {
    expect(norm).toMatch(/grant select, insert, update on public\.rooms to anon, authenticated/);
  });
  it('participants: anon/authenticated 에 select,insert,update,delete 부여', () => {
    expect(norm).toMatch(/grant select, insert, update, delete on public\.participants to anon, authenticated/);
  });
  it('계정 전적: authenticated 에만 부여 + 시퀀스 USAGE', () => {
    expect(norm).toMatch(/grant select, insert, update on public\.user_game_stats to authenticated/);
    expect(norm).toMatch(/grant select, insert on public\.user_game_history to authenticated/);
    expect(norm).toMatch(/grant usage on sequence public\.user_game_history_id_seq to authenticated/);
  });

  // deny
  it('rooms 에 DELETE 를 부여하지 않는다', () => {
    expect(execSql(sql).replace(/\s+/g, ' ')).not.toMatch(/grant[^;]*delete[^;]*on public\.rooms/);
  });
  it('anon 에 계정 전적 권한을 부여하지 않는다', () => {
    const e = execSql(sql).replace(/\s+/g, ' ');
    expect(e).not.toMatch(/grant[^;]*on public\.user_game_stats to[^;]*anon/);
    expect(e).not.toMatch(/grant[^;]*on public\.user_game_history to[^;]*anon/);
  });
  it('파괴적 권한(TRUNCATE/REFERENCES/TRIGGER/MAINTAIN)을 부여하지 않는다', () => {
    for (const p of ['truncate', 'references', 'trigger', 'maintain']) {
      expect(execSql(sql).replace(/\s+/g, ' ').toLowerCase()).not.toMatch(new RegExp(`grant[^;]*\\b${p}\\b[^;]*to (anon|authenticated)`));
    }
  });
  it('service_role 권한을 이 파일에서 축소하지 않는다 (서버 사이드 전용 유지)', () => {
    expect(execSql(sql).replace(/\s+/g, ' ')).not.toMatch(/revoke[^;]*from[^;]*service_role/);
  });

  it('부여 후 자기검증 블록이 파괴적 권한 잔존과 과잉 회수를 모두 확인한다', () => {
    for (const p of ['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) expect(sql).toContain(p);
    expect(sql).toMatch(/has_sequence_privilege\('authenticated'/);
    expect(sql).toMatch(/게임플레이 권한이 부족하다/);
  });
});

describe('[JP-MOD-3] 목표 RLS', () => {
  const sql = mig('jp_v1_rls_target');
  const norm = sql.replace(/\s+/g, ' ');

  it('allow-all 정책을 제거한다', () => {
    expect(norm).toMatch(/drop policy if exists "allow_all_rooms" on public\.rooms/);
    expect(norm).toMatch(/drop policy if exists "allow_all_participants" on public\.participants/);
  });
  it('allow-all 정책을 다시 만들지 않는다', () => {
    expect(execSql(sql).replace(/\s+/g, ' ')).not.toMatch(/create policy "allow_all_/);
  });

  // allow
  it('rooms: select / insert / update 정책이 있다', () => {
    for (const op of ['select', 'insert', 'update']) {
      expect(norm).toMatch(new RegExp(`create policy jp_rooms_${op} on public\\.rooms for ${op}`));
    }
  });
  it('participants: select / insert / update / delete 정책이 있다', () => {
    for (const op of ['select', 'insert', 'update', 'delete']) {
      expect(norm).toMatch(new RegExp(`create policy jp_participants_${op} on public\\.participants for ${op}`));
    }
  });

  // deny
  it('rooms DELETE 정책을 만들지 않는다 (GRANT 회수와 이중 방어)', () => {
    expect(execSql(sql).replace(/\s+/g, ' ')).not.toMatch(/create policy [a-z_]* on public\.rooms for delete/);
  });
  it('파괴적 연산에 시간 창이 걸려 있다', () => {
    for (const p of ['jp_rooms_update', 'jp_participants_update', 'jp_participants_delete']) {
      const block = norm.slice(norm.indexOf(`create policy ${p}`));
      expect(block.slice(0, 400), `${p} 에 시간 창 없음`).toMatch(/created_at > now\(\) - interval '24 hours'/);
    }
  });
  // codex-critic H-1 회귀 잠금: 하한만 두면 미래 시각으로 "불멸 행"을 만들 수 있다.
  it('시간 창은 상한과 하한을 모두 갖는다 (H-1 회귀 방지)', () => {
    for (const p of ['jp_rooms_update', 'jp_participants_update', 'jp_participants_delete',
                     'jp_rooms_insert', 'jp_participants_insert']) {
      const i = norm.indexOf(`create policy ${p}`);
      expect(i, `${p} 정책 없음`).toBeGreaterThan(-1);
      const block = norm.slice(i, i + 600);
      expect(block, `${p}: created_at 상한 없음 — 미래 시각으로 창 우회 가능`)
        .toMatch(/created_at <= now\(\) \+ interval '1 minute'/);
    }
  });

  it('UPDATE 는 USING 과 WITH CHECK 양쪽에 시간 창을 건다', () => {
    for (const p of ['jp_rooms_update', 'jp_participants_update']) {
      const i = norm.indexOf(`create policy ${p}`);
      const block = norm.slice(i, i + 600);
      expect(block).toMatch(/using \(created_at > now\(\) - interval '24 hours'/);
      expect(block).toMatch(/with check \(created_at > now\(\) - interval '24 hours'/);
    }
  });
  it('participants INSERT 는 최근 방에만 허용된다', () => {
    const block = norm.slice(norm.indexOf('create policy jp_participants_insert'));
    expect(block.slice(0, 500)).toMatch(/exists \( select 1 from public\.rooms r where r\.id = room_id and r\.created_at > now\(\) - interval '24 hours' \)/);
  });
  it('SELECT 에는 시간 창을 걸지 않는다 (의도적 — 읽기 동작 무변경)', () => {
    for (const p of ['jp_rooms_select', 'jp_participants_select']) {
      const block = norm.slice(norm.indexOf(`create policy ${p}`), norm.indexOf(`create policy ${p}`) + 200);
      expect(block).toMatch(/using \(true\)/);
    }
  });
  it('계정 전적 정책은 소유자 범위이며 대상 롤이 authenticated 로 명시된다', () => {
    expect(norm).toMatch(/on public\.user_game_stats for select to authenticated using \(auth\.uid\(\) = user_id\)/);
    expect(norm).toMatch(/on public\.user_game_history for insert to authenticated with check \(auth\.uid\(\) = user_id\)/);
    expect(execSql(sql).replace(/\s+/g, ' ')).not.toMatch(/on public\.user_game_(stats|history) for delete/);
  });
  it('status enum 제약을 넣지 않는다 (전수 증명 불가 — JP-BL-025 로 이월)', () => {
    expect(execSql(sql).replace(/\s+/g, ' ')).not.toMatch(/status (in|= any)/i);
  });
});

describe('[JP-MOD-4] baseline / index / realtime', () => {
  it('baseline 이 rooms·participants 를 멱등 생성하고 컬럼 드리프트를 검사한다', () => {
    const sql = mig('jp_v1_baseline_rooms_participants');
    expect(sql).toMatch(/create table if not exists public\.rooms/);
    expect(sql).toMatch(/create table if not exists public\.participants/);
    expect(sql).toMatch(/leave_after_round boolean not null default false/);
    expect(sql).toMatch(/references public\.rooms\(id\) on delete cascade/);
    expect(sql).toMatch(/기대한 컬럼이 없다/);
    expect(execSql(sql), 'baseline 은 파괴적 구문을 포함하면 안 된다').not.toMatch(/drop table/i);
  });

  it('baseline 컬럼 집합이 라이브 감사 기록과 일치한다', () => {
    const sql = mig('jp_v1_baseline_rooms_participants');
    const live = ['id', 'room_id', 'name', 'is_host', 'choice', 'wins', 'losses',
                  'draws', 'penalties', 'created_at', 'is_ready', 'leave_after_round'];
    const block = sql.slice(sql.indexOf('create table if not exists public.participants'));
    for (const c of live) expect(block.slice(0, 900), `participants.${c} 누락`).toContain(c);
  });

  it('index 마이그레이션이 participants.room_id 인덱스를 만든다', () => {
    const sql = mig('jp_v1_participants_room_id_index');
    expect(sql).toMatch(/create index if not exists participants_room_id_idx\s+on public\.participants \(room_id\)/);
    expect(execSql(sql), 'CONCURRENTLY 는 트랜잭션 안에서 실행 불가').not.toMatch(/concurrently/i);
  });

  it('realtime 마이그레이션이 두 테이블을 멱등 등록한다', () => {
    const sql = mig('jp_v1_realtime_publication');
    expect(sql).toMatch(/alter publication supabase_realtime add table public\.rooms/);
    expect(sql).toMatch(/alter publication supabase_realtime add table public\.participants/);
    expect(sql).toMatch(/등록 실패/);
  });
});

describe('[JP-MOD-5] 마이그레이션 세트 위생', () => {
  const files = readdirSync(path.join(ROOT, MIG)).filter((f) => f.endsWith('.sql')).sort();

  it('KR 전용 grants 마이그레이션은 JP 브랜치에 없다', () => {
    expect(files.find((f) => f.includes('account_game_stats_grants')),
      'Tokyo 에서 anon 권한 단언에 걸려 중단되는 KR 전용 파일이다').toBeUndefined();
  });

  it('모든 JP 마이그레이션이 트랜잭션으로 감싸여 있다', () => {
    for (const f of files.filter((f) => f.includes('jp_v1'))) {
      const s = read(path.join(MIG, f));
      expect(s, `${f}: begin 없음`).toMatch(/^begin;$/m);
      expect(s, `${f}: commit 없음`).toMatch(/^commit;$/m);
    }
  });

  it('모든 JP 마이그레이션에 자기검증(raise exception) 블록이 있다', () => {
    for (const f of files.filter((f) => f.includes('jp_v1'))) {
      expect(read(path.join(MIG, f)), `${f}: 자기검증 없음`).toMatch(/raise exception/);
    }
  });

  it('어떤 마이그레이션도 데이터를 파괴하지 않는다', () => {
    for (const f of files) {
      const body = read(path.join(MIG, f))
        .split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
      expect(body, `${f}: drop table`).not.toMatch(/\bdrop\s+table\b/i);
      expect(body, `${f}: truncate`).not.toMatch(/\btruncate\s+table\b/i);
      expect(body, `${f}: delete from`).not.toMatch(/\bdelete\s+from\b/i);
    }
  });

  it('권한/정책 변경 파일은 PostgREST 스키마 캐시를 갱신한다', () => {
    for (const frag of ['jp_v1_grants_least_privilege', 'jp_v1_rls_target']) {
      expect(mig(frag)).toMatch(/notify pgrst, 'reload schema'/);
    }
  });

  it('원장 복구 전략이 문서화되어 있다', () => {
    expect(existsSync(path.join(ROOT, 'docs/JP_BACKEND_MODERNIZATION_DESIGN.md'))).toBe(true);
    const d = read('docs/JP_BACKEND_MODERNIZATION_DESIGN.md');
    expect(d).toMatch(/20260726104300/);
    expect(d).toMatch(/20260806013625/);
    // 전략은 `repair` 가 아니라 멱등 재실행이다(codex-critic M-2). 적극 단언으로 회귀를 잡는다.
    expect(d, '원장 복구는 db push 로 수행한다').toMatch(/db push --linked/);
    // 배포 체크리스트(§11)에 폐기된 repair 지시가 남아 있으면 안 된다.
    const deploySection = d.slice(d.indexOf('## 11.'));
    expect(deploySection, '§11 에 폐기된 migration repair 커맨드가 남아 있다')
      .not.toMatch(/supabase migration repair --status applied \d/);
  });
});

describe('[JP-MOD-6] created_at 불변 고정 (codex-critic H-1 근본 수정)', () => {
  const sql = mig('jp_v1_created_at_immutable');
  const exec = execSql(sql);

  it('BEFORE INSERT OR UPDATE 트리거를 rooms·participants 양쪽에 건다', () => {
    for (const t of ['rooms', 'participants']) {
      expect(exec).toMatch(new RegExp(`create trigger jp_${t}_pin_created_at\\s+before insert or update on public\\.${t}`));
    }
  });

  it('INSERT 는 서버 시각으로, UPDATE 는 이전 값으로 고정한다', () => {
    expect(exec).toMatch(/NEW\.created_at := clock_timestamp\(\)/);
    expect(exec).toMatch(/NEW\.created_at := OLD\.created_at/);
  });

  it('함수가 search_path 를 고정하고 권한 상승을 하지 않는다', () => {
    expect(exec).toMatch(/security invoker/);
    expect(exec).toMatch(/set search_path = pg_catalog/);
    expect(exec, 'SECURITY DEFINER 는 이 용도에 불필요하다').not.toMatch(/security definer/i);
  });

  it('트리거 2개 생성을 자기검증한다', () => {
    expect(sql).toMatch(/트리거 2개가 아니다/);
  });

  it('RLS 마이그레이션보다 먼저 적용되도록 파일명이 정렬된다', () => {
    const files = readdirSync(path.join(ROOT, MIG)).filter((f) => f.endsWith('.sql')).sort();
    const pin = files.findIndex((f) => f.includes('created_at_immutable'));
    const rls = files.findIndex((f) => f.includes('rls_target'));
    expect(pin).toBeGreaterThan(-1);
    expect(pin, 'created_at 고정이 RLS 보다 먼저 적용되어야 창이 처음부터 건전하다').toBeLessThan(rls);
  });
});
