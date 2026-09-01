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

-- ── REPLICA IDENTITY (JP-E2E-JWT-FIDELITY 에서 발견) ────────────────────────
-- 라이브 Tokyo 실측: rooms/participants 는 REPLICA IDENTITY **FULL** 이다.
-- 이것 역시 publication 등록과 마찬가지로 대시보드 out-of-band 설정이라 어떤 마이그레이션에도
-- 없었다 — 즉 이 파일만으로는 Tokyo 의 Realtime 동작을 재현하지 못했다.
--
-- 왜 중요한가: DEFAULT 이면 DELETE 이벤트의 old tuple 에 **기본키만** 실린다. 그래서 앱이 쓰는
-- `filter: room_id=eq.<code>` 가 DELETE 에 대해 평가될 수 없고, 참가자 삭제 이벤트가 방 채널로
-- 전달되지 않는다(앱은 room 변경 시 강제 재조회 + 2.6초 폴링으로 보정하지만, 동기화 특성이 달라진다).
--
-- 파괴성: 없음. 라이브 Tokyo 에서는 이미 FULL 이므로 **no-op** 이다.
-- 새 JP 백엔드를 저장소만으로 세울 때 Tokyo 와 동일해지도록 명시적으로 고정한다.
do $$
begin
  if (select relreplident from pg_class where oid='public.rooms'::regclass) <> 'f' then
    alter table public.rooms replica identity full;
  end if;
  if (select relreplident from pg_class where oid='public.participants'::regclass) <> 'f' then
    alter table public.participants replica identity full;
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
  if (select relreplident from pg_class where oid='public.rooms'::regclass) <> 'f'
  or (select relreplident from pg_class where oid='public.participants'::regclass) <> 'f' then
    raise exception 'JP realtime: REPLICA IDENTITY FULL 이 적용되지 않았다 — 필터된 DELETE 이벤트가 유실된다';
  end if;
end $$;

commit;

-- ─────────────────────────────────────────────────────────────────────────
-- Rollback(참고용):
--   alter publication supabase_realtime drop table public.participants;
--   alter publication supabase_realtime drop table public.rooms;
--   alter table public.participants replica identity default;
--   alter table public.rooms replica identity default;
-- ⚠️ 라이브에서 실행하면 실시간 동기화가 폴링 전용으로 퇴화한다.
-- ─────────────────────────────────────────────────────────────────────────
