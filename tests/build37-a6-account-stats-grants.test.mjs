import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// ════════════════════════════════════════════════════════════════════════════
// A6 — user_game_stats / user_game_history 권한(GRANT).
//   Phase A: RED 6건 확보.  Phase B: 신규 마이그레이션으로 GREEN 전환.
//
// 증상: 로그인 사용자의 "내 기록"이 언제나 비어 있다. 저장도 조회도 되지 않는다.
//
// RLS 정책(policy)과 테이블 권한(grant)은 서로 다른 두 관문이다.
//   grant  = 역할이 그 테이블에 접근할 수 있는가            (없으면 42501)
//   policy = 접근 가능한 역할이 어떤 row를 볼 수 있는가      (막히면 빈 결과)
// 20260528205753_account_game_stats.sql 은 policy만 만들고 grant를 하나도 주지 않았다.
// 같은 레포의 20260726104300_server_now_rpc.sql 은 grant를 명시했다 — 이 비대칭이 근거다.
//
// ⚠️ 가설 단언 금지: "Supabase가 알아서 준다"를 전제하지 않는다. 실제 배포 DB를
//    프로브해 42501을 확인한 결과를 아래 FROZEN_PROBE에 고정하고, 라이브 재확인은
//    A6_LIVE_PROBE=1 일 때만 수행한다(오프라인/CI에서는 hermetic 유지).
//
// ⚠️ 관측 범위의 정직한 한계: 이 프로젝트는 anonymous sign-in이 꺼져 있어
//    (auth/v1/settings → anonymous_users:false) 자격증명 없이 authenticated JWT를
//    만들 수 없다. 라이브 프로브는 anon 역할까지만 직접 관측한다. authenticated는
//    "마이그레이션이 어떤 역할에도 grant하지 않았고, Supabase 기본 권한은 anon과
//    authenticated에 함께 부여되는데 anon이 0" 이라는 소스+관측 근거로 판정한다.
// ════════════════════════════════════════════════════════════════════════════

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIG_DIR = join(ROOT, 'supabase/migrations');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

const migFiles = readdirSync(MIG_DIR).filter(f => f.endsWith('.sql')).sort();
const migs = migFiles.map(f => ({ f, sql: readFileSync(join(MIG_DIR, f), 'utf8') }));
const allSql = migs.map(m => m.sql).join('\n');
const sqlLower = allSql.toLowerCase();

// ⚠️ 파서 함정: 마이그레이션 주석에 GRANT/42501 같은 단어와 세미콜론이 들어 있다.
//    주석을 걷어내지 않으면 grant 파서가 주석 문장을 grant 문으로 오인한다(실제로 걸렸다).
const stripComments = sql => sql.replace(/--[^\n]*/g, '');
const execSql = stripComments(allSql);

// Phase B 수정본 / Phase A 시점의 원본을 이름으로 분리한다.
const ORIGINAL = migs.find(m => m.f === '20260528205753_account_game_stats.sql');
const GRANTS = migs.filter(m => /grant/i.test(m.f) && /account_game_stats/i.test(m.f));

// 2026-08-23 실측(배포 DB, anon key). 코드는 이 값을 "정상"으로 승인하지 않는다 — RED의 근거다.
const FROZEN_PROBE = {
  user_game_stats:   { http: 401, code: '42501', message: 'permission denied for table user_game_stats' },
  user_game_history: { http: 401, code: '42501', message: 'permission denied for table user_game_history' },
  participants:      { http: 200 },   // 대조군: 같은 프로젝트의 다른 테이블은 정상 접근된다
  rooms:             { http: 200 },
};

// "grant <verbs> on [table] public.<t> to <role>" 를 관대하게 탐지한다.
// (여러 verb/여러 role/여러 테이블 나열, 개행 포함)
function grantsFor(table, kind = 'table') {
  const out = [];
  //             verbs        object kind          targets      roles
  const re = /grant\s+([\s\S]*?)\s+on\s+(table\s+|sequence\s+)?([\s\S]*?)\s+to\s+([^;]+);/gi;
  let m;
  while ((m = re.exec(execSql))) {
    const isSeq = (m[2] || '').trim().toLowerCase() === 'sequence';
    if ((kind === 'sequence') !== isSeq) continue;
    // ⚠️ user_game_history 는 user_game_history_id_seq 의 접두사다. 부분일치로 재면
    //    시퀀스 grant가 테이블 grant로 새어 들어온다(실제로 걸렸다). 경계로 자른다.
    const targets = m[3].toLowerCase().split(/[\s,]+/).map(t => t.replace(/^public\./, ''));
    if (!targets.includes(table)) continue;
    out.push({
      verbs: m[1].toLowerCase().split(/[\s,]+/).filter(Boolean),
      roles: m[4].toLowerCase().split(/[\s,]+/).filter(Boolean),
    });
  }
  return out;
}
const grantsToRole = (table, role) =>
  grantsFor(table).filter(g => g.roles.includes(role))
    .flatMap(g => (g.verbs.includes('all') ? ['select', 'insert', 'update', 'delete'] : g.verbs));

describe('A6 — 공허성 가드 (측정 대상이 실제로 존재하는지)', () => {
  it('마이그레이션 디렉터리를 실제로 읽었고 대상 테이블이 정의되어 있다', () => {
    expect(migFiles.length, '마이그레이션 파일 0개 — 경로가 틀렸다').toBeGreaterThan(0);
    expect(sqlLower).toContain('create table if not exists public.user_game_stats');
    expect(sqlLower).toContain('create table if not exists public.user_game_history');
  });

  it('grant 파서가 실제로 동작한다 (대조군에서 최소 1건을 찾는다)', () => {
    // 파서가 항상 []를 돌려주면 아래 RED가 통째로 공허해진다.
    const fn = /grant\s+execute\s+on\s+function\s+public\.server_now\(\)\s+to\s+(\w+)/gi;
    const roles = [...execSql.matchAll(fn)].map(m => m[1].toLowerCase());
    expect(roles, 'server_now grant를 못 찾으면 SQL 로딩 자체가 실패한 것이다')
      .toEqual(expect.arrayContaining(['anon', 'authenticated']));
  });

  it('grant 파서가 SQL 주석에 속지 않는다', () => {
    // 마이그레이션 주석은 "GRANT ... 42501" 같은 문장과 세미콜론을 포함한다.
    // 주석을 걷어내지 않으면 파서가 주석을 grant 문으로 읽어 결과가 통째로 오염된다.
    expect(execSql.includes('--'), '주석 제거 실패').toBe(false);
    const bogus = grantsFor('user_game_stats').flatMap(g => g.verbs)
      .filter(v => !['select', 'insert', 'update', 'delete', 'usage', 'all'].includes(v));
    expect(bogus, `grant verb에 SQL이 아닌 토큰이 섞였다: ${bogus.slice(0, 8).join(',')}`).toEqual([]);
  });

  it('클라이언트가 실제로 이 테이블들을 쓰고 있다 (죽은 스키마가 아니다)', () => {
    expect(html).toContain('.from("user_game_stats")');
    expect(html).toContain('.from("user_game_history")');
    expect(html).toContain('.upsert(nextStats, { onConflict: "user_id" })');
    expect(html).toContain('db.from("user_game_history").insert([{');
  });

  it('RLS 정책은 이미 존재한다 (문제는 policy가 아니라 grant다)', () => {
    expect(sqlLower).toContain('enable row level security');
    for (const p of ['users can view own game stats', 'users can insert own game stats',
                     'users can update own game stats', 'users can view own game history',
                     'users can insert own game history']) {
      expect(sqlLower, `정책 누락: ${p}`).toContain(p);
    }
  });
});

describe('A6 — 대조군: 같은 레포가 grant를 명시할 줄 안다', () => {
  it('[GREEN] server_now RPC는 revoke 후 anon/authenticated에 execute를 명시 부여한다', () => {
    expect(sqlLower).toContain('revoke all on function public.server_now() from public');
    expect(sqlLower).toContain('grant execute on function public.server_now() to anon;');
    expect(sqlLower).toContain('grant execute on function public.server_now() to authenticated;');
  });
});

describe('A6 — GREEN 전환: 계정 전적 테이블 권한 (Phase A RED-1~4)', () => {
  it('[RED-1→GREEN] user_game_stats — authenticated 에게 select/insert/update', () => {
    // 클라이언트는 select(현재값 조회) + upsert(=insert or update) 를 모두 수행한다.
    const have = grantsToRole('user_game_stats', 'authenticated');
    expect([...new Set(have)].sort(),
      `현재 grant: ${have.length ? have.join(',') : '없음'} — RLS 정책만 있고 권한이 없다`)
      .toEqual(['insert', 'select', 'update']);
  });

  it('[RED-2→GREEN] user_game_history — authenticated 에게 select/insert', () => {
    const have = grantsToRole('user_game_history', 'authenticated');
    expect([...new Set(have)].sort(),
      `현재 grant: ${have.length ? have.join(',') : '없음'}`)
      .toEqual(['insert', 'select']);
  });

  it('[RED-3→GREEN] user_game_history_id_seq — authenticated 에게 usage', () => {
    // 테이블 insert grant만 주면 nextval() 에서 다시 42501이 난다.
    expect(sqlLower, 'bigserial 전제 확인').toContain('id bigserial primary key');
    const seq = /grant\s+(usage|all)\s+on\s+sequence\s+public\.user_game_history_id_seq\s+to\s+([^;]+);/i.exec(execSql);
    expect(seq && seq[2].toLowerCase().includes('authenticated'),
      '시퀀스 grant 없음 — insert 시 nextval에서 42501').toBe(true);
  });

  it('[RED-4→GREEN] 두 테이블에 대한 grant 문이 존재한다', () => {
    const all = ['user_game_stats', 'user_game_history'].flatMap(t => grantsFor(t));
    expect(all, `두 테이블에 대한 grant 문 ${all.length}건 — 마이그레이션 전체에서 0건이면 완전 부재`)
      .not.toEqual([]);
  });
});

describe('A6 — GREEN 전환: 저장 실패 관측성 (Phase A RED-5~6)', () => {
  const WRITE = (() => {
    const s = html.indexOf('async function recordMyAccountGameResult(result) {');
    const e = html.indexOf('function getRoundProgressData()', s);
    if (s < 0 || e < 0) throw new Error('recordMyAccountGameResult 추출 실패');
    return html.slice(s, e);
  })();

  it('전제: 저장 경로는 statsErr/historyErr를 throw해 catch로 보낸다', () => {
    expect(WRITE).toContain('if (statsErr) throw Object.assign(statsErr,');
    expect(WRITE).toContain('if (historyErr) throw Object.assign(historyErr,');
    expect(WRITE).toContain('__statsTable: "user_game_stats"');
    expect(WRITE).toContain('__statsTable: "user_game_history"');
  });

  it('[RED-5→GREEN] 저장 실패가 QA 계측(ACCOUNT_STATS_SAVE_FAILED)으로 남는다', () => {
    // 게임 진행을 막지 않으려 삼키는 것 자체는 정당하다. 문제는 "삼키고 아무 데도 안 남긴다"였다.
    expect(WRITE).toContain('console.warn("account stats save failed:"');   // fail-soft 유지
    expect(WRITE).toContain('QA.emit("metric"');
    expect(WRITE).toContain('eventType: "ACCOUNT_STATS_SAVE_FAILED"');
    expect(WRITE).toContain('statsTable:');
    expect(WRITE).toContain('statsAction:');
  });

  it('[GREEN] fail-soft 유지 — 실패가 게임 진행을 막지 않는다', () => {
    // catch 안에서 throw / return false / 화면 전환 / alert 을 하지 않는다.
    const CATCH = WRITE.slice(WRITE.indexOf('} catch (e) {'));
    expect(CATCH.length, 'catch 블록 추출 실패').toBeGreaterThan(50);
    for (const forbidden of ['throw ', 'showScreen(', 'alert(', 'goHome(']) {
      expect(CATCH.includes(forbidden), `catch에서 진행 차단: ${forbidden}`).toBe(false);
    }
    // QA.emit 자체가 실패해도 삼킨다(계측이 게임을 깨뜨리지 않는다).
    expect(CATCH).toContain('catch (qaErr) {}');
  });

  it('[GREEN] PII/토큰을 계측에 남기지 않는다', () => {
    const EMIT = WRITE.slice(WRITE.indexOf('QA.emit("metric"'), WRITE.indexOf('catch (qaErr)'));
    expect(EMIT.length, 'emit 블록 추출 실패').toBeGreaterThan(50);
    for (const pii of ['user.id', 'user_id', 'displayName', 'display_name',
                       'email', 'token', 'access_token', 'penalty_text', 'nickname']) {
      expect(EMIT.includes(pii), `계측에 PII/토큰 유출: ${pii}`).toBe(false);
    }
  });

  it('[RED-6→GREEN] pg error code / http status 를 보존해 원인을 구분한다', () => {
    // e.code / e.status 를 남기지 않으면 "권한 없음"과 "네트워크 실패"가 로그상 동일해진다.
    expect(WRITE).toContain('statsErrorCode: e?.code');
    expect(WRITE).toContain('statsHttpStatus: e?.status');
  });
});

describe('A6 — Phase B 마이그레이션 소스 계약', () => {
  it('[GREEN] 권한 부여는 신규 마이그레이션 파일에 들어 있다', () => {
    expect(GRANTS.map(m => m.f), 'account_game_stats grants 마이그레이션이 없다').not.toEqual([]);
    expect(GRANTS.length, '권한 마이그레이션은 1개여야 한다').toBe(1);
    // 파일명이 기존 마이그레이션보다 뒤여야 순서대로 적용된다.
    expect(GRANTS[0].f > ORIGINAL.f, `순서 역전: ${GRANTS[0].f} <= ${ORIGINAL.f}`).toBe(true);
  });

  it('[GREEN] 기존 마이그레이션(20260528205753)은 손대지 않았다', () => {
    expect(ORIGINAL, '원본 마이그레이션이 사라졌다').toBeTruthy();
    // 이미 적용된 파일이므로 grant가 추가돼 있으면 안 된다 — 그건 in-place 편집이다.
    expect(/grant/i.test(ORIGINAL.sql),
      '적용 완료 마이그레이션에 grant가 끼어들었다 — 신규 파일로 분리해야 한다').toBe(false);
    // 정책 5개는 원본에 그대로 남아 있어야 한다.
    expect((ORIGINAL.sql.match(/create policy/gi) || []).length).toBe(5);
  });

  it('[GREEN] 신규 마이그레이션은 권한만 바꾼다 (DDL/RLS 무변경)', () => {
    const g = GRANTS[0].sql;
    // 주석에는 rollback 예시로 revoke/alter가 등장하므로 주석을 걷어내고 본다.
    const code = g.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    for (const ddl of ['create table', 'drop table', 'alter table', 'create index',
                       'create policy', 'drop policy', 'alter policy',
                       'create trigger', 'create function']) {
      expect(code.toLowerCase().includes(ddl), `신규 마이그레이션이 스키마를 건드린다: ${ddl}`).toBe(false);
    }
    expect(code).toContain('begin;');
    expect(code).toContain('commit;');
  });

  it('[GREEN] anon 에는 아무 권한도 주지 않는다', () => {
    for (const [t, kind] of [['user_game_stats', 'table'], ['user_game_history', 'table'],
                             ['user_game_history_id_seq', 'sequence']]) {
      const leaked = grantsFor(t, kind).filter(x => x.roles.includes('anon') || x.roles.includes('public'));
      expect(leaked, `${t} 에 anon/public 권한이 부여됐다`).toEqual([]);
    }
  });

  it('[GREEN] DELETE / service_role 은 부여하지 않는다 (최소 권한)', () => {
    for (const t of ['user_game_stats', 'user_game_history']) {
      expect(grantsToRole(t, 'authenticated').includes('delete'), `${t} DELETE 부여됨`).toBe(false);
      expect(grantsFor(t).some(g => g.roles.includes('service_role')), `${t} service_role 부여됨`).toBe(false);
    }
  });

  it('[GREEN] 적용 결과를 같은 트랜잭션에서 자기검증한다', () => {
    const g = GRANTS[0].sql;
    // grant가 조용히 누락된 채 "적용됨"으로 남는 상태를 만들지 않는다.
    expect(g).toContain('has_table_privilege');
    expect(g).toContain('has_sequence_privilege');
    expect(g).toContain('pg_get_serial_sequence');
    expect(g).toContain('raise exception');
    // anon 유출 회귀도 마이그레이션 자체가 막는다.
    expect(g).toContain("has_table_privilege('anon'");
    // 권한 변경은 PostgREST 스키마 캐시 갱신이 필요하다.
    expect(g.toLowerCase()).toContain("notify pgrst, 'reload schema'");
  });

  it('[GREEN] 적용 대상이 Seoul 전용임을 파일이 명시한다', () => {
    const g = GRANTS[0].sql;
    expect(g, 'Seoul 프로젝트 ref 명시 없음').toContain('sannrfmhevebqgfdqcps');
    expect(g, 'Tokyo 제외 명시 없음').toContain('cmfxhehpreanijwanwrr');
  });
});

// ── 라이브 프로브 (증적) ─────────────────────────────────────────────────────
// 기본은 고정 관측치(FROZEN_PROBE)만 확인한다. A6_LIVE_PROBE=1 이면 배포 DB를 다시 친다.
const live = process.env.A6_LIVE_PROBE === '1' ? describe : describe.skip;

describe('A6 — 증적: 배포 DB 관측치 (고정)', () => {
  it('[증적] anon SELECT가 두 테이블에서 42501로 거부됐다 (다른 테이블은 200)', () => {
    expect(FROZEN_PROBE.user_game_stats.code).toBe('42501');
    expect(FROZEN_PROBE.user_game_history.code).toBe('42501');
    expect(FROZEN_PROBE.participants.http).toBe(200);
    expect(FROZEN_PROBE.rooms.http).toBe(200);
    console.log('\n── A6 배포 DB 프로브 (2026-08-23, anon key) ──\n' +
      Object.entries(FROZEN_PROBE).map(([t, r]) =>
        `${t.padEnd(20)} HTTP ${r.http}${r.code ? '  code=' + r.code + '  ' + r.message : '  ok'}`).join('\n'));
  });
});

live('A6 — 라이브 재확인 (A6_LIVE_PROBE=1)', () => {
  const URL = /https:\/\/[a-z0-9]+\.supabase\.co/.exec(html)?.[0];
  const KEY = /const SUPABASE_ANON_KEY = "([^"]+)"/.exec(html)?.[1];

  it('배포 DB에서 42501이 재현된다', async () => {
    expect(URL && KEY, 'index.html에서 Supabase 접속 정보를 못 찾았다').toBeTruthy();
    const hit = async t => {
      try {
        const res = await fetch(`${URL}/rest/v1/${t}?select=*&limit=1`,
          { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
        return { http: res.status, body: await res.json().catch(() => null) };
      } catch (e) { return { transport: String(e?.cause?.code || e?.message || e) }; }
    };
    const [stats, history, participants] = await Promise.all(
      ['user_game_stats', 'user_game_history', 'participants'].map(hit));
    console.log('\n── A6 라이브 프로브 ──\n' + JSON.stringify({ stats, history, participants }, null, 2));

    // 전송 자체가 막히면 "권한 정상"이 아니라 "관측 불가"다. 결과를 조작하지 말고 명시적으로 알린다.
    if ([stats, history, participants].some(r => r.transport)) {
      console.warn(`⚠ A6 라이브 프로브 불가(네트워크 차단: ${stats.transport || participants.transport}). ` +
        'FROZEN_PROBE(curl 실측, 2026-08-23)만 유효하다.');
      return;
    }
    expect(stats.body?.code, 'user_game_stats').toBe('42501');
    expect(history.body?.code, 'user_game_history').toBe('42501');
    expect(participants.http, '대조군 participants').toBe(200);
  }, 30000);
});
