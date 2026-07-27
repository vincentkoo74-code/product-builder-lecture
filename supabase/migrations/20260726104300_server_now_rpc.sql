-- ─────────────────────────────────────────────────────────────────────────
-- RC-1 (clock sync) STOP-SHIP 복구 — server_now() RPC
--
-- 배경: 클라이언트 syncServerClock()(index.html ~4403)이 지금까지
-- /auth/v1/health 응답의 `Date` HTTP 헤더로 서버-로컬 오프셋을 추정해 왔다.
-- 이 경로는 라이브 검증 결과 회생 불가로 확인됐다:
--   - apikey 헤더 없이 호출 시 401
--   - apikey를 붙여 200을 받아도 `Date` 헤더가 Access-Control-Expose-Headers
--     에 없어(Supabase/Kong 기본 CORS 설정) 브라우저가 읽을 수 없음(빈 값)
-- 결과: offsets 배열이 항상 0개 → serverClockSynced 항상 false 로 고착.
--
-- 해법: HTTP 헤더가 아니라 **RPC 응답 바디**로 서버 시각을 내려준다. 바디는
-- CORS expose-headers 제약과 무관하게 클라이언트가 항상 읽을 수 있다.
--
-- 이 함수는 RC-1 복구 목적의 유일한 변경이며, 다음 제약을 지킨다.
--   - 테이블/스키마 변경 없음, trigger 없음, scheduler 없음, 인증정책 변경 없음
--   - read-only, side-effect 없음(어떤 테이블도 읽거나 쓰지 않음 — DB 서버의
--     wall-clock 시각만 반환)
--   - 파라미터 없음(입력이 없으므로 SQL injection/파라미터 조작 표면이 없음)
--
-- now() vs clock_timestamp() 근거:
--   - now()(=transaction_timestamp())는 트랜잭션 시작 시각에 고정되는 STABLE
--     함수라 clock sync 목적에 맞지 않는다(같은 트랜잭션 내에서 재호출해도
--     값이 바뀌지 않음 → 실제 "지금" 시각이 아니다).
--   - clock_timestamp()는 호출되는 바로 그 순간의 실제 wall-clock 시각을
--     반환하는 VOLATILE 함수다. clock sync는 "RPC가 실행된 순간의 서버
--     시각"이 필요하므로 clock_timestamp()가 정답이다.
--
-- 반환 타입 근거(bigint, epoch milliseconds):
--   - double precision(IEEE754)은 안전정수 한계(2^53 ≈ 9.007e15)가 있는데,
--     현재 epoch-ms(~1.79e12)는 한계의 1/5000 수준이라 당장 문제는 없지만,
--     "정밀도 손실이 없다"를 명시적으로 보장하는 쪽은 bigint(64-bit 정수,
--     최대 ~9.22e18)다. 부동소수점 반올림 오차를 원천 차단하기 위해
--     bigint를 선택한다.
--   - PostgREST가 스칼라 반환값을 JSON 스칼라(따옴표 없는 숫자)로 직렬화하고,
--     JS는 이를 Number로 파싱한다 — epoch-ms가 2^53을 넘는 시점(서기
--     287396년경)까지는 정밀도 손실이 없다. 낮은 확신 항목이므로 보고서에도
--     동일하게 명시한다.
--
-- VOLATILE 판단:
--   - 내부에서 clock_timestamp()(VOLATILE)를 호출하므로 래퍼 함수도
--     VOLATILE로 선언해야 정직하다. STABLE로 선언하면 플래너에게 "같은
--     문장 안에서는 같은 값"이라고 거짓 신호를 주는 셈이라(clock_timestamp
--     자체가 문장 내에서도 값이 바뀔 수 있음을 문서가 명시), 단일 top-level
--     RPC 호출이라 실질적 위험은 낮지만 의미상 VOLATILE이 유일하게 정확하다.
--
-- SECURITY INVOKER(기본값, 명시):
--   - 이 함수는 어떤 테이블도 참조하지 않고 상승된 권한이 필요 없으므로
--     SECURITY DEFINER를 쓸 이유가 없다. INVOKER를 명시해 "권한 상승 없음"을
--     감사(auditability) 관점에서 분명히 한다.
--
-- search_path 고정:
--   - SET search_path = '' 로 고정한다. pg_catalog는 search_path 설정과
--     무관하게 Postgres가 항상 암묵적으로 우선 탐색하므로, extract()/
--     clock_timestamp() 같은 내장 함수 호출에는 영향이 없다. 반면 이렇게
--     고정해 두면 동일 이름의 객체를 public(또는 다른) 스키마에 만들어
--     함수 동작을 가로채는 search_path hijacking 공격 표면을 원천 차단한다
--     (이 함수엔 스키마 한정 없는 사용자 정의 식별자가 전혀 없어 현재는
--     실질 위험이 없지만, Supabase 린터 권고에 따라 방어적으로 고정한다).
-- ─────────────────────────────────────────────────────────────────────────

-- CEO 최종 승인본(2026-07-26): search_path=pg_catalog, floor()로 명시적 내림,
-- pg_catalog.clock_timestamp() 스키마 한정, begin/commit 원자 적용.
begin;

create or replace function public.server_now()
returns bigint
language sql
volatile
security invoker
set search_path = pg_catalog
as $$
  select floor(
    extract(epoch from pg_catalog.clock_timestamp()) * 1000
  )::bigint;
$$;

comment on function public.server_now() is
  'RC-1 clock sync: 현재 DB 서버 wall-clock 시각을 epoch milliseconds(bigint)로 반환한다. '
  '파라미터 없음, 테이블 접근 없음, side-effect 없음(read-only). '
  'now()가 아닌 clock_timestamp()를 사용해 호출 시점의 실제 시각을 반환한다. '
  'index.html의 syncServerClock()이 HTTP Date 헤더(CORS로 비노출되어 읽을 수 없음) 대신 '
  '이 RPC 응답 바디로 서버-클라이언트 오프셋을 계산하기 위해 도입됨.';

-- 명시적 권한 제어: PUBLIC 기본 부여를 회수한 뒤, clock sync에 필요한
-- 역할에만 명시적으로 EXECUTE를 부여한다(로그인 전에도 동작해야 하므로
-- anon 필수, 로그인 후 세션은 authenticated, 서버 사이드 호출 대비
-- service_role도 포함).
revoke all on function public.server_now() from public;

grant execute on function public.server_now() to anon;
grant execute on function public.server_now() to authenticated;

commit;

-- ─────────────────────────────────────────────────────────────────────────
-- Rollback(참고용 — 이 마이그레이션 파일 자체에서는 실행하지 않음):
--
--   drop function if exists public.server_now();
--
-- ─────────────────────────────────────────────────────────────────────────
