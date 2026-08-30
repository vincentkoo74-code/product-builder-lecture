-- ─────────────────────────────────────────────────────────────────────────
-- JP V1.0_JP — rooms.invite_token (JP-SYNC-INVITE-001)
--
-- 왜 방 코드를 초대 URL 에 쓰지 않는가:
--   방 코드는 `Math.random().toString(36).substring(2,6)` 로 만든 4자 대문자다.
--   36^4 ≈ 2^20.7 이고 암호학적 난수가 아니다. QR(물리적 근접) 입장에는 충분하지만
--   URL 로 배포되는 초대 링크의 자격증명으로 쓰면 활성 방이 늘수록 열거가 현실화된다.
--   KR 의 짧은 방 코드 UX 는 그대로 둔다(변경 없음). JP 초대 URL 만 이 토큰을 쓴다.
--
-- 왜 전용 테이블이 아니라 컬럼 하나인가(최소 복잡도):
--   V1 은 "방 하나 = 활성 도전 하나"이고 재대결은 같은 방을 재사용한다.
--   토큰 다중 발급/개별 만료가 필요 없다. 회수는 NULL, 새 도전은 새 방(새 토큰)이다.
--   다중 토큰·초대 이력이 필요해지면 그때 전용 테이블로 승격한다.
--
-- 클라이언트 계약: >=128비트 CSPRNG(base64url 22자). index.html 의
--   generateInviteToken / isValidInviteTokenFormat 참조.
-- ─────────────────────────────────────────────────────────────────────────

begin;

alter table public.rooms
  add column if not exists invite_token text;

-- 토큰은 조회 키다. 중복 발급은 곧 방 오인이므로 유일성을 DB 가 보장한다.
-- 부분 인덱스라 NULL(회수됨)은 여러 행이 가질 수 있다.
create unique index if not exists rooms_invite_token_key
  on public.rooms (invite_token)
  where invite_token is not null;

comment on column public.rooms.invite_token is
  'JP 초대 URL 용 CSPRNG 토큰(>=128비트, base64url 22자). NULL = 초대 회수됨. 방 코드와 별개다.';

-- 자기검증: 적용이 실제로 반영됐는지 이 트랜잭션 안에서 확인한다(fail-closed).
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='rooms' and column_name='invite_token'
  ) then
    raise exception 'JP invite: rooms.invite_token 컬럼 생성 실패';
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname='public' and tablename='rooms' and indexname='rooms_invite_token_key'
  ) then
    raise exception 'JP invite: rooms_invite_token_key 인덱스 생성 실패';
  end if;
end $$;

commit;

-- ─────────────────────────────────────────────────────────────────────────
-- Rollback:
--   drop index if exists public.rooms_invite_token_key;
--   alter table public.rooms drop column if exists invite_token;
-- ─────────────────────────────────────────────────────────────────────────
