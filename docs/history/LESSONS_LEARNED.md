# 📚 LESSONS LEARNED & DESIGN RULES (HQ Knowledge Base)

> WES v2.0 §11~13. 종결 이슈마다 Lesson + Design Rule을 축적한다. Blameless — 사람이 아니라 프로세스 개선.
> 이후 프로젝트(MaruSnap / Gourmet / FitFlow)에서 재사용한다.

---

## WRPS-047 — 멀티단말 카운트다운 비동기 시작 (Regression of WRPS-015, 회차 3)

**Issue**: 참가자 단말들이 동시에 카운트다운을 시작하지 않음(시작/판정/결과 시점 단말별 상이). Severity High / P0. 발견 Build8.4(=build13 직전), 멀티디바이스. Fix commit `db0d16a`.

**History / Regression**: WRPS-015(카운트다운 시차)는 2026-06-22 실기기 PASS·종결됐으나 BUG_MASTER_LEDGER에 "late-arrival 보정 공백" 명시. 음성팩(03571d9, 06-26) 적용 환경에서 재노출 → **회차 3 회귀**로 확정(REGRESSION_TRACKER).

**5 Whys**
- WHY1 왜 발생? 단말마다 카운트다운 시작 시각이 달랐다.
- WHY2 왜 달랐나? 각 단말이 `countdownStartAt`(공유 서버시각)을 자기 로컬 시계로 평가했고, 시계 오프셋이 달랐다.
- WHY3 왜 오프셋이 어긋났나? `syncServerClock`이 HTTP `Date` 헤더로 오프셋을 추정하는데, **헤더가 '초' 단위(소수점 없음)** 라 내림(floor) 편향으로 기기마다 최대 ~1초 오차.
- WHY4 왜 설계가 허용했나? 초단위 헤더를 sub-second 보정 없이 그대로 사용 + late-arrival(전파 지연) 보정 공백.
- WHY5 **Root Cause**: **카운트다운 동기화가 sub-second 정밀도가 없는 초단위 HTTP Date 헤더에 의존하고, 전파 지연 흡수 lead가 부족했다.**

**Architecture 영향**: Server-Authoritative/Clock-Sync 원칙 영역. 위반 없음(서버시각 기준 유지).

**Root Cause Fix(`db0d16a`, 워크어라운드 아님)**: `syncServerClock` floor 편향 **+500ms 중앙보정** + 샘플 3→5, lead 2800→3600ms, runCountdown sleep캡 3000→4000(캡<lead로 빠른 단말 조기시작 방지).

**Regression Test**: npm test 49/49(당시), codex-critic 재검토 PASS. 단 런타임 동기화라 단위테스트 한계.

**Device QA**: ⏳ **미수행**(실기기 멀티디바이스 매트릭스). High 종결 전 필수.

**왜 테스트가 못 잡았나**: 동기화는 멀티디바이스 wall-clock 런타임 속성 → 단위테스트 불가. **그래서 v2 엔진에 결정론 시뮬(ordering/replay/clock-sync)을 도입**해 코드로 검증 가능한 차원을 확보(WRPS-049).

**Design Rule (재사용)**:
- **DR-1 Countdown = 서버 timestamp + 충분한 lead**. 클라이언트 로컬 시계를 순서/시작 판단에 쓰지 않는다.
- **DR-2 Clock offset은 sub-second 정밀**. 초단위 소스(HTTP Date)는 구간 중앙보정(+500ms) 또는 RTT 기반(ClockSync, last-N 롤링 중앙값)으로 보정한다.
- **DR-3 lead > 애니메이션 대기 캡**. 빠른 단말이 공유 startAt 전에 시작하지 않도록.

---

## WRPS-046 — 게임 결과 음성 2회 재생 (신규, 구조적 잠복)

**Root Cause**: `finishRoundLocal`이 result→game_over 전이로 한 라운드에 2회 호출되는데 결과 음성 setTimeout에 idempotency 가드가 없었다(과거 TTS는 `speechSynthesis.cancel`이 중복을 은폐). Fix `8c8bc1d`: `playResultVoiceOnce`(키=gameRound:round).

**왜 테스트가 못 잡았나**: index.html 런타임 UI/오디오 경로에 단위테스트 부재.

**Design Rule**:
- **DR-4 Audio = event reaction + eventId/round-key dedup**. 한 라운드 결과음·효과음은 키 기반 1회. 직접 호출 누적 금지.
- **DR-5 동일 함수가 2회 호출될 수 있는 전이(result→game_over)는 side-effect(통계·오디오)에 idempotency 가드**를 둔다.

---

## WRPS-045 — 한국어 MC음성/TTS 혼재 (신규)

**Root Cause**: 일부 이벤트만 mp3 매핑 → 미매핑 이벤트가 TTS로 폴백되어 MC와 혼재. Fix `baebae2`: `VOICE_SILENT` 센티넬 + 정책상 ko=클립ONLY.

**Design Rule**:
- **DR-6 음성은 단일 소스 정책**(녹음 또는 TTS 중 하나로 통일, 로케일별 분리). MP3 매핑된 이벤트는 절대 TTS 사용 안 함.

---

## Build15/16 — QA 자동화 기반 (신규)

**Build15**: `__QA_BUILD__` 플래그로 QA 계측을 네이티브에서 자동 ON. root `index.html`은 항상 false, dist 사본만 `QA_BUILD=1`일 때 true 치환 → 출시 빌드 영향 0. `BUILD_MANIFEST.json`을 dist에 생성해 Evidence 출처(build/commit/qa_enabled) 식별. TestFlight build 15 VALID.

**Build16**: 앱이 QA Record를 자동으로 남긴다. 세션 자동 시작 + 게임/방 종료 시 자동 스냅샷 + `__qaMetrics.export()` 표준 입력. `scripts/qa-export.mjs`로 Analyzer 입력을 표준화(어떤 형태든 수용) → `qa-report.json` 생성.

**Lesson**:
- 전역 함수 래핑(자동 스냅샷)은 **전역이 모두 정의된 이후**에 설치해야 한다. `bootAppWhenReady()`가 `window.endGame` 할당보다 먼저 호출되므로, 래핑을 QA 코어 초기화 지점이 아닌 전역 할당 뒤에 배치.
- 래핑은 원본을 그대로 위임(snapshot 후 `apply`)해 **게임 로직 무변경**을 보장. `__qaWrapped` 가드로 중복 래핑 방지.

**Design Rule**: DR-11(Sprint 사전점검), DR-12(QA 계측 자동화).
