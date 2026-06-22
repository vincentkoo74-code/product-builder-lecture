# ♻️ REGRESSION TRACKER — 재발/회귀 전용 추적

> "한 번 고쳤는데 다시 나온" 또는 "한 분기에서 고쳤으나 출시 본류엔 없는" 문제를 전용 추적한다.
> 회귀 발생 시: 같은 `WRPS-NNN` 유지 → 아래에 회차(round) 1줄 추가 → `ACTIVE_ISSUES.md`로 승격.
> 갱신: 2026-06-22

---

## 회귀 위험도 분류 (현재 코드 `35cd68d`=build8 기준)

| 위험도 | 정의 | 해당 ID |
|---|---|---|
| **Critical** | 출시 차단, 데이터/진행 불가, 다수 사용자 영향 | (확정 0) |
| **High** | 핵심 UX 손상, 일부 사용자 게임 불가/무음 | ~~WRPS-013, WRPS-014~~ → **Build8.1 코드 수정됨**(실기기 검증 대기) |
| **Medium** | 조건부 발생, 우회 가능, 타이밍 의존 | WRPS-015, WRPS-037, WRPS-026, WRPS-036 |
| **Low** | 경미·미관·기능 미도입 | WRPS-018, WRPS-019, WRPS-020, WRPS-034, WRPS-041, WRPS-021 |

> **핵심 사실**: build8 마이그레이션(`82d7f57`)은 index.html을 +36줄(격리 Firebase 로더+디버그버튼)만 변경, 게임 로직 byte 동일 → **build8이 신규 주입한 회귀는 0건**. 아래 회귀는 전부 build6 이전부터 잠재.

---

## 회귀/누락 상세 (재발 메커니즘)

### REG-A: Lineage A 미머지 누락 (구조적 회귀의 본질)
- **메커니즘**: `claude/fix-game-ready-button-bl7zf`(05-18)의 수정 7건이 `b07d0e3`에서 분기 후 **본류에 한 번도 머지되지 않음**(`merge-base`=b07d0e3로 검증). Build3~6은 이 분기를 모른 채 진행 → 누락분이 사용자에겐 "다시 나온 버그"로 체감.
- **은폐 원인**: Build3~6 전 QA가 단일 커밋 `ded6154`로 squash(증분 커밋 부재) → 무엇이 빠졌는지 diff로 드러나지 않음.

| ID | 버그 | 본류 처리 | 회귀 상태 |
|---|---|---|---|
| WRPS-013 | 재초대 수락 후 대기화면 고착 | 미반영 | **High(LIVE)** |
| WRPS-014 | 참가자 TTS 미재생 | 미반영 | **High(LIVE)** |
| WRPS-015 | 카운트다운 시차 | 대체구현(serverNow), late-arrival 갭 | Medium |
| WRPS-016/017 | round=1 stale choice | 부분대체(fresh refetch) | Low~Medium |
| WRPS-018 | participantWait 안전망 | 미반영 | Low(→WRPS-013 악화) |
| WRPS-019 | 드롭 참가자 정리 | 미반영 | Low |
| WRPS-020 | 참가자 INSERT 병합 | 미반영 | Low |

### REG-B: 정책 플립플롭 — 자동 시작 (WRPS-011 → WRPS-037)
3회 뒤집힌 설계 결정:
1. **초기**: round>1 전원 ready 시 **자동 시작** (버그성: 호스트 미클릭 시작)
2. **2026-06-06**: 자동 시작 **완전 제거** → 호스트 수동 버튼 (`FIXES.md`, `GAME_LOGIC.md §3/§11`)
3. **2026-06-13 Build4**: 자동 시작 **정식 재채택** (`BUILD4_P0_QA_MATRIX` 항목3, 현재 코드 `triggerReplayIfLastReady`)
- **부작용**: `GAME_LOGIC.md`가 2단계에 멈춰 코드와 불일치(WRPS-041). 재대결 직후 stale-state 오발화 잔존 위험(WRPS-037).
- **회귀 상태**: Medium — "회귀"라기보다 **의도된 사양 변경**이나, 문서 미동기화로 회귀처럼 보임.

### REG-C: 깜빡임 — 양 lineage 독립 수정 (WRPS-005 vs WRPS-012)
- 동일 "ready↔대기 3초 깜빡임"을 Lineage A(`94a3344`)와 본류(`a541007`/`0d184b5`)가 각자 수정. 본류 버전 채택으로 **현재 정상**. 재발 시 두 수정의 차이를 본 문서에서 대조할 것.

### WRPS-034: 영어 UI 한글 잔존 — 부분 재발
- Build3에서 i18n화했으나 토스트류 한글 잔존이 Build5 명세에서도 OPEN-02로 재확인. 완전 종결 안 됨.

---

## 회귀 이력 로그 (회차별 — 새 회귀 발생 시 추가)

| 일자 | ID | 회차 | 사건 | 비고 |
|---|---|---|---|---|
| 2026-05-18 | WRPS-013/014/015/018/019/020 | 1 | Lineage A에서 수정 | 본류 미머지 |
| 2026-06-21 | WRPS-013/014/015/018/019/020 | 2 | build6 스냅샷에 미반영 확정 | 현재까지 LIVE |
| 2026-06-06 | WRPS-011/037 | 1 | 자동시작 제거 | 문서화됨 |
| 2026-06-13 | WRPS-037 | 2 | 자동시작 재채택 | 문서 미동기화(WRPS-041) |
| 2026-06-21 | WRPS-040 | — | build8 마이그레이션, 회귀 0 확인 | 격리 검증 완료 |
| 2026-06-22 | WRPS-013 | 3 | **Build8.1 수정** — `acceptInvite` ready-aware + `fetchParticipants` 안전망 | 실기기 검증 대기 |
| 2026-06-22 | WRPS-014 | 3 | **Build8.1 수정** — `markReady` 제스처 언락(빈 발화) | iOS 실기기 검증 대기 |
| 2026-06-22 | WRPS-018 | 3 | **Build8.1 수정** — `fetchParticipants` 3초 폴링 복구 안전망 | 실기기 검증 대기 |
| 2026-06-22 | WRPS-041 | — | **Build8.1 문서 수정** — GAME_LOGIC.md 자동시작 정정 | 드리프트 해소 |
| 2026-06-22 | WRPS-043 | 1 | **재발 발견** (Build8.1 실기기 QA) — 3인 게임 술래 2명 선택 불가 | 다중 술래 회귀 |
| 2026-06-22 | WRPS-043 | 1 | **Build8.2 수정** — Model P(호스트=플레이어), getMaxLoserCount=전체−1, maxLoserCountFor 단일소스 | 실기기 재검증 대기 |
| 2026-06-22 | WRPS-042 | 3 | **Build8.2 수정** — 호스트도 ready 버튼, 시작 버튼 폐지(WRPS-043과 동시 해결) | 실기기 재검증 대기 |
| 2026-06-22 | WRPS-014/015 | — | **실기기 PASS** (Build8.1 TestFlight) → 종결 | closed |
| 2026-06-22 | WRPS-044 | 1 | **신규 발견** (Build8.1 실기기) — 호스트 승계+퇴장 후 참가자 목록/HOST stale | Supabase REST 제어 테스트로 Case A(DB 정상/UI) 확정 |
| 2026-06-22 | WRPS-044 | 1 | **Build8.3 수정** — rooms realtime + handleRoomUpdate 상태전이 시 강제 fetchParticipants(DELETE 의존 제거) | 실기기 재검증 대기 |

---

## 회귀 방지 체크 (모든 수정 시)
1. 수정이 **어느 lineage/브랜치**에 들어가는지 확인 — 본류(`build8-client-migration`/현재 브랜치)에 반영되는가?
2. 동일 버그의 과거 수정이 본 문서에 있는가? 있으면 **그 접근과 충돌/중복** 여부 대조.
3. 수정 후 `BUG_MASTER_LEDGER.md` `재발 여부`/`현재 상태` 갱신 + 본 로그에 회차 추가.
4. **squash 커밋 금지** — 버그 수정은 독립 커밋으로 추적 가능하게.
