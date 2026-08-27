-- ─────────────────────────────────────────────────────────────────────────
-- JP V1.0_JP — 목표 RLS
--
-- 배경(라이브 Tokyo 실측): rooms / participants 에 `FOR ALL USING(true) WITH CHECK(true)`
-- allow-all 정책 하나씩만 걸려 있었다. 사실상 행 단위 제한이 전무하다.
--
-- CEO 결정(JP-BL-018): allow-all 은 최종 JP 보안 모델이 아니다. 실제 호출 지점 행렬에서
-- **현재 게임플레이를 보존하는 최소 정책**을 도출한다.
--
-- ── 이 정책이 무엇을 하고 무엇을 하지 못하는지 (정직하게)
--
-- 하지 못하는 것:
--   게스트는 Supabase 세션이 없다(anon 롤, auth.uid() = NULL). participants 에 소유자 식별
--   컬럼이 없고 호스트 판정이 서버에서 검증되지 않는다. 따라서 **"같은 방의 다른 참가자 행을
--   임의로 고치는 것"을 RLS 로 막을 방법이 없다.** 호스트가 다른 참가자 행을 쓰는 것이
--   정상 동작이기 때문이다(라운드 판정·레디 초기화). 이는 Seoul 보안 리스크 등록부에
--   기록된 기존 노출과 동일하며, 실질 해결은 Anonymous Auth + owner_uid +
--   host 검증 SECURITY DEFINER RPC(V2, JP-BL-005)를 요구한다.
--
-- 하는 것 — 폭발 반경(blast radius) 축소:
--   1. allow-all 단일 정책을 **연산별 정책**으로 분해한다. rooms DELETE 는 정책 자체가
--      없으므로 RLS 단계에서 거부된다(GRANT 회수와 이중 방어).
--   2. 파괴적 연산(INSERT/UPDATE/DELETE)에 **시간 창**을 건다. 필터 없는 REST UPDATE/DELETE
--      가 들어와도 최근 24시간 행까지만 도달한다 — 과거 전체가 아니라.
--      라이브 실측 근거: 방 수명 p50 0.14분 / p95 5.68분 / max 323분. 24시간은 실제 게임
--      진행에 비해 압도적으로 넉넉하다. 현재 373개 방 전부가 24시간을 넘겨 즉시 불변이 된다.
--   3. created_at 을 창 밖으로 옮겨 정책을 우회하는 것을 WITH CHECK 로 막는다.
--
-- ── SELECT 에는 시간 창을 걸지 않는다(의도적)
--   최근 방 코드(rpsRecentRoomCodes)에 TTL 이 없어 오래된 코드도 checkGlobalReplayInvites
--   가 조회한다. SELECT 를 제한하면 실기기 검증 없이는 확인 불가한 UX 변화가 생긴다.
--   읽기 노출은 파괴 위험과 성질이 다르고, 제대로 고치려면 신원(identity)이 필요하다.
--   → 읽기 범위 축소는 V2 로 미룬다(JP-BL-005).
--
-- ── status 값 enum 제약을 넣지 않는 이유
--   라이브에 9종(waiting/ready/result/game_over/lobby/penalty_setting/playing/stats/destroyed),
--   클라이언트 리터럴에 reinviting 이 추가로 있다. 정적 grep 으로 전수를 증명할 수 없어,
--   불완전한 enum 을 걸면 게임이 조용히 깨질 수 있다. 검증 가능한 것만 건다(JP-BL-025 로 이월).
--
-- 파괴성: 정책 교체만. 데이터·스키마·권한 무변경.
-- ⚠️ 이 파일은 라이브 Tokyo 에 적용하기 전에 실기기 회귀 QA 가 필요하다.
-- ─────────────────────────────────────────────────────────────────────────

begin;

-- 게임플레이 시간 창. 방 수명 p95 가 6분 미만이므로 24시간은 안전 여유가 크다.
-- 값을 바꾸려면 위 실측 근거를 함께 갱신할 것.

-- ── rooms ────────────────────────────────────────────────────────────────
alter table public.rooms enable row level security;

drop policy if exists "allow_all_rooms" on public.rooms;
drop policy if exists jp_rooms_select on public.rooms;
drop policy if exists jp_rooms_insert on public.rooms;
drop policy if exists jp_rooms_update on public.rooms;

-- 조회: 현행 유지(제한 없음). 위 주석의 의도적 결정.
create policy jp_rooms_select on public.rooms
  for select to anon, authenticated
  using (true);

-- 생성: 새 방만.
-- created_at 은 20260827003500 의 트리거가 서버 시각으로 못박으므로 클라이언트가 조작할 수
-- 없다. 아래 상·하한은 트리거가 제거되거나 우회될 경우를 대비한 심층 방어다(codex-critic H-1).
create policy jp_rooms_insert on public.rooms
  for insert to anon, authenticated
  with check (
    created_at > now() - interval '1 hour'
    and created_at <= now() + interval '1 minute'
    and (round is null or round >= 1)
  );

-- 갱신: 최근 24시간 방만. 갱신 후에도 창 안에 남아 있어야 한다.
create policy jp_rooms_update on public.rooms
  for update to anon, authenticated
  using      (created_at > now() - interval '24 hours' and created_at <= now() + interval '1 minute')
  with check (created_at > now() - interval '24 hours'
              and created_at <= now() + interval '1 minute'
              and (round is null or round >= 1));

-- 삭제: 정책 없음 → RLS 가 거부한다.
--   클라이언트의 rooms .delete() 호출은 전수 조사 결과 0건이다.
--   서버 사이드 정리는 service_role(RLS 우회)로 수행한다.

-- ── participants ─────────────────────────────────────────────────────────
alter table public.participants enable row level security;

drop policy if exists "allow_all_participants" on public.participants;
drop policy if exists jp_participants_select on public.participants;
drop policy if exists jp_participants_insert on public.participants;
drop policy if exists jp_participants_update on public.participants;
drop policy if exists jp_participants_delete on public.participants;

create policy jp_participants_select on public.participants
  for select to anon, authenticated
  using (true);

-- 입장: 최근 24시간 안에 만들어진 **실재하는 방**에만 들어갈 수 있다.
-- (FK 가 존재는 보장하지만 "오래된 방에 새 참가자 주입"은 막지 못한다.)
create policy jp_participants_insert on public.participants
  for insert to anon, authenticated
  with check (
    exists (
      select 1 from public.rooms r
      where r.id = room_id
        and r.created_at > now() - interval '24 hours'
    )
    and created_at > now() - interval '1 hour'
    and created_at <= now() + interval '1 minute'
    and coalesce(wins,0) >= 0 and coalesce(losses,0) >= 0
    and coalesce(draws,0) >= 0 and coalesce(penalties,0) >= 0
  );

-- 갱신/삭제: 참가자 행 자신의 created_at 기준 24시간 창.
-- rooms 를 참조하는 서브쿼리 대신 자기 컬럼을 쓴다 — 매 행 조회 비용이 없고,
-- 참가자는 방 생성 직후 합류하므로 보호 범위가 실질적으로 동일하다.
create policy jp_participants_update on public.participants
  for update to anon, authenticated
  using      (created_at > now() - interval '24 hours' and created_at <= now() + interval '1 minute')
  with check (created_at > now() - interval '24 hours'
              and created_at <= now() + interval '1 minute'
              and coalesce(wins,0) >= 0 and coalesce(losses,0) >= 0
              and coalesce(draws,0) >= 0 and coalesce(penalties,0) >= 0);

create policy jp_participants_delete on public.participants
  for delete to anon, authenticated
  using (created_at > now() - interval '24 hours' and created_at <= now() + interval '1 minute');

-- ── 계정 전적 2테이블 — 소유자 범위 유지(현행과 동일, 멱등 재선언) ────────────
alter table public.user_game_stats   enable row level security;
alter table public.user_game_history enable row level security;

drop policy if exists "Users can view own game stats"    on public.user_game_stats;
drop policy if exists "Users can insert own game stats"  on public.user_game_stats;
drop policy if exists "Users can update own game stats"  on public.user_game_stats;
drop policy if exists "Users can view own game history"   on public.user_game_history;
drop policy if exists "Users can insert own game history" on public.user_game_history;

-- anon 은 GRANT 자체가 없고 auth.uid() 도 NULL 이라 어떤 행에도 도달하지 못한다.
-- 역할을 authenticated 로 명시해 의도를 코드로 드러낸다(기존은 public 대상이었다).
create policy "Users can view own game stats" on public.user_game_stats
  for select to authenticated using (auth.uid() = user_id);
create policy "Users can insert own game stats" on public.user_game_stats
  for insert to authenticated with check (auth.uid() = user_id);
create policy "Users can update own game stats" on public.user_game_stats
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users can view own game history" on public.user_game_history
  for select to authenticated using (auth.uid() = user_id);
create policy "Users can insert own game history" on public.user_game_history
  for insert to authenticated with check (auth.uid() = user_id);

-- DELETE 정책은 두 테이블 모두 두지 않는다. 계정 삭제는 auth.users 의
-- ON DELETE CASCADE 로 처리되며 테이블 소유자 권한으로 실행되므로 정책이 필요 없다.

-- ── 자기검증 ─────────────────────────────────────────────────────────────
do $$
declare n int;
begin
  select count(*) into n from pg_policies
   where schemaname='public' and policyname in ('allow_all_rooms','allow_all_participants');
  if n > 0 then raise exception 'JP RLS: allow-all 정책이 남아 있다'; end if;

  select count(*) into n from pg_policies
   where schemaname='public' and tablename='rooms' and cmd='DELETE';
  if n > 0 then raise exception 'JP RLS: rooms 에 DELETE 정책이 생겼다 — 의도에 반한다'; end if;

  select count(*) into n from pg_policies where schemaname='public' and tablename='rooms';
  if n <> 3 then raise exception 'JP RLS: rooms 정책 수가 3이 아니다 (실제 %)', n; end if;

  select count(*) into n from pg_policies where schemaname='public' and tablename='participants';
  if n <> 4 then raise exception 'JP RLS: participants 정책 수가 4가 아니다 (실제 %)', n; end if;

  select count(*) into n from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
   where ns.nspname='public' and c.relkind='r' and not c.relrowsecurity;
  if n > 0 then raise exception 'JP RLS: RLS 가 꺼진 public 테이블이 % 개 있다', n; end if;
end $$;

commit;

notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────────
-- Rollback(참고용): allow-all 로 되돌리려면
--   create policy "allow_all_rooms" on public.rooms for all using (true) with check (true);
--   create policy "allow_all_participants" on public.participants for all using (true) with check (true);
--   (그리고 jp_* 정책 drop)
-- ─────────────────────────────────────────────────────────────────────────
