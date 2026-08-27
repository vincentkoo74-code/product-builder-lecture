-- ─────────────────────────────────────────────────────────────────────────
-- JP V1.0_JP — participants.room_id 인덱스
--
-- 근거(라이브 Tokyo 실측, 2026-08-27):
--   explain (analyze) select ... from participants where room_id = $1
--     → Seq Scan on participants, Rows Removed by Filter: 543
--   대조군 rooms where id = $1 → Index Scan using rooms_pkey
--
--   라이브 인덱스는 PK 4개가 전부였다. participants.room_id 는 클라이언트의 최다 조인 키인데
--   인덱스가 없어 전체 스캔이 발생한다.
--
-- 왜 지금 필요한가(호출 빈도):
--   room_id 로 필터하는 호출이 SELECT 13곳 + UPDATE/DELETE 다수다. 그중 fetchParticipants
--   계열은 subscribeToRoom 의 **2.6초 폴링**과 Realtime 콜백 양쪽에서 호출된다.
--   즉 활성 방 1개·참가자 N명이면 2.6초마다 N회의 전체 스캔이 발생한다.
--   현재 543행에서는 1.2ms 라 체감되지 않지만, 비용이 테이블 크기에 선형으로 증가한다.
--
-- CONCURRENTLY 를 쓰지 않는 이유:
--   CREATE INDEX CONCURRENTLY 는 트랜잭션 블록 안에서 실행할 수 없다. 마이그레이션 러너가
--   파일을 트랜잭션으로 감싸므로 사용 불가하다. 현재 543행 규모에서 일반 CREATE INDEX 의
--   ACCESS EXCLUSIVE 락은 밀리초 단위다. 테이블이 크게 자란 뒤에 적용해야 한다면 이 파일 대신
--   수동 CONCURRENTLY 적용을 검토할 것.
--
-- 파괴성: 없음. IF NOT EXISTS 인덱스 추가만.
-- ─────────────────────────────────────────────────────────────────────────

begin;

create index if not exists participants_room_id_idx
  on public.participants (room_id);

do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname='public' and tablename='participants' and indexname='participants_room_id_idx'
  ) then
    raise exception 'JP index: participants_room_id_idx 생성 실패';
  end if;
end $$;

commit;

-- ─────────────────────────────────────────────────────────────────────────
-- Rollback: drop index if exists public.participants_room_id_idx;
-- ─────────────────────────────────────────────────────────────────────────
