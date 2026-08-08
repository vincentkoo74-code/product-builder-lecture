-- ─────────────────────────────────────────────────────────────────────────
-- WRPS-084 Deferred Leave — participants.leave_after_round
--
-- 배경: 라운드 진행 중 나가기를 "퇴장 예약"으로 전환하고, 라운드 판정과 전적을
-- 정상 완료한 뒤 퇴장시킨다. 예약 상태는 다른 단말의 참가자 목록에도 🚪로
-- 보여야 하므로 공유 저장소(DB)가 필요하다.
--
-- 왜 신규 컬럼인가(기존 컬럼 재사용 금지 근거):
--   - choice: 판정 입력이다. 마커를 넣으면 isNonPlayingChoice가 예약자를 판정에서
--     배제해 "퇴장 예약 = 자동 패배"가 된다(확정 규칙 E 위반). 이미
--     __safe__/__loser__/__waiting__ + 결과 인코딩으로 과적재 상태다.
--   - is_ready: 다음 라운드 준비 의사와 퇴장 의사는 동시 성립 가능하다.
--   - is_host: Host도 예약할 수 있어 표현 자체가 불가능하다.
--   - PLAYER_STATUS.WAITING: WAITING은 "현재 라운드 미참여"다. 예약자는 현재
--     라운드에 정상 참여한다 — 의미가 정반대다.
--
-- not null default false 근거:
--   - 기존 row 전부 즉시 유효한 값을 갖는다(NULL 분기 불필요).
--   - 구버전 앱의 insert는 이 컬럼을 명시하지 않으므로 default가 적용된다.
--   - Postgres 11+ 에서 default가 있는 컬럼 추가는 테이블 rewrite 없이
--     카탈로그만 갱신한다(짧은 ACCESS EXCLUSIVE 락).
--
-- 이 마이그레이션의 제약:
--   - 테이블 생성/삭제 없음, 기존 컬럼 변경 없음, 인덱스 추가 없음
--   - RLS 정책 변경 없음(행 단위 정책이므로 신규 컬럼은 자동 상속)
--   - trigger/scheduler/RPC 없음
-- ─────────────────────────────────────────────────────────────────────────

begin;

alter table public.participants
  add column if not exists leave_after_round boolean not null default false;

comment on column public.participants.leave_after_round is
  'WRPS-084: 현재 라운드 종료 후 자동 퇴장 예약. true여도 이번 라운드의 판정·전적에는 '
  '일반 참가자와 완전히 동일하게 포함된다(자동 패배 아님). choice/is_ready/is_host와 '
  '독립된 lifecycle 축이며, 판정 로직(computePlayerStatuses 등)은 이 컬럼을 읽지 않는다.';

commit;

-- ─────────────────────────────────────────────────────────────────────────
-- Rollback(참고용 — 이 마이그레이션 파일 자체에서는 실행하지 않음):
--
--   alter table public.participants drop column if exists leave_after_round;
--
-- 롤백 절차: ① 코드 먼저 롤백 → ② 위 drop → ③ notify pgrst, 'reload schema';
--            → ④ GET /participants?select=leave_after_round 가 400/42703 확인
-- ─────────────────────────────────────────────────────────────────────────
