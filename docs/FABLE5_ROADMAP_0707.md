# FABLE5 ROADMAP — 재발 문제 구조적 종결 (~7/7)

> 생성 2026-07-02. Fable 5 3-트랙 심층설계(v2 엔진 컷오버 · 오디오 event-bus · 다중술래 상태머신) 통합.
> 목표: "매 빌드 패치해도 형태만 바꿔 재발"하던 문제 클래스를 **증상 패치가 아니라 뿌리에서** 종결.
> 원칙: DR-8(Strangler: 모듈 추가+flag OFF+shadow+점진), DR-10(Evidence 없는 Fix 금지), 판정 로직(src/game-logic.mjs) 무변경.

---

## 0. 단일 뿌리 = "권위 부재"

세 클러스터는 한 구조를 공유한다: **권위(서버/이벤트소스) 대신 클라이언트 로컬 스냅샷·타이밍·재계산에 의존.**
- 진실 = 순서 없는 last-write 스냅샷(rooms.status + participants.choice 마커) → 매 인터리빙마다 bespoke 가드 플래그 → 새 WRPS 번호.
- 결정(소거/판정)을 **모든 기기가 독립 재계산** → 분산 발산 = 다중술래·동기화 클래스.
- 화면 전이가 **edge-triggered**(status 변경 시에만) → 놓친 edge = 영구 고착 → 화면별 백스톱 누적.
- 타이밍 = 기기별 wall-clock + 휴리스틱 → drift/지연 창발.

**해답 = v2 event-sourced 엔진을 권위로 승격**(engine/ 이미 존재·테스트 통과·런타임 inert) + **오디오 authoritative event-bus**. 셋 다 같은 엔진/이벤트 기반으로 수렴한다.

---

## 1. 🔑 핵심 발견 — WRPS-062는 "부분적으로 지금 고칠 수 있다"

Fable-C가 코드로 **증명 가능한 결함 3개**를 특정(= 062의 "전체 재게임 오전환"은 순수 Evidence-gated가 아님):

- **Defect A (provable NOW)**: `handleRoomUpdate`가 `room.round===1`인 동안 **매 호출마다** confirmedSafe/LoserIds를 wipe(index.html:5079-5087). 5초 폴링이 handleRoomUpdate를 무조건 호출. target≥2 게임의 1라운드 tooFew/tooMany 직후, confirmed ids는 nextRound(2.6s auto-advance)까지 **로컬에만** 존재(마커는 nextRound에서만 DB 기록). 폴링 tick이 그 창(~50% 확률)에 들어오면 host 배열 wipe → nextRound가 빈 배열 읽음 → 마커 미기록 → 전원 active 리셋 → **확정 술래가 재대결로 복귀 = "전체 재게임"**. gameRound는 안 바뀌는데도 사용자 체감은 전체 재시작.
- **Defect B (provable NOW)**: `getParticipantSignature`가 is_host 포함(4631) → 멤버십 동일한데 host-flag만 바뀌어도 `shouldResetForParticipantChange` true → full restart(5296-5300, status 게이트 없음: result/playing에서도 발동).
- **Defect C (provable NOW)**: `nextRound` early-exit(7538-7542)가 gameOver 화면만 렌더하고 `rooms.status='game_over'` 미기록 → 비호스트 result에 고착.

→ **P1(7/2~3)에서 A/B/C를 지금 수정+단위테스트 가능**. 어느 path가 실제 현장 재시작을 냈는지 "확정"만 build16 Evidence로.

---

## 2. 트랙별 요약

### 트랙 1 — v2 엔진 컷오버 (동기화 058/059/060 + 다중술래 062 + 고착 061)
- **현황**: `engine/`(events/EventBus/GameEngine/adapters/clock-sync/sync) 완비·순수·테스트 통과(parity/stress/sync/clock-sync). 그러나 **런타임 inert**(ingest/dispatch 호출부 0, round-result shadow만). 전송계층 = Option C(스키마 무변경, host 엔진=결정 두뇌).
- **컷오버 4결정**: D1 결과/소거(→043/062 종결) · D2 countdown ClockSync(→058) · D3 화면 reconciler=phase의 순수함수(→044/061) · D4 결과 스케줄링(059/060, gated).
- **NOW**: M1 전체 이벤트 미러링 shadow, M2 ClockSync 런타임 배선, M3 D1 권위 컷오버(flag OFF), M4 D3 reconciler(flag OFF). **Gated**: M6 device metrics → M7 QA-only flag flip.

### 트랙 2 — 오디오 authoritative event-bus (051/052/055/057)
- **현황**: 전 오디오 per-device 로컬 트리거(join/leave=fetchParticipants diff 5303-5312). dedup 3개 분산(voice seenEvents / sfx round-key / meow 없음). SFX 메트릭 0 → 커버리지 증명 불가.
- **설계**: `AudioBus` 레이어(게임로직↔SoundManager). 참가자-**identity** 이벤트(diff 아님, `seenMemberIds` per epoch)로 WRPS-055 해소. 단일 dedup 레지스트리(키 granularity 보존→DR-4/5 무변경). 커버리지 메트릭(기기별 dedupKey parity), `silent-by-design` 결정 분리(WRPS-051 관측 구멍 해소).
- **NOW(대부분 코드레벨)**: M1 AudioBus+메트릭 pass-through, M2 join/leave identity 라우팅, M3 countdown/result 라우팅+051 정책, M4 테스트+QA 메트릭 검증, M5 A/B soak. **정책 결정 필요**: `go="@silent"` 유지(silent-by-design 재분류) vs `ko_go.mp3` 신규(별도 트랙).

### 트랙 3 — 다중술래 상태머신 (062)
- **설계**: 명시 player 상태(ACTIVE/REMATCHING/SAFE_CONFIRMED/LOSER_CONFIRMED/WAITING) + sequence 상태(engine phase). **lobby로 가는 유일한 edge = 명시 `GAME_RESET`**(현재 beginNewGameRound 7+곳 무게이트) — result/playing 중엔 force+audited reason 없이 거부. PLAYER_LEAVE→리셋 아닌 re-elimination(기존 insufficient-active 규칙이 수렴). HOST_TRANSFER=hostId만(Defect B 구조적 제거). target 고정(GAME_START, 재-clamp 제거).
- **NOW**: P0 GAME_RESET 텔레메트리+repro red 테스트, P1 Defect A/B/C 수술적 수정, P2 엔진 권위(flag OFF). **Gated**: P3 device로 어느 path 확정 + flag flip.

---

## 3. 통합 7/7 타임라인 (today=7/2)

| 일자 | v2 엔진(T1) | 오디오(T2) | 다중술래(T3) | 게이트 |
|------|-------------|------------|--------------|--------|
| **7/2** | M0 baseline lock + M1 시작(이벤트 미러링 shadow) | M1 AudioBus 스켈레톤+메트릭 pass-through | P0 GAME_RESET 텔레메트리 + repro red 테스트 | NOW |
| **7/3** | M1 완료 + M2 ClockSync 배선(flag OFF) | M2 join/leave identity 이벤트 라우팅 | **P1 Defect A/B/C 수정**(index.html, judging 무변경) | NOW |
| **7/4** | M3 D1 결과 권위 컷오버(flag OFF) | M3 countdown/result 라우팅 + 051 정책 확정 | P2 엔진 권위(ENGINE_V2_AUTHORITY, OFF)+직렬화 | NOW |
| **7/5** | M4 D3 화면 reconciler + M5 QA build17 컷 | M4 테스트+QA 메트릭 커버리지 검증 | P2 완료 + 회귀테스트 확장 | NOW→build |
| **7/6** | **M6 device Evidence 수집**(2/3/4기기, 6R+) | M5 A/B soak+freeze | P3 device QA(GAME_RESET reason+shadow parity) | **build16/17** |
| **7/7** | M7 QA-only flag flip(ClockSync→Result권위→Reconcile), gate PASS 기록 | 커버리지 green→AUDIO_BUS_ENABLED flip(QA) | P4 gate green+shadow MISMATCH=0→ship | Gated |

**공통 산출 빌드**: 7/5 `QA_BUILD=1` **build 17**(shadow+미러링 ON, 권위 flag 전부 OFF) TestFlight → 7/6~7 device Evidence.

---

## 4. 공통 회귀 가드
1. **flag-OFF 안전**: 신규 경로 전부 default-false const flag. 엔진 번들은 dist에만. QA 계측은 QA_ENABLED만. `ENGINE_V2_ENABLED===false` + 하위 flag OFF를 grep 테스트로 고정(무단 flip 방지).
2. **shadow tripwire 상시**: 권위 flip 후에도 shadow compare 유지 → MISMATCH를 `shadow match=100%` gate로 차단.
3. **결정론 시뮬 CI 바닥**: engine-parity(전조합) + engine-stress(순서/dup/replay/1000) + engine-sync(멀티기기 수렴) + 신규 GAME_RESET-거부/PLAYER_LEAVE-re-elimination/오디오 커버리지.
4. **판정 불변**: `tests/elimination.test.mjs`(A~F, WRPS-043 host-as-player) **무수정 통과 필수** — 수정 필요하면 설계 오류.
5. **device 파이프라인(DR-10/12)**: 계측빌드→__qaMetrics.export()→qa-analyze→release-gate(NO-DATA를 blocker로 취급, "가정에 의한 검증" 차단).
6. **롤백**: 각 마일스톤=독립 커밋(revert 가능), flag flip은 QA 빌드 한정 → production 롤백 대상 없음.

---

## 5. 즉시 착수 (지금~7/2)
- [ ] **T3 P1 Defect A**: `handleRoomUpdate` round===1 wipe(5079-5087)를 실제 새-게임 전이(gameRound 변경/round 감소)로 한정 + nextRound가 빈 배열 시 stored results에서 confirmed 재도출. **단위테스트(폴링 창 race)** 먼저 red.
- [ ] **T3 P1 Defect B**: 멤버십 서명에서 host-flag 분리, 5296 status 게이트(playing/result 제외).
- [ ] **T3 P1 Defect C**: nextRound early-exit가 `game_over` 권위 기록.
- [ ] **T1 M1**: 레거시 훅에서 `__engineV2.dispatch/ingest`로 이벤트 미러링(SHADOW 가드, UI 무영향) + phase-mismatch shadow 메트릭.
- [ ] **T2 M1**: AudioBus 스켈레톤 + 기존 호출부 pass-through 메트릭.
- [ ] **정책**: WRPS-051 countdown "go" — silent 유지(재분류) vs ko_go.mp3.

> 실행 규율: 각 항목 Root Cause 단위 커밋 → 회귀테스트 → **codex-critic 검증**(critical/high는 Review Correction Loop) → orchestrator 승인. 구현은 codex-main/Fable5, 검증은 codex-critic.
> 상세 근거(file:line)는 세 Fable5 트랙 원문 참조(이 로드맵의 각 트랙 절).
