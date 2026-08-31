# JP Tokyo Realtime 검증 계획 (준비만 — 실행 미승인)

작성일: 2026-09-01 · 상태: **PREPARED, NOT EXECUTED**

## 왜 필요한가
rc3 하니스와 로컬 PostgREST 는 Realtime **전달**을 증명하지 않는다. `JP-REALTIME-VALIDATION` 은
여전히 OPEN 이며, 시뮬레이터 작업으로 닫히지 않는다.

## 비파괴 원칙 (반드시 준수)
- **역사적 프로덕션 방/사용자를 조회·수정하지 않는다.** 현재 Tokyo: rooms 373, participants 543.
- 모든 테스트 행은 **명확히 폐기용으로 표시**한다: 방 코드 접두사 `ZZ`, 참가자 id 접두사 `zz_`.
- 검증 종료 시 생성한 행만 삭제한다(`delete ... where id like 'ZZ%'`).
- 스키마·정책·권한·publication 을 변경하지 않는다.
- 실행 전 rooms/participants **체크섬을 기록**하고, 종료 후 테스트 행 제외 체크섬이 동일함을 확인한다.

## 절차
| # | 단계 | 관측 대상 |
|---|---|---|
| 1 | 사전 스냅샷 | rooms/participants 수 + 체크섬 |
| 2 | 클라이언트 A: 폐기용 방 `ZZ01` 생성 | insert 성공, 1행 |
| 3 | A: `invite_token` 발급 | `.select('id')` 1행, 토큰 형식 22자 |
| 4 | 클라이언트 B: 토큰으로 방 조회 | `resolveInviteChallenge` → VALID |
| 5 | B: participant insert | **A 가 postgres_changes 로 수신하는가** ← 핵심 |
| 6 | 양측 ready 갱신 | 상대 기기 수신 지연(ms) 기록 |
| 7 | rooms.status 전이 | 양측 수신 |
| 8 | 동시 choice write | 양측 수신, 순서 |
| 9 | 결과 발행(participants 대량 갱신) | 전파 건수·지연 |
| 10 | nextRound 4 write | W1~W4 영향 행 + 전파 |
| 11 | A 또는 B 이탈(행 삭제) | 상대 수신 |
| 12 | 재구독 후 fetch 재조정 | 상태 수렴 |
| 13 | 정리 | `ZZ%` 행 삭제 |
| 14 | 사후 스냅샷 | 테스트 행 제외 체크섬이 1단계와 동일 |

## 측정 항목
- 이벤트 도착 지연 분포(중앙값/최대)
- 누락 이벤트 수
- 중복 이벤트 수
- 순서 역전 발생 여부
- 재구독 후 수렴 시간

## 실행 조건 (CEO 승인 필요)
1. 폐기용 행 생성이 프로덕션에 미치는 영향이 위 원칙 범위 내임을 승인
2. 실행 시간대(사용자 트래픽이 적은 시간)
3. 실패 시 중단 기준

## 실행하지 않은 이유
CEO §9 는 "이미 안전하고 격리된 경우가 아니면 프로덕션 영향 Realtime 테스트를 아직 하지 말라"고
지시했다. 폐기용 행이라도 프로덕션 테이블에 write 하므로 **별도 승인 대상**으로 둔다.
