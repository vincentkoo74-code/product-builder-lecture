-- ─────────────────────────────────────────────────────────────────────────
-- JP V1.0_JP — rooms / participants 재현 가능 baseline
--
-- 배경: 이 두 테이블은 Tokyo 에서 대시보드로 out-of-band 생성되어 어떤 마이그레이션
-- 파일에도 CREATE 가 없었다. 그 결과 저장소만으로는 백엔드를 재현할 수 없었다.
-- 이 파일이 그 공백을 메운다.
--
-- 출처: 라이브 Tokyo(cmfxhehpreanijwanwrr) 읽기 전용 introspection
--       (2026-08-27, docs/JP_TOKYO_LIVE_AUDIT_2026-08-27.md 2절)
--       feature/rps-kr-seoul-backend 의 20260811010000 역공학본과 컬럼 순서까지 일치함을
--       라이브 대조로 재확인했다.
--
-- 파괴성: 없음. CREATE TABLE IF NOT EXISTS 만 사용한다.
--   - 라이브 Tokyo 에서는 완전한 no-op 이다(두 테이블이 이미 존재).
--   - 빈 프로젝트에서는 두 테이블을 생성한다.
--   RLS / GRANT / Realtime 은 이 파일에서 다루지 않는다 — 각각 별도 파일로 분리했다.
--   (관심사 분리: baseline 은 "무엇이 있는가", 뒤 파일들은 "누가 무엇을 할 수 있는가")
--
-- leave_after_round 는 base 테이블 정의에 접어 넣었다. 신규 프로젝트에는 증분 ALTER
-- (20260806013625)가 적용될 기존 행이 없기 때문이다. 라이브 Tokyo 에서는 이미 컬럼이
-- 존재하므로 IF NOT EXISTS 가 이를 흡수한다.
-- ─────────────────────────────────────────────────────────────────────────

begin;

create table if not exists public.rooms (
  id         text primary key,
  status     text default 'waiting'::text,
  penalty    text,
  round      integer default 1,
  created_at timestamptz default now()
);

create table if not exists public.participants (
  id                text primary key,
  room_id           text references public.rooms(id) on delete cascade,
  name              text not null,
  is_host           boolean default false,
  choice            text,
  wins              integer default 0,
  losses            integer default 0,
  draws             integer default 0,
  penalties         integer default 0,
  created_at        timestamptz default now(),
  is_ready          boolean default false,
  leave_after_round boolean not null default false
);

comment on column public.participants.leave_after_round is
  'WRPS-084: 현재 라운드 종료 후 자동 퇴장 예약. 이번 라운드의 판정·전적에는 일반 참가자와 '
  '완전히 동일하게 포함된다(자동 패배 아님). choice/is_ready/is_host 와 독립된 lifecycle 축이며, '
  '판정 로직(computePlayerStatuses 등)은 이 컬럼을 읽지 않는다.';

-- 드리프트 가드: 이 파일이 no-op 으로 지나갔는데 실제 스키마가 기대와 다르면
-- 이후 GRANT/RLS 마이그레이션이 엉뚱한 대상에 적용된다. 여기서 fail-closed 로 막는다.
do $$
declare
  missing text;
begin
  select string_agg(x, ', ') into missing from (
    select 'rooms.'||c as x from unnest(array['id','status','penalty','round','created_at']) c
    where to_regclass('public.rooms') is null
       or not exists (select 1 from information_schema.columns
                      where table_schema='public' and table_name='rooms' and column_name=c)
    union all
    select 'participants.'||c from unnest(array[
      'id','room_id','name','is_host','choice','wins','losses','draws',
      'penalties','created_at','is_ready','leave_after_round']) c
    where to_regclass('public.participants') is null
       or not exists (select 1 from information_schema.columns
                      where table_schema='public' and table_name='participants' and column_name=c)
  ) t;

  if missing is not null then
    raise exception 'JP baseline: 기대한 컬럼이 없다 — %', missing;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.participants'::regclass and contype = 'f'
      and confrelid = 'public.rooms'::regclass
  ) then
    raise exception 'JP baseline: participants → rooms 외래키가 없다';
  end if;
end $$;

commit;

-- ─────────────────────────────────────────────────────────────────────────
-- Rollback(참고용 — 이 파일 자체에서는 실행하지 않음):
--   drop table if exists public.participants;
--   drop table if exists public.rooms;
-- ⚠️ 라이브 Tokyo 에서는 절대 실행하지 말 것 — 운영 데이터가 삭제된다.
-- ─────────────────────────────────────────────────────────────────────────
