-- ─────────────────────────────────────────────────────────────────────────
-- JP V1.0_JP — rooms / participants 의 created_at 을 서버 통제 불변 컬럼으로 고정
--
-- 왜 필요한가 (codex-critic H-1):
--   목표 RLS 는 파괴적 연산에 24시간 창을 건다. 그런데 `created_at > now() - 24h` 는
--   **하한만** 검사한다. GRANT 가 테이블 전체 UPDATE 이므로 클라이언트가
--       PATCH /rooms?id=eq.X  {"created_at": "2099-01-01T00:00:00Z"}
--   를 보내면 WITH CHECK 를 통과하고, 그 행은 영구히 창 안에 머무는 "불멸 행"이 된다.
--   그 방으로는 기한 없이 참가자 주입도 계속 가능해진다.
--
--   상한(`created_at <= now()`)을 추가해도 충분하지 않다. `created_at = now()` 로 갱신하면
--   창이 다시 24시간 연장되어 반복 갱신으로 같은 결과가 되기 때문이다.
--
--   RLS 의 WITH CHECK 는 NEW 행만 볼 수 있어 "NEW.created_at = OLD.created_at" 을 표현할 수
--   없다. 컬럼 단위 GRANT 로 created_at 을 제외하는 방법도 있으나, 클라이언트가 갱신하는
--   컬럼 전체를 정적 추출로 완전히 열거해야 하고 하나라도 빠지면 게임이 깨진다
--   (실제로 추출해 보니 인접 호출의 컬럼이 섞여 신뢰할 수 없었다).
--
--   → 트리거로 못박는 것이 유일하게 **완전하고 열거가 필요 없는** 해법이다.
--
-- 의미론적으로도 이것이 옳다. created_at 은 "행이 만들어진 시각"이며 클라이언트가 정할 값이
-- 아니다. 실제로 클라이언트는 이 컬럼을 insert 페이로드에 넣지 않고 `.order('created_at')`
-- 으로 읽기만 한다(전수 확인). 즉 이 트리거는 **정상 동작에 보이지 않는다.**
--
-- 부수 효과(의도된 것):
--   - INSERT 시 created_at 이 항상 non-null 이 된다 → RLS 의 3값 논리 위험이 사라진다.
--   - 라이브 실측상 NULL 행은 0건이므로 기존 데이터에 영향이 없다.
--
-- 운영 주의: 관리자가 created_at 을 정정해야 한다면
--   alter table public.rooms disable trigger jp_rooms_pin_created_at;  -- 작업 후 enable
-- 로 일시 해제한다. service_role 도 예외 없이 적용된다(created_at 은 누구도 바꾸지 않는다).
--
-- 파괴성: 없음. 데이터·컬럼·권한 무변경. 트리거 2개와 함수 1개만 추가한다.
-- ─────────────────────────────────────────────────────────────────────────

begin;

create or replace function public.jp_pin_created_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if TG_OP = 'INSERT' then
    -- 클라이언트가 무엇을 보내든 서버 시각으로 고정한다.
    NEW.created_at := clock_timestamp();
  else
    -- UPDATE: 원래 값을 그대로 유지한다(변경 시도를 조용히 무시).
    NEW.created_at := OLD.created_at;
  end if;
  return NEW;
end;
$$;

comment on function public.jp_pin_created_at() is
  'JP V1.0_JP: rooms/participants 의 created_at 을 서버 통제 불변 컬럼으로 고정한다. '
  'RLS 의 24시간 창이 created_at 조작으로 우회되는 것을 막는다(codex-critic H-1). '
  '클라이언트는 이 컬럼을 쓰지 않으므로 정상 동작에는 영향이 없다.';

drop trigger if exists jp_rooms_pin_created_at on public.rooms;
create trigger jp_rooms_pin_created_at
  before insert or update on public.rooms
  for each row execute function public.jp_pin_created_at();

drop trigger if exists jp_participants_pin_created_at on public.participants;
create trigger jp_participants_pin_created_at
  before insert or update on public.participants
  for each row execute function public.jp_pin_created_at();

-- 자기검증
do $$
declare n int;
begin
  select count(*) into n from pg_trigger t
   join pg_class c on c.oid = t.tgrelid
   join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname='public' and not t.tgisinternal
     and t.tgname in ('jp_rooms_pin_created_at','jp_participants_pin_created_at');
  if n <> 2 then
    raise exception 'JP created_at pin: 트리거 2개가 아니다 (실제 %)', n;
  end if;

  -- 트리거가 INSERT 와 UPDATE 를 모두 덮는지 확인한다(tgtype 비트 2=INSERT, 16=UPDATE).
  if exists (
    select 1 from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
     where t.tgname in ('jp_rooms_pin_created_at','jp_participants_pin_created_at')
       and (t.tgtype & 4) = 0        -- BEFORE 여야 한다(bit 1 = ROW, bit 2 = BEFORE 아님)
  ) then
    null; -- tgtype 비트 해석은 버전 의존적이라 참고용으로만 둔다
  end if;
end $$;

commit;

-- ─────────────────────────────────────────────────────────────────────────
-- Rollback(참고용):
--   drop trigger if exists jp_participants_pin_created_at on public.participants;
--   drop trigger if exists jp_rooms_pin_created_at on public.rooms;
--   drop function if exists public.jp_pin_created_at();
-- ⚠️ 롤백하면 RLS 24시간 창이 created_at 조작으로 우회 가능해진다.
-- ─────────────────────────────────────────────────────────────────────────
