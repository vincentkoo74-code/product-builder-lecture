-- ─────────────────────────────────────────────────────────────────────────
-- JP V1.0_JP — Realtime publication 재현
--
-- 라이브 Tokyo 실측: publication `supabase_realtime` 에 public.rooms, public.participants 가
-- insert/update/delete 로 등록되어 있다. 그런데 이 등록은 어떤 마이그레이션에도 없었다
-- (대시보드 out-of-band). 저장소만으로 백엔드를 재현할 수 없던 원인 중 하나다.
--
-- 게임은 Realtime 과 2.6초 폴링의 **이중 경로**에 의존한다. publication 이 빠지면 게임이
-- 즉시 죽지는 않지만(폴링이 버팀) 동기화 지연 특성이 완전히 달라진다 — 조용한 성능 회귀다.
--
-- 파괴성: 없음. 이미 등록돼 있으면 건너뛴다(라이브 Tokyo 에서는 no-op).
-- ─────────────────────────────────────────────────────────────────────────

begin;

do $$
begin
  if not exists (select 1 from pg_publication where pubname='supabase_realtime') then
    raise exception 'JP realtime: supabase_realtime publication 이 없다 — Supabase 프로젝트가 맞는지 확인하라';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='rooms'
  ) then
    alter publication supabase_realtime add table public.rooms;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='participants'
  ) then
    alter publication supabase_realtime add table public.participants;
  end if;
end $$;

do $$
declare n int;
begin
  select count(*) into n from pg_publication_tables
   where pubname='supabase_realtime' and schemaname='public'
     and tablename in ('rooms','participants');
  if n <> 2 then
    raise exception 'JP realtime: rooms/participants publication 등록 실패 (등록 %건)', n;
  end if;
end $$;

commit;

-- ─────────────────────────────────────────────────────────────────────────
-- Rollback(참고용):
--   alter publication supabase_realtime drop table public.participants;
--   alter publication supabase_realtime drop table public.rooms;
-- ⚠️ 라이브에서 실행하면 실시간 동기화가 폴링 전용으로 퇴화한다.
-- ─────────────────────────────────────────────────────────────────────────
