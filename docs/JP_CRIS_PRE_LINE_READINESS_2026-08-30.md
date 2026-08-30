# MARU RPS V1.0_JP — CRIS PRE-LINE ENGINEERING READINESS REPORT

작성일: 2026-08-30 · 성격: 엔지니어링 준비도 점검 (§15 규칙 — 검사 → 테스트 → 분류)
프로덕션 소스(`index.html`, `supabase/`) **무변경**.

---

## 1. Repository State

| 항목 | 값 |
|---|---|
| 저장소 | `/Users/vk/Documents/Codex/2026-06-02/new-chat/product-builder-lecture` |
| 브랜치 | `feature/rps-jp-line-miniapp` ✅ (예상 브랜치와 일치, 가정 아닌 확인) |
| HEAD | `34583b4` |
| origin | `34583b4` (동기) |
| 최근 커밋 | `34583b4` JP-BL-027-C 등록 / `67eca0f` Phase A 하니스 쿼리 계약 / `7d71d04` JP-BL-027 클라이언트 write 무결성 |

## 2. Working Tree

**수정 3 / 신규 10 — 전부 `tests/` 와 `docs/`. 프로덕션 무변경.**
`git diff --stat 34583b4 -- index.html supabase/` → 빈 출력.

```
 M docs/JP_RELEASE_BACKLOG.md
 M tests/rc3-harness-support.mjs
 M tests/rc3-multiparticipant-sim.test.mjs      ← 예산 상수만(단언 무변경, §5 참조)
?? tests/rc3-{h1a-choice-timing, h1a-schedule-sweep, harness-participant-realtime,
              harness-refetch-guard, r1-authoritative-refresh, r1b-result-publish,
              n2-remote-validation}.test.mjs
?? docs/JP_{LEGAL_PRE_STUDY, MARKET_EXECUTION_PLAN_V1, RC3_AUTHORITATIVE_REFRESH,
             RC3_REALTIME_FIDELITY, RC3_RESULT_PUBLISH}*.md
```

⚠️ **미커밋 상태다.** 이 세션들의 산출물이 전부 워킹트리에만 있다 — 커밋 승인이 필요하다(§22).

## 3. Shared CORE / JP Boundary

**§5의 제품 발견을 코드로 재확인했다**: 엔진은 Supabase Realtime 기반 네트워크 멀티플레이다. 물리적 근접이 필요한 것은 **QR 입장 방식**뿐이다. → **JP는 입장 어댑터 교체이지 엔진 포크가 아니다.**

| 분류 | 내용 |
|---|---|
| **CORE** | RPS 규칙 / 상태머신 / 방 생명주기 / ready / 라운드 진행 / 판정 / 재대결 / host 승계 / 동기화·타이밍 / rc3 하니스·회귀 |
| **JP** | Tokyo / LINE·LIFF / **초대 링크 입장 어댑터** / 일본어 카피 / JP 법무 표기 |
| **KR** | Seoul / Kakao / QR 입장 어댑터 / 네이티브 패키징 |
| **MARKET-COMMON 후보** | 입장 어댑터 추상화, "상대 대기" 상태 모델 — **아직 승격하지 않는다**(두 번째 시장이 실제로 쓰기 전 추상화 금지) |

---

## 4. JP-BL-027-B Status — **미해결 (OPEN). 재구현하지 않고 증거로 확정했다.**

`index.html:11057~11148` (92줄). 코드 주석 11084-11087이 스스로 미해결임을 기록하고 있다:
> "JP-BL-027-B(미해결, CEO 반환): 이 write 들은 error 만 검사하며 무음 0행은 놓친다."

### write 4건 전수 감사

| # | 라인 | 테이블 | 필터 | 기대 행수 | 0행 시 | 다중행 시 | 현재 검증 |
|---|---|---|---|---|---|---|---|
| W1 | 11088 | `participants` | `.eq('room_id', roomCode)` | **N (방 전원)** | 라운드 리셋 미반영 → 이전 선택 잔존 | 정상(의도된 대량) | `error`만 |
| W2 | 11092 | `participants` | `.in('id', safeIds)` | **정확히 `safeIds.length`** | 안전자 마커 누락 → 판정 집합 오염 | 초과 불가(id 집합) | `error`만 |
| W3 | 11096 | `participants` | `.in('id', loserIds)` | **정확히 `loserIds.length`** | 술래 마커 누락 | 초과 불가 | `error`만 |
| W4 | 11102 | `rooms` | `.eq('id', roomCode)` | **정확히 1** | **라운드가 진행되지 않음** — 가장 치명적 | 불가(PK) | `error`만 |

- **부분 성공**: W1~W3 성공 후 W4가 0행이면 참가자 상태만 리셋되고 방은 이전 라운드에 머문다 → 전 기기가 멈춘다.
- **로컬 커밋 시점**: `state.penalty`가 W4 **이전**(11101)에 대입된다 — W4가 무음 0행이면 로컬만 앞서간다.
- **경합**: `state.advancingRound` 가드가 있고, 실패 시 catch에서 해제 + 재시도 예약(안전망 A).
- **복구**: catch가 `QA.emit('metric', …)` + 재시도. 단 **0행은 catch에 도달하지 않는다.**

### 착수를 막던 선행 조건 — **지금은 해소되었다**

주석이 밝힌 차단 사유는 "rc3 하니스가 `.eq('room_id',…)` 대량 업데이트를 재현하지 못한다"였다. JP-BL-027-C 작업으로 **strict 필터가 구현되어 이 한계는 사라졌다.** 실증(H1-a 세션 진단): legacy 모드에서는 `.eq('room_id')` 재조회가 빈 결과를 반환해 `autoFillChoices`가 **한 번도 발화하지 않았고**(auto-choice 행 0건), strict 모드에서는 정상 발화(10건)했다.

→ **JP-BL-027-B는 이제 기술적으로 착수 가능하다.** 다만 rc3 기본값이 아직 legacy이므로, 검증은 strict 경로로 해야 한다(§18).

---

## 5. rc3 / H1-a Actual Status (저장소·테스트 증거 기준)

정식 리포트 3종이 존재한다: `JP_RC3_REALTIME_FIDELITY_2026-08-29.md`, `JP_RC3_AUTHORITATIVE_REFRESH_2026-08-29.md`, `JP_RC3_RESULT_PUBLISH_2026-08-29.md`.

| 항목 | 실측 상태 |
|---|---|
| H1-a 결정론적 선택 스케줄 | **구현·배선 완료**. `CHOICE_SCHEDULES` S1~S7 + `defaultChoiceOffsetMs`. 전 시점이 `CHOICE_WINDOW_MS`(index.html:5286, =5000)의 분수로만 정의 — 인간 반응시간 상수 없음 |
| Trigger A (`fetchParticipants:7334`) | **활성**. rc3 배선에서 `publishHostResultOnRefresh:false` 미지정 |
| Trigger B (`autoFillChoices:9271`) | 기존대로 동작. **legacy 필터에서는 발화하지 않음**(위 §4 실증) |
| legacy 스위트 | **63/63 GREEN** |
| strict 스위트 | **8 실패 / 55 통과**, 하드게이트 **87**, 타임아웃 **2** |
| 전체 저장소 스위트(rc3 제외) | **81 파일 / 1414 통과, 1 skipped** |
| 하니스 충실성 잔여 | R2(트라이얼 종료 시 배달 drain 미보장), R3(폴링 pending 유실) — 둘 다 OPEN |
| 프로덕션 결함 미해결 | **JP-BL-027-B** (§4), **JP-REALTIME-VALIDATION** (§14) |

⚠️ `tests/rc3-multiparticipant-sim.test.mjs` 수정 내용: WRPS-079 시드 고정 테스트에 `maxRounds:200, budgetMsPerRound:60000` 부여. **임계값 완화가 아니라 시간축 보정**이다 — 선택이 5초 창에 분산되면서 라운드가 실제로 창을 소모하게 되어 기존 예산이 부족해졌다(실측: 예산 20000→round59 STALL, 60000→round62 STALL, maxRounds 200+60000→**완주·하드실패 0**). CROSS/STALE_ROW/DOUBLE_COUNTDOWN/ROUND_NOT_MONOTONIC/PHANTOM/EXCEPTION 단언은 **하나도 손대지 않았다.**

---

## 6. N=2 Validation Results — **신규 실측**

`tests/rc3-n2-remote-validation.test.mjs` 신설. REAL 로직만 사용, 하드 게이트 신설 없음(관측·분류 전용).

**매트릭스: 선택 스케줄 8종 × 전파 레짐 3종 × 6 trial = 144 trial. 기기간 스큐 ±3000ms 교대 적용.**

| 시나리오 | optimistic | moderate | pessimistic |
|---|---|---|---|
| S1 동시(최초 합법) | pass 0.50, MISSING_COUNTDOWN×4 | 0.67, ×2 | 0.67, ×2 |
| S2 계단식 이른 | **0.17, ×6** | 0.50, ×3 | 0.83, ×1 |
| S3 중앙부 | **1.00** | **1.00** | **1.00** |
| S5 마감 직전 | **1.00** | **1.00** | **1.00** |
| S6 한 명 미선택(타임아웃) | **1.00** | **1.00** | **1.00** |
| S7 A/B 경계 | **1.00** | **1.00** | **1.00** |
| host 먼저 | **1.00** | **1.00** | **1.00** |
| guest 먼저 | **1.00** | **1.00** | **1.00** |

- **24개 조합 전부 completed 6/6** — 게임이 끝까지 진행된다.
- 다라운드(targetRounds=8, pessimistic, 6 trial): **6/6 완주 · correctnessPass 전부 true · 하드 실패 0**. 타이밍 드리프트 누적 징후 없음.
- 하드 실패는 **`MISSING_COUNTDOWN_RENDER` 단일 채널**, **S1·S2에서만**.

### 요구 시나리오 커버리지

| # | 요구 | 커버 |
|---|---|---|
| 1 두 명 빠른 합류 | S1/S2 | ✅ |
| 2 두 번째 지연 합류 | ❌ **미커버** — 하니스가 "늦은 합류"를 모델링하지 않음(§9) |
| 3 host 먼저 선택 | host 먼저 | ✅ |
| 4 guest 먼저 선택 | guest 먼저 | ✅ |
| 5 둘 다 마감 직전 | S5 | ✅ |
| 6 한 명 미선택 | S6 | ✅ |
| 7 무승부 | allDraw baseline(전원 scissors) | ✅ |
| 8 연속 라운드 | targetRounds=8 | ✅ |
| 9 라운드 후 이탈 | ❌ 미커버 |
| 10 host 이탈 | ❌ 미커버 |
| 11 새로고침/재접속 | ❌ 미커버 |
| 12 3라운드+ 드리프트 | 8라운드 | ✅ |
| 13 전파지연 3레짐 | ✅ |
| 14 클라이언트 스큐 | ±3000ms | ✅ |

**판정: N=2는 구조적으로 성립한다. 출시 차단 결함(P1) 없음.** 단 9·10·11·2는 하니스가 모델링하지 않아 **미검증**이며, 이 중 **2(늦은 합류)와 10(host 이탈)이 JP V1의 핵심 시나리오**다(§9).

---

## 7. Production Defects Found

| ID | 내용 | 분류 | 심각도 |
|---|---|---|---|
| P1-1 | **`nextRound` 4개 write 가 무음 0행을 성공으로 취급**(§4). W4(rooms.advance) 0행이면 전 기기 정지 | **CORE** | **High** |
| P1-2 | **방 코드 엔트로피 ~20.7비트** — `Math.random().toString(36).substring(2,6)`, 4자, 암호학적 난수 아님. QR엔 충분하나 **URL 초대에는 열거 위험** | CORE(생성) + **JP(노출 경로)** | **High (JP 출시 시)** |

## 8. Harness Defects Found

| ID | 내용 | 상태 |
|---|---|---|
| H1-1 | S1/S2 극단적 동시 제출 구간에서 `MISSING_COUNTDOWN_RENDER` — 전파지연이 **클수록 줄어드는**(optimistic 6건 → pessimistic 1건) 역상관은 관측 훅이 짧은 카운트다운 창을 놓치는 특성과 부합 | **H1 유력, 미확정.** 추가 진단 필요 |
| H1-2 (R2) | 트라이얼 종료 시 participants 배달 drain 미보장 — 관측 **과소** 카운트 방향 | OPEN |
| H1-3 (R3) | 폴링 경로에서 재조회 pending 유실 | OPEN |
| H1-4 | 하니스가 **늦은 합류/이탈/재접속을 모델링하지 않음** — §6의 미커버 4종 원인 | OPEN, **JP V1 직결** |

---

## 9. Synchronous Invite Risk

현재 동작(코드 실측):
- 방 생성 시 `state.roomCode` = 4자 코드, `rooms` row 생성
- 입장 시 방 조회 → 없으면 `toast.roomNotFound`("존재하지 않는 방입니다")
- **`toast.joinLocked`**("모든 참여자가 준비를 완료해서 새로 참가할 수 없습니다") — **전원 ready 시 입장 차단**
- `hostRoom.locked`("정원 마감") — 정원 초과

**JP 퍼널에 그대로 두면 생기는 문제**:
1. A가 초대 후 **혼자 ready를 누르면 방이 잠긴다** → B가 링크를 열어도 들어올 수 없다. **V1 최대 함정.**
2. A가 나가면 방 row는 남지만 host가 없다 → B가 들어와 혼자 남는다
3. 늦게 연 B에게 보여줄 **전용 상태가 없다** — `roomNotFound` 토스트로 끝난다
4. 방 정리(TTL/cron)가 **전혀 없다**(마이그레이션 전수 확인) → stale room 무한 누적

---

## 10. Recommended Late-Join V1 Behavior — **최소 동기식 해법**

§8 후보 중 **A + C를 채택하고 B는 완화 형태로만** 권고한다.

| | 권고 | 이유 |
|---|---|---|
| **A. host 대기 유지** | **채택** | 제품 약속("보내고 바로") 유지의 핵심. **단 "1인 ready 시 방 잠금"을 JP에서는 해제해야 한다** — 이것이 실제 구현 작업의 전부 |
| **B. 초대 유효기간** | **완화 채택** — 하드 만료 대신 **호스트 접속 여부를 진실 소스로** | 시계 기반 만료는 "친구가 3분 늦었다고 못 논다"는 나쁜 경험을 만든다. "상대가 아직 있는가"가 실제로 중요한 질문 |
| **C. host 부재 시 전용 상태** | **채택** | 「相手はもう待っていません」 + [新しく対戦をつくる] / [もう一度さそう] 2버튼 |
| **D. 알림/재참여** | **후속** | V1 제외 확정 |

**최소 구현 = 3가지뿐**
1. JP 입장 경로에서 **1인 ready 잠금 해제**(또는 2인 미만이면 ready를 자동 유예)
2. **대기 화면** — 방 유지 + 상대 합류 시 즉시 시작
3. **host 부재 상태 화면** — 위 C

비동기 RPS는 도입하지 않는다.

---

## 11. Invite/Join Technical Contract (플랫폼 중립)

```
invite URL → inviteIdentifier → app entry → identity resolution
           → room lookup → join validation → waiting state → match start
```

| 결정 항목 | 권고 | 근거 |
|---|---|---|
| **현재 room ID를 URL에 노출해도 되는가** | **아니오** | 4자·~20.7비트·`Math.random()`. 활성 방이 늘면 열거 가능 |
| **전용 invite token 필요한가** | **필요** | room ID와 분리. `rooms`에 `invite_token` 컬럼 추가 또는 별도 테이블 |
| 토큰 엔트로피 | **≥128비트, `crypto.getRandomValues()`** | 열거 방어. URL-safe base64 22자 |
| 만료 | 하드 만료 대신 **host 접속 상태**를 진실 소스로. 방 자체는 TTL(예: 24h) 정리 | §10 B 근거 |
| 방 없음 | 전용 화면 + [새 대전 만들기] | 토스트로 끝내지 않는다 |
| 정원 초과 | 기존 `hostRoom.locked` 재사용 | |
| **host 부재** | **신규 상태 필요** | 현재 없음 |
| 늦은 열람 | host 있으면 즉시 합류, 없으면 위 상태 | |
| 중복 입장 | 동일 identity면 기존 참가자로 재바인딩(멱등) | 재접속과 동일 처리 |
| 반복 초대 | 같은 방·같은 토큰 재사용 | 새 토큰 발급 금지(링크 파편화) |
| 재대결 | **방·토큰 유지** — 재초대 불필요 | 최단 루프 |
| 새 방 | 새 토큰 | |
| stale 방 정리 | **필요 — 현재 전무** | cron/TTL 신규 |

CORE에는 `inviteIdentifier`만 넘어간다. LINE SDK 세부는 어댑터에 격리.

---

## 12. JP LINE Adapter Boundary

```
[JP Adapter]  LIFF init · LINE Login · deep-link param · shareTargetPicker · profile
      │  정규화
      ▼
{ market:'JP', userIdentity, displayName, inviteIdentifier, entryContext }
      ▼
[CORE]  방 조회 · 입장 검증 · 대기 · 매치
```

**규칙**: CORE는 `liff.*`/`LINE` 식별자를 **절대 참조하지 않는다.** 현재 `index.html`의 LIFF 흔적은 사실상 0이므로 **오염 이전에 경계를 세울 수 있다** — 지금이 적기.
HIKARI가 자격 문제를 닫기 전까지 **LIFF 전면 구현은 하지 않는다.**

---

## 13. Tokyo Migration Readiness — **READY WITH BLOCKERS**

마이그레이션 9종. 순서·내용 확인:

| 파일 | 내용 | 판정 |
|---|---|---|
| `20260101000000` baseline rooms/participants | create table + grant | ✅ 순서 정상(baseline이 최선두) |
| `20260528205753` account_game_stats | RLS + policy + table | ✅ owner-scoped |
| `20260726104300` server_now_rpc | grant execute to anon | ✅ |
| `20260806013625` leave_after_round | — | ✅ |
| `20260827002000` participants room_id index | create index | ✅ |
| `20260827003000` grants least privilege | grant | ✅ rooms/participants 한정 |
| `20260827003500` created_at immutable | trigger | ✅ BEFORE INSERT OR UPDATE 고정 |
| `20260827004000` rls target | RLS 4테이블 + policy(anon/authenticated) | ✅ 게스트 플레이 가능 |
| `20260827005000` realtime publication | alter publication | ✅ |

**BLOCKERS**
- **JP-BL-015 (OPEN, High)**: "JP 통합 마이그레이션 3종 작성 — 현 4종은 신규 프로젝트에 적용 불가". 백로그가 이 세트의 신규 프로젝트 적용성에 의문을 남기고 있다 → **배포 전 clean bootstrap 재검증 필요**
- **JP-BL-025/026 (OPEN)**: `rooms.status` enum 제약, `created_at` NOT NULL — 미적용
- **stale room 정리 전무** (§11) — 마이그레이션에 cron/TTL 없음
- **JP-PROD-GATE (Blocker)**: 무료 플랜 자동 일시정지 대상이면 외부 베타 불가

**배포는 승인 없이 하지 않았다.**

---

## 14. Realtime Validation Status — **OPEN (미검증)**

로컬 PostgreSQL/PostgREST 시뮬레이션은 **실제 Supabase Realtime 전달을 증명하지 않는다.** rc3 하니스도 전달을 *모델링*할 뿐이다.

### 최소 실 Tokyo 테스트 계획 (비파괴)

**전제**: 전용 테스트 방 코드(`ZZ__`) 사용, 기존 데이터 미조회·미변경, 종료 시 해당 방만 삭제.

| # | 검증 | 방법 |
|---|---|---|
| 1 | participant insert 전파 | 2개 클라이언트 구독 → insert → 수신 확인 |
| 2 | participant update 전파 | choice/is_ready 갱신 |
| 3 | room update 전파 | status 전이 |
| 4 | ready 전파 | 양방향 |
| 5 | 동시 선택 | 두 클라이언트 동시 write |
| 6 | 결과 발행 | publishHostRoundResult 상당 |
| 7 | nextRound | 4 write 후 전파 |
| 8 | 재접속 재조정 | 구독 해제→재구독→fetch |
| 9 | 지연 전파 | 수신 시각 분포 기록 |
| 10 | 중복 이벤트 | 동일 값 재write |
| 11 | 순서 역전 | 관측만(주입 불가) |

**인프라 변경 없이 가능한가**: 예. 기존 Tokyo 프로젝트에 **읽기·전용방 write**만 하는 Node 스크립트 2개면 된다. 프로젝트 생성·과금 변경 불필요.
**승인 필요**: Tokyo 프로덕션에 테스트 방 row를 만드는 것 자체가 production-impacting이므로 **CEO 승인 전 실행하지 않는다.**

---

## 15. CORE Issues Affecting KR + JP

| 이슈 | 영향 |
|---|---|
| **P1-1 `nextRound` 무음 0행** | KR·JP 공통. KR 프로덕션에도 동일 존재 |
| **P1-2 방 코드 엔트로피** | 생성 로직은 CORE. KR(QR)에서는 위험 낮음, JP(URL)에서 高 |
| stale room 정리 부재 | 공통. 서버측 정리 주체 없음 |
| H1-1 카운트다운 관측 | 측정 계층. 제품 영향 미확인 |

**CORE 수정 시 KR 호환 필수.** P1-2는 "생성 엔트로피 상향"(CORE) + "URL엔 별도 토큰"(JP)으로 분리하면 KR UX(4자 코드 구두 전달)를 깨지 않는다.

## 16. JP-Only Issues

- JP-BL-002 Kakao 경로 제거 / JP-BL-005 리전 매치메이킹 차단 / JP-BL-008·009 LIFF·LINE 로그인
- **1인 ready 방 잠금** — JP 초대 퍼널에서만 치명적(§9-1)
- host 부재 전용 상태 부재
- JP-BL-024 Tokyo Kakao provider 비활성화

## 17. Launch Blockers (JP 무료 게임 V1)

| # | 항목 | 분류 | 근거 |
|---|---|---|---|
| B1 | **1인 ready 방 잠금 해제 + 대기 화면 + host 부재 상태** | JP | §9·§10. 없으면 초대 퍼널이 성립하지 않는다 |
| B2 | **초대 토큰(≥128비트)** | CORE+JP | §7 P1-2 |
| B3 | **`nextRound` 무음 0행 방어** | CORE | §4 P1-1. W4 0행 = 전 기기 정지 |
| B4 | **실 Realtime 검증** | JP | §14 |
| B5 | **Tokyo 마이그레이션 clean bootstrap 재검증 + 배포 승인** | JP | §13 JP-BL-015 |
| B6 | stale room 정리 | CORE | §11 |
| B7 | LIFF 연동 | JP | HIKARI 자격 확인 후 |
| (참고) | 법무 게이트 4종 | — | HIKARI 담당, 본 리포트 범위 밖 |

## 18. Recommended Next Engineering Slice

**JP-BL-027-B — `nextRound` 무음 0행 방어 (CORE)**

이유: (a) 유일하게 **전 기기 정지**를 유발하는 프로덕션 결함, (b) 착수를 막던 하니스 한계가 §4대로 **해소되었다**, (c) LINE 작업과 독립적이라 HIKARI 대기 중에 진행 가능, (d) KR에도 즉시 이득.

수행 방식:
1. 4개 write에 `.select('id')` + 행수 검증 추가, 기존 `ZERO_ROW_WRITE` 계약 준수
2. W1은 **가변 행수**(방 인원)이므로 "≥1 이고 room_id 일치"로, W2/W3은 **정확히 집합 크기**, W4는 **정확히 1**
3. 검증은 **strict 모드 rc3**로 수행(legacy는 `.eq('room_id')`를 재현하지 못함 — §4 실증)
4. 단언·임계값 완화 금지. codex-critic 필수

**그 다음 슬라이스**: B1(대기/late-join) → B2(초대 토큰) → B4(실 Realtime).

## 19. Files Changed

이번 세션 신규: `tests/rc3-n2-remote-validation.test.mjs` (N=2 검증, 관측·분류 전용)
그 외 워킹트리 변경은 이전 세션 산출물(§2). **프로덕션 무변경.**

## 20. Tests Run

| 대상 | 결과 |
|---|---|
| **N=2 원격 검증(신규)** | **2/2 통과**, 144+36 trial, 24조합 전부 완주 |
| 전체 저장소 스위트(rc3 제외) | **81 파일 / 1414 통과, 1 skipped** |
| rc3 legacy | 63/63 GREEN (직전 세션 실측) |
| rc3 strict | 8 실패 / 55 통과, 하드게이트 87, 타임아웃 2 |

## 21. Commit / HEAD

`34583b4` — **커밋하지 않았다.** 모든 산출물이 워킹트리에 있다.

## 22. Decisions Required From CEO

1. **워킹트리 커밋 승인** — 3세션 분량 산출물이 미커밋 상태다. 유실 위험.
2. **다음 슬라이스 승인** — §18의 JP-BL-027-B 착수 여부.
3. **실 Tokyo Realtime 검증 승인** — 전용 테스트 방 row 생성 필요(§14).
4. **Tokyo 마이그레이션 배포 승인** — 단 JP-BL-015 재검증 선행(§13).
5. **JP에서 "1인 ready 방 잠금"을 해제할 것인가** — KR 동작을 바꾸지 않고 JP만 분기할지, CORE에서 "2인 미만이면 잠금 유예"로 통일할지(§10 B1).
6. **방 코드 정책** — KR 4자 코드를 유지하면서 JP는 별도 토큰으로 갈 것인지(§11 B2).
