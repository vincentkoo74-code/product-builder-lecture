# RPS 상태 다이어그램 인덱스

> **STATUS: Draft — Implementation Pending**
> 기준 HEAD `f6f7eb759fbe99ea0c8d983bbd82f67271115f75`
> **이 문서군의 내용은 코드와 DB에 아직 적용되지 않았다.** `planned` 표기 항목은 설계일 뿐 구현물이 아니다.
> CEO 판정(2026-08-05): 문서 품질 PASS / 구현 착수 HOLD / 미확정 전이 해결 후에만 구현 승인.

마루의 가위바위보 상태 전이 문서의 진입점이다. 장애 분석·설계 리뷰·PR 승인에서 이 인덱스를 먼저 연다.

- **기준 커밋**: `f6f7eb759fbe99ea0c8d983bbd82f67271115f75` (branch `fix/replay-force-start-and-confirmed-ids`)
- **기준 시점 검증**: `npm test` 946/946 PASS, `npm run test:syntax` exit 0
- **작성일**: 2026-08-05
- **라인 번호 규약**: 이 문서군의 모든 `index.html:NNNN`은 위 기준 커밋 기준이다. 코드가 바뀌면 라인이 밀리므로, **라인보다 함수명을 우선 신뢰**한다.

---

## 1. 문서 목록

| 문서 | Level | 목적 | 주요 WRPS |
|---|---|---|---|
| `RPS_ROOM_LIFECYCLE_ARCHITECTURE.md` | L0 / L1 / L3 | 방 생성 → 종료까지 Room·Game·Host·Participant 전체 lifecycle 기준 다이어그램. 4축 분리 모델, writer inventory, 전적 보존 규칙, 불변식 R1~R12 | 042/043, 056, 075~083 |
| `WRPS084_DEFERRED_LEAVE_STATE_MACHINE.md` | L2 / L3 | 퇴장 예약·취소·라운드 종료 후 처리·Host 사후 선택의 세부 상태 머신, 확정 규칙 A~E, 실패 전이 F1~F16, 판정 경계 시나리오 S1~S5 | 084 |
| `WRPS084_DECISION_REGISTER.md` | — | 미확정 항목 DR-084-1~6. 선택지·권고안·영향 함수·영향 테스트·미결정 시 위험·CEO 결정 상태 | 084 |
| `RPS_STATE_DIAGRAM_INDEX.md` (이 문서) | — | 인덱스·추적성·갱신 규칙 | — |

> **구현 게이트**: `WRPS084_DECISION_REGISTER.md`의 OPEN 항목이 전부 닫히기 전에는 WRPS-084 구현에 착수하지 않는다.
> 2026-08-05 기준 DR-084-1~6 전부 **DECIDED**, 미결 항목 0건. 남은 blocker는 선행 작업 2건이다 — ① 원격 DB에 `leave_after_round` 미적용 ② WRPS-083 2B 미구현.

기존 관련 문서: `docs/GAME_LOGIC.md`(판정 규칙), `docs/BUILD31_FIELD_QA_CHECKLIST.md`(실기기 QA), `PROJECT_CONTEXT.md`.

---

## 2. Level 구조

```
Level 0  RPS 전체 Room Lifecycle
         └ RPS_ROOM_LIFECYCLE_ARCHITECTURE.md §2

Level 1  축별 상태 머신 (4축은 서로 독립)
         ├ Room State Machine            → ARCHITECTURE §3
         ├ Game/Round State Machine      → ARCHITECTURE §4
         ├ Host Authority State Machine  → ARCHITECTURE §5
         └ Participant Lifecycle         → ARCHITECTURE §6

Level 2  기능별 상세 전이
         ├ WRPS-083 Host Transfer        → ARCHITECTURE §7
         ├ WRPS-083 WAITING / Rejoin     → ARCHITECTURE §8
         ├ WRPS-083 2B Room Destroy      → ARCHITECTURE §9   (planned)
         ├ WRPS-084 Deferred Leave       → DEFERRED_LEAVE §3
         └ WRPS-084 Host Post-Round      → DEFERRED_LEAVE §6

Level 3  실행 시퀀스
         ├ DB write sequence             → DEFERRED_LEAVE §7, ARCHITECTURE §10
         ├ 실패 / rollback sequence      → DEFERRED_LEAVE §8
         ├ realtime / polling convergence→ ARCHITECTURE §11
         └ timer / channel teardown      → ARCHITECTURE §12  (planned)
```

---

## 3. 다이어그램별 추적성 요약

| 다이어그램 | WRPS | 핵심 production 함수 | 테스트 파일 | 상태 |
|---|---|---|---|---|
| Host Transfer | 083-1 | `promoteParticipantToHost`, `verifyExactlyOneHost`, `pickDeterministicHostCandidate`, `transferHostAndLeave`, `becomeNextHost`, `ensureHostExists` | `tests/host-transfer-stage1.test.mjs` (20), `tests/waiting-state-stage2a.test.mjs` W25~W28 | **existing** — commit `e137530` |
| WAITING / Rejoin | 083-2A | `computePlayerStatuses`, `getWaitingPlayers`, `isTaggerSelectionComplete`, `isJoinLocked`, `joinRoom`, `recoverRoundWhenAllPlayersWaiting` | `tests/waiting-state-stage2a.test.mjs` (44) | **existing** — commit `f6f7eb7` |
| Room Destroy | 083-2B | `destroyRoomByHost`, `teardownRoomRuntime`, `isRoomClosingOrDestroyed`, `handleRoomUpdate` destroyed 분기 | `tests/room-destroy-stage2b.test.mjs` | **planned** — 설계 Phase 1 완료 |
| Deferred Leave | 084 | `isRoundInProgress`, `setLeaveAfterRound`, `toggleLeaveAfterRound`, `processDeferredLeaves` | `tests/deferred-leave-wrps084.test.mjs` | **planned** — 조사 완료, DB 마이그레이션 대기 |
| Host Post-Round Decision | 084 | `showHostPostRoundPopup`, `transferHostAndLeave`(재사용), `destroyRoomByHost`(2B 의존) | 위와 동일 | **planned** |

`planned` 항목의 함수는 **아직 코드에 존재하지 않는다.** 문서 안에서도 항상 `(planned)`로 표기한다.

---

## 4. 문서 갱신 규칙

1. **상태 전이를 바꾸는 코드 변경은 반드시 다이어그램도 갱신한다.** 상태 추가·삭제, guard 조건 변경, write 순서 변경, terminal state 추가가 여기 해당한다.
2. **상태 전이 관련 PR은 다이어그램 diff 없이 승인하지 않는다.** 코드만 바뀌고 문서가 그대로면 리뷰에서 반려한다.
3. **신규 writer를 추가하면 `RPS_ROOM_LIFECYCLE_ARCHITECTURE.md` §10 writer inventory를 갱신한다.** 현재 인벤토리는 59개 write 지점을 기준으로 한다.
4. **신규 terminal state를 추가하면 재입장·복원·teardown 3경로를 함께 검토한다.** terminal이면서 재입장 가능한 상태는 설계 결함이다.
5. **mutation test가 추가되면 대응 transition에 mutation ID를 연결한다.**
6. **실기기 QA에서 증상이 발견되면 해당 transition에 evidence를 추가한다.** 형식: `evidence: Build31 / room Y1PK / 2026-08-02 / 증상 요약`.
7. **문서와 production source가 불일치하면 production source를 임의로 고치지 않는다.** discrepancy로 보고하고 CEO 판단을 받는다. 문서가 틀렸는지 코드가 틀렸는지는 별개 문제다.
8. **`planned` → `existing` 승격은 해당 커밋 해시를 함께 기록한다.**

---

## 5. 표기 규약

전이 라벨은 다음 4요소를 갖는다.

```
event
[guard]
/ action
→ postcondition
```

상태 표는 다음 10개 열을 갖는다.

| 열 | 의미 |
|---|---|
| 상태 소유자 | 이 상태를 판단하는 주체(단말/역할) |
| 권위 데이터 | 이 상태의 진실 소스(DB 컬럼 / 로컬 state) |
| 허용 writer | 이 상태에서 DB에 쓸 수 있는 주체 |
| 진입 조건 | 이 상태로 들어오는 조건 |
| 종료 조건 | 이 상태를 벗어나는 조건 |
| 금지 동작 | 이 상태에서 절대 하면 안 되는 것 |
| UI 표시 | 사용자에게 보이는 것 |
| DB 상태 | 해당 시점의 DB 값 |
| rollback | 되돌릴 수 있는가 |
| 추적성 | function / test / mutation / WRPS / status |

구현 상태 표기: `existing`(코드에 있음) / `planned`(설계만) / `deprecated`(제거 예정).

---

## 6. 불변식 색인

| ID | 불변식 | 정의 위치 | 강제 지점 |
|---|---|---|---|
| R1 | 활성 방에는 Host가 정확히 한 명 | ARCHITECTURE §13 | `verifyExactlyOneHost`, `ensureHostExists` |
| R2 | Host 권한 ⊥ 라운드 참여 상태 | ARCHITECTURE §13 | `computePlayerStatuses`(isHost 미참조) |
| R3 | 양도 즉시 Host 권한 완전 소멸 | ARCHITECTURE §13 | `transferHostAndLeave`, `joinRoom` insert |
| R4 | 과거 Host 이력은 권한 근거가 아님 | ARCHITECTURE §13 | `joinRoom` insert `is_host:false` 고정 |
| R5 | WAITING은 현재 라운드 제외, 다음 라운드 복귀 | ARCHITECTURE §13 | `computePlayerStatuses`, `getNewGameRoundParticipantPatch` |
| R6 | 퇴장 예약자는 판정·전적에 정상 포함 | DEFERRED_LEAVE §2 | `leave_after_round`가 `choice`와 분리 (planned) |
| R7 | 예약은 처리 시작 전까지 취소 가능 | DEFERRED_LEAVE §2 | `leavingProcessing` 게이트 (planned) |
| R8 | 결과·전적 저장 전 예약자 삭제 금지 | DEFERRED_LEAVE §2 | `processDeferredLeaves` 순서 (planned) |
| R9 | 새 Host 검증 전 기존 Host 제거 금지 | ARCHITECTURE §13 | `promoteParticipantToHost` SELECT 재검증 |
| R10 | 방 종료와 Host 승계 동시 실행 금지 | ARCHITECTURE §13 | `roomClosing` 상호배제 (planned) |
| R11 | destroyed 방은 되살아나지 않음 | ARCHITECTURE §13 | `isRoomClosingOrDestroyed` 가드 (planned) |
| R12 | QA 계측은 상태 전이에 영향 없음 | ARCHITECTURE §14 | `QA.emit` 동기·읽기 전용 |
