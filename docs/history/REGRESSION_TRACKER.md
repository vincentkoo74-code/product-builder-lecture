# ♻️ REGRESSION TRACKER — 재발/회귀 전용 추적

> "한 번 고쳤는데 다시 나온" 또는 "한 분기에서 고쳤으나 출시 본류엔 없는" 문제를 전용 추적한다.
> 회귀 발생 시: 같은 `WRPS-NNN` 유지 → 아래에 회차(round) 1줄 추가 → `ACTIVE_ISSUES.md`로 승격.
> 갱신: 2026-06-28 (Build8.4 — WRPS-047 회귀 + 045/046/048)

---

## 회귀 위험도 분류 (현재 코드 `35cd68d`=build8 기준)

| 위험도 | 정의 | 해당 ID |
|---|---|---|
| **Critical** | 출시 차단, 데이터/진행 불가, 다수 사용자 영향 | (확정 0) |
| **High** | 핵심 UX 손상, 일부 사용자 게임 불가/무음 | ~~WRPS-013, WRPS-014~~ → **Build8.1 코드 수정됨**(실기기 검증 대기) |
| **Medium** | 조건부 발생, 우회 가능, 타이밍 의존 | WRPS-015→**WRPS-047(회차3, Build8.4 보강·실기기 미검증)**, WRPS-037, WRPS-026, WRPS-036 |
| **Low** | 경미·미관·기능 미도입 | WRPS-018, WRPS-019, WRPS-020, WRPS-034, WRPS-041, WRPS-021 |

> **핵심 사실**: build8 마이그레이션(`82d7f57`)은 index.html을 +36줄(격리 Firebase 로더+디버그버튼)만 변경, 게임 로직 byte 동일 → **build8이 신규 주입한 회귀는 0건**. 아래 회귀는 전부 build6 이전부터 잠재.

---

## Build17 Device QA 신규 관찰 (2026-07-07, 회귀여부 일부 미확정)
> Evidence: `qa-report-build17-2026-07-07-05-28-37.json`. QA persistence는 PASS로 종결. 아래는 게임 무변경·별도 관리.

| ID | 관찰 | 회귀 성격 | 상태 |
|---|---|---|---|
| **WRPS-052** | VOICE audioMissing 22건(intro/gameOver/becameLoser, ko) | **audio 클러스터 재발군**(WRPS-015→047, 045/046/048/051/055/057과 동류의 음성 무음/누락 재발) | 관찰(경로 확정 전 — 버퍼 미로딩 vs clip 누락) |
| **WRPS-072** | ROUND_RESULT QA metric 2×/eventId | **회귀 아님(판정/DB 정상)** — client instrumentation 중복. 단 `finishRoundLocal` 이중호출 경로라 **WRPS-062(다중술래 오전환) 인접** | 신규 관찰(교차확인 필요) |
| **WRPS-073** | countdownDriftMs 음수(≈ −waitMs) | 회귀 아님 — scheduled lead(설계상 정상), 명명 오해 소지 | 신규(명명/문서 개선 대상) |

> 주의: WRPS-072의 `finishRoundLocal` 이중호출이 확인되면 **WRPS-062 Evidence로 승격** 검토(같은 함수 계보). 추측 수정 금지(DR-10).

## Build19 확정/후속 (2026-07-08)
> Evidence: Build18 필드QA(host/participant JSON 직접 대조). WRPS-072는 위 "신규 관찰"에서 **원인 확정**으로 승격됨.
> **Build19 상태: RC 아님 — 실기기 QA 대기.** TestFlight VALID(`a133d610-...`)는 설치 가능 상태일 뿐, 아래 잔여 리스크 4건 확인 전까지 RC 확정 안 함(DR-10). 동일 목록이 `QA_STATUS.md`/`ACTIVE_ISSUES.md` Build19 절에도 기록됨.
> 1. ~~intro TTS 실제 가청 여부~~(해소 — TTS 제거, 단어별 순차재생으로 대체. 신규 확인: 4박자 순서/겹침없음) 2. 다기기 동기화 gap(analyze-qa-sync.mjs 실측 필요) 3. host 데이터 레이스 재발(600ms 재시도 예산 초과 시) 4. resolveElimination() 미호출(구조적, 아래 상세)

- **WRPS-072 원인 확정**: instrumentation 중복이 아니라 **host 참가자 row 데이터레이스**(host resultValue:null 33% vs participant 0%, 동일 eventId 18초뒤 다른 outcome 재분류 1건 확인). `f5bb308`로 표적 수정(재조회 재시도+idempotency 가드). WRPS-062 인접 가설은 **기각**(별개 메커니즘 — round 재계산 자체가 원인이었지, 다중술래 오전환과 직접 연결되지 않음).
- **신규 backlog(회귀 아님, 코드 품질)**: `src/game-logic.mjs`의 `resolveElimination()`(37개 테스트로 검증됨, `index.html`에 마커블록으로 자동 주입됨)이 **실제로는 어디서도 호출되지 않음** — `finishRoundLocal()`이 동일 로직을 손으로 중복 구현. 현재는 조건 대조로 일치 확인됐으나, 향후 한쪽만 수정되면 조용히 drift 가능. Build19에서는 판정 로직 변경 리스크를 늘리지 않기 위해 **의도적으로 미착수**(표적 수정 범위 밖). 차기 Sprint에서 `finishRoundLocal`이 `resolveElimination()`을 직접 호출하도록 리팩터링 검토(동작 무변경 목표, 낮은 리스크지만 핵심 판정 경로라 전용 세션 권장).
- **WRPS-052-B19 신규**: intro TTS override(DR-6 예외, Evidence-gated) — 실기기 가청 확인 전까지 audioMissing/audioFallback 재발 여부와 별개로 열어둠.
- **WRPS-052-B19 정정(2026-07-08)**: 실기기 QA("기계음만 들림, MC 목소리 아님")를 계기로 whisper(OpenAI) 전사로 `ASSETS/rps/voice/ko/` 14개 파일 전수 재확인. `ko_game_start.mp3`="게임을 시작합니다."(06-26/28 "풀구호 청취확인" 기록은 오류로 판명), 전체 파일에 "가위바위보" 문구 없음 확정.
- **WRPS-052-B19 최종 확정(같은 날)**: 사용자가 기존 단어별 녹음(`ko_scissors/rock/paper.mp3`)을 직접 청취로 확인 → **TTS_OVERRIDE 완전 제거**, `ko_game_ready.mp3`(구 `ko_ready.mp3`)+`ko_scissors/rock/paper.mp3` 4개 파일을 `runCountdown()` ko 전용 분기에서 순차 재생(준비→가위→바위→보). DR-6 위반 없음(전부 mp3, TTS 미사용). en/ja 무변경. **신규 backlog(코드 아님, 콘텐츠 제작)**: "안 내면 술래 가위바위보!!" 전체 구호는 여전히 사람 목소리 부재 — MC 성우 재녹음 시 재검토.

## Build21 확정/후속 (2026-07-13)
> Evidence: CEO 실기기 직접 청취(ko/ja/en 3개 언어 PASS) + Functional Self-Check(코드 정적점검·테스트 285/285). **RC 후보 — 최종 RC 확정은 멀티기기 field QA JSON 확인 후 결정**(DR-10). 동일 목록이 `QA_STATUS.md`/`ACTIVE_ISSUES.md` Build21 절에도 기록됨.

- **WRPS-052-B19 backlog 해소**: "안 내면 술래 가위바위보!!" 전체 구호 사람 목소리 부재 backlog가 ElevenLabs 다국어(ko/ja/en) 생성으로 해소됨. `countdownRps` 단일 오디오키로 통합(준비→countdownRps 2박자, 3개 언어 공통 구조). 실기기 청취 PASS 확인 완료.
- **finishRoundLocal() 음성 재설계, 판정 로직 자체는 무변경**: 결과 음성을 개인관점(승자/패자 분기)에서 그룹공지(taggerSelected/drawRetry/replayLosersOnly/replayWinnersOnly)로 재설계. `state.confirmedSafeIds`/`confirmedLoserIds` 대입식·`renderRoundResult()` 인자·`scheduleRematchAutoAdvance()` 호출·`state.lastRoundResolution` 구조는 diff 기준 byte 단위로 동일(codex-critic 2회 독립검증 PASS). 개인 SFX(win/lose/draw)는 그대로 유지.
- **`resolveElimination()` 미호출 backlog는 그대로 유지**(Build19부터 동일, Build21도 미착수 — 표적 범위 밖). `elimination.test.mjs` 37건이 `nextActiveIds`/`newConfirmedLoserIds`/`isComplete` 등 실제 상태를 검증함을 재확인(snapshot 아님).
- **신규 관찰**: QA 필드 명명 불일치(`resultDisplayServerTs`/`nextRoundStartServerTs`/`renderGapMs` 요청명 vs `phaseScheduledAt`/`phaseKind`/`gapMs` 구현명) — 기능 결함 아님, Low 기록만.
- **분석 도구 공백**: `resultValue` null count / `countdownStartServerTs` 0 count 자동집계 스크립트 없음(수동 jq 필요) — 이번 단계에서 신규 생성하지 않음(사용자 지시).

---

## 회귀/누락 상세 (재발 메커니즘)

### REG-A: Lineage A 미머지 누락 (구조적 회귀의 본질)
- **메커니즘**: `claude/fix-game-ready-button-bl7zf`(05-18)의 수정 7건이 `b07d0e3`에서 분기 후 **본류에 한 번도 머지되지 않음**(`merge-base`=b07d0e3로 검증). Build3~6은 이 분기를 모른 채 진행 → 누락분이 사용자에겐 "다시 나온 버그"로 체감.
- **은폐 원인**: Build3~6 전 QA가 단일 커밋 `ded6154`로 squash(증분 커밋 부재) → 무엇이 빠졌는지 diff로 드러나지 않음.

| ID | 버그 | 본류 처리 | 회귀 상태 |
|---|---|---|---|
| WRPS-013 | 재초대 수락 후 대기화면 고착 | 미반영 | **High(LIVE)** |
| WRPS-014 | 참가자 TTS 미재생 | 미반영 | **High(LIVE)** |
| WRPS-015 | 카운트다운 시차 | 대체구현(serverNow), late-arrival 갭 → **회차3 재발=WRPS-047**(Build8.4: Date헤더 +500ms 보정·lead3600·캡4000) | Medium |
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
| 2026-06-26 | — | — | **음성팩 적용**(03571d9) — 한국어 MC 녹음 mp3 + playVoiceClip 레이어 | WRPS-045/046 신규 유발, WRPS-047 재노출 계기 |
| 2026-06-28 | WRPS-047 | **3** | **재발(WRPS-015 회차3)** — 멀티단말 카운트다운 비동기 시작. 실기기 QA에서 재확인 | 원인: Date헤더 초단위 floor clock offset + late-arrival |
| 2026-06-28 | WRPS-047 | 3 | **Build8.4 수정**(`db0d16a`) — syncServerClock +500ms 중앙보정·샘플5, lead 3600, sleep캡 4000 | 실기기 멀티디바이스 매트릭스 재검증 필수 |
| 2026-06-28 | WRPS-045 | 1 | **신규 발견+Build8.4 수정**(`baebae2`) — MC/TTS 혼재. go를 VOICE_SILENT로 무음(intro 풀구호 커버) | 실기기 검증 대기 |
| 2026-06-28 | WRPS-046 | 1 | **신규 발견+Build8.4 수정**(`8c8bc1d`) — 결과음성 2회. playResultVoiceOnce 라운드당 1회 | 실기기 검증 대기 |
| 2026-06-28 | WRPS-048 | — | **개선+Build8.4**(`51d5c6a`) — 버튼 효과음 묵직한 클릭음+연타 디바운스 | 실기기 청취 확인 대기 |

---

## 회귀 방지 체크 (모든 수정 시)
1. 수정이 **어느 lineage/브랜치**에 들어가는지 확인 — 본류(`build8-client-migration`/현재 브랜치)에 반영되는가?
2. 동일 버그의 과거 수정이 본 문서에 있는가? 있으면 **그 접근과 충돌/중복** 여부 대조.
3. 수정 후 `BUG_MASTER_LEDGER.md` `재발 여부`/`현재 상태` 갱신 + 본 로그에 회차 추가.
4. **squash 커밋 금지** — 버그 수정은 독립 커밋으로 추적 가능하게.

## Build16 재발 후보 (2026-07-01, Triage)
- **WRPS-062 ↔ WRPS-043**(다중술래): 3인 술래2 선택/전체 재게임 오전환 재발 후보 — Build8.2 수정 이후 회귀 여부 실기기+테스트로 확정.
- **WRPS-058 ↔ WRPS-047/036**(카운트다운 동기): 서버 startAt 기반 유지되나 실기기 drift 재발 후보 — build15 계측으로 확정.
- **WRPS-061 ↔ WRPS-044/026**(stale/고착): 호스트/참가자 이탈 시 stale·화면 고착 재발 후보.
- **WRPS-067 ↔ WRPS-024**(직전 결과): 홈 복귀 시 직전 결과 미노출 재발 후보.
- 원장: `docs/BUILD16_QA_PLAN.md`.
