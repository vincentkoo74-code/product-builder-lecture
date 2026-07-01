# BUILD16 QA PLAN — Device QA Issue Triage + WES Root Cause Sprint

> 생성 2026-07-01. 빈센트 실기기 QA(Build15 계측 빌드 이전 관찰) → WES Engineering Record 승격.
> **절대 원칙: 이 문서는 Triage/분석/범위확정까지. 코드 수정은 범위 승인 후 별도 진행. 추측 수정·임시 patch 금지.**
> Evidence: 코드 index.html(단일 파일) + docs/history WES 문서. 조사 근거는 각 이슈의 Evidence 행 참조.

기존 최대 formal WRPS = **048**. WRPS-049 = v2 엔진 에픽. 신규 계열은 사용자 지정 라인(050~057) + 058~ 채번.
기존 DR 최대 = **DR-12**. 신규 DR 후보 = DR-13~18(제안, Fix 반영 시 확정).

---

## 1. 등록된 WRPS 이슈 (전체)

### A. 게임 진행/흐름
| ID | 제목 | Sev | ZeroDoubt | Regression | Build16 | Evidence |
|----|------|-----|-----------|-----------|---------|----------|
| WRPS-058 | 선택 5초 타이머 시작/종료 시점 기기차 | Critical | ✅ | WRPS-036/047 재발후보 | 계측확정후 | countdown=서버 startAt+lead(DR-1), 실기기 drift 미계측 → build15 메트릭 필요 |
| WRPS-059 | 결과 화면 전환 시점 기기차 | Critical | ✅ | WRPS-036 계열 | 계측확정후 | 결과 전환은 finishRoundLocal(6675~), 전환 타이밍 계측 필요 |
| WRPS-060 | 6라운드 이후 화면전환/결과 지연 급증 | Critical | ✅ | 신규 | 계측확정후 | 원인 미상(폴링 누적/DB 라운드 누적 의심) → resultDrift/latency 계측 필수 |
| WRPS-062 | 다중 술래 판정 오류 + 전체 재게임 오전환 | Critical | ✅ | WRPS-043 재발후보 | ✅ | tooMany/tooFew=status"playing"유지+auto-advance(6788~6803), insufficient-active=전원loser+game_over(6747~6758) |

### B. UX/Audio/Haptic
| ID | 제목 | Sev | ZeroDoubt | Regression | Build16 | Evidence |
|----|------|-----|-----------|-----------|---------|----------|
| WRPS-051 | Countdown "가위바위보" voice clip 매핑 (go=SILENT) | High | ⚠️ | 신규(정책) | ✅ | go 클립 SILENT(8686-94), intro만 전체구문. en/ja 무음(설계) |
| WRPS-052 | Audio 커버리지/상태머신 (local trigger 혼재) | High | ✅ | WRPS-046 계열 | ✅ | 전 오디오 LOCAL per-device 호출, dedup 일부만(voice eventId 8801, sfx round-key 6657) |
| WRPS-055 | Join/Leave meow 일부 기기만 재생 | Critical | ✅ | 신규 | ✅ | fetchParticipants() 로컬 diff에서 재생(5282-83) → 기기별 관측차 |
| WRPS-057 | Button Sound/Haptic 랜덤 누락·미구현 | High | ❌ | WRPS-048 계열 | ✅ | pointerdown 전역 synth(8979-86), 45ms throttle, choice/게임버튼 skip, haptic 없음 |
| WRPS-069 | 승/패/무 효과음 품질 부족 | Medium | ❌ | 신규 | ❌(polish) | synth 톤(8915~), 클립 교체 미정 |

### C. Room/Lobby/Restart/Record
| ID | 제목 | Sev | ZeroDoubt | Regression | Build16 | Evidence |
|----|------|-----|-----------|-----------|---------|----------|
| WRPS-053 | 대기/탈락 참가자에 재게임/게임준비 버튼 노출 | Critical | ✅ | WRPS-029 계열 | ✅ | screenLobby lobbyReadyBtn 전원노출(9944-50), markReadyFromLobby() 상태게이트 없음(9977) |
| WRPS-054 | Restart/재초대 일부만 수신·room/round/record 섞임 | Critical | ✅ | WRPS-025 계열 | ✅ | 초대=reinviting+각 기기 로컬 getRecentRoomCodes 폴링(7595~7607, 권위push 아님) |
| WRPS-056 | 참가자 수 변동 시 room code/round/record reset 미작동 + 1인 방 미폭파 | Critical | ✅ | WRPS-025 계열 | ✅ | beginNewGameRound round=1+gameRound++(4854-60) but roomCode 불변, record roomCode별 누적(4680); 1인 destroy 로직 없음 |
| WRPS-061 | 참가자 이탈 시 결과화면 고착 + 참가자 리스트 stale | Critical | ✅ | WRPS-044/026 계열 | ✅ | 고착복구는 screenParticipantWait만(5303), 결과화면 미커버; stale cleanup 45s(4961) |
| WRPS-065 | QR 코드가 벌칙 설정 후에도 잔존 | High | ❌ | 신규 | ✅ | 벌칙설정 전이에서 QR DOM 미제거(추정, 렌더경로 확인필요) |
| WRPS-067 | 직전 게임 결과 미노출 | High | ❌ | WRPS-024 재발후보 | ✅ | archiveCurrentRoundStats/buildRoomStatsSummary(4666~4734) 홈 표시 경로 확인필요 |
| WRPS-068 | 내기록 닫기 버튼 문구 불일치 | Low | ❌ | WRPS-030/034 계열 | ✅(경미) | i18n 문구 정리 |

### D. Login/Profile
| ID | 제목 | Sev | ZeroDoubt | Regression | Build16 | Evidence |
|----|------|-----|-----------|-----------|---------|----------|
| WRPS-050 | 로그인 후 게임화면 자동복귀 실패 | High | ⚠️ | 신규 | ✅ | OAuth return이 discardInProgressRoomSession()로 진행세션 clear→홈(9797~9811); room param만 보존 |
| WRPS-066 | 닉네임 정책/변경 UI (최초등록 후 유지 + 내기록 변경버튼) | High | ❌ | 신규(정책) | ✅ | 닉네임 변경 UI 위치 미정, 정책 미정의 |

### E. UI/Layout/Viewport
| ID | 제목 | Sev | ZeroDoubt | Regression | Build16 | Evidence |
|----|------|-----|-----------|-----------|---------|----------|
| WRPS-063 | 화면 확대/축소/상하좌우 이동 발생 (viewport 미잠금) | Critical | ✅ | 신규 | ✅ | meta viewport(line5)에 user-scalable=no/maximum-scale 없음, touch-action/overscroll 없음 |
| WRPS-070 | 가위바위보 텍스트/애니메이션 요소 부재 | Medium | ❌ | 신규 | ❌(polish) | 애니메이션 미구현 |
| WRPS-071 | 화면 공백/QR 크기/버튼 촉감 polish | Medium | ❌ | 신규 | ❌(polish) | 레이아웃 미세조정 |

### F. Zero Doubt / 신뢰성 (umbrella)
| ID | 제목 | Sev | ZeroDoubt | Regression | Build16 | Evidence |
|----|------|-----|-----------|-----------|---------|----------|
| WRPS-064 | 선택/판정/결과 동기화가 사용자 신뢰를 해치는 수준 (집합 지표) | Critical | ✅ | WRPS-026/036 계열 | 계측+개별Fix | WRPS-058/059/060/055/056/061 집합. build15 계측으로 정량화 → Release Gate |

**신규 등록 22건** (Critical 10, High 6, Medium 3, Low 1, umbrella 1은 Critical 포함).

---

## 2. Severity 분류 요약
- **Critical (10)**: 058, 059, 060, 062, 055, 053, 054, 056, 061, 063 (+umbrella 064)
- **High (6)**: 051, 052, 057, 065, 067, 050, 066 → (7건, 067/050/066/065/051/052/057)
- **Medium (3)**: 069, 070, 071
- **Low (1)**: 068

---

## 3. Regression 분류
| 분류 | 이슈 |
|------|------|
| **신규 버그** | 055(join/leave audio), 060(6라운드 지연), 063(viewport), 050(oauth restore), 065(QR), 066(닉네임정책) |
| **과거 수정 재발 후보** | 062↔WRPS-043(다중술래), 058↔WRPS-047/036(카운트다운), 067↔WRPS-024(직전결과), 061↔WRPS-044(stale) |
| **기존 이슈 변형** | 053↔WRPS-029(호스트 게임준비 표시), 054/056↔WRPS-025(방 상태 잔류), 059↔WRPS-036, 052/051/057↔WRPS-045/046/048(오디오 계열), 068↔WRPS-030/034 |
| **설계 정책 미정의** | 056(participant-change=새 세션 정책), 053(대기/탈락 UI 권한 정책), 051(voice 커버리지 정책), 066(닉네임 정책), 064(Zero Doubt 게이트) |

---

## 4. 5 Whys — Root Cause (Evidence 확정 Critical)

**WRPS-055 join/leave meow 일부 기기만**
- W1 사용자: 어떤 기기에선 입장음이 안 남 · W2 상태: 오디오가 authoritative 이벤트가 아니라 각 기기의 fetchParticipants 로컬 diff에서 파생 · W3 테스트: 로컬 diff는 단위테스트로 재현 불가, 계측 없음 · W4 아키텍처: audio가 event-bus가 아닌 per-device local trigger(관측 타이밍/구독 상태에 의존) · **W5 Root Cause: 참가자 lifecycle side-effect(오디오/리스트)가 authoritative 이벤트 소스가 아닌 per-device local diff에서 발생 → 커버리지가 기기 관측에 좌우됨.**

**WRPS-056 참가자 변동 room/record reset 미작동 + 1인 방**
- W1 사용자: 사람 바뀌었는데 방코드/기록이 그대로/섞임 · W2 상태: beginNewGameRound가 round=1·gameRound++ 하지만 roomCode 불변, record는 roomCode 키로 누적 · W3 테스트: room lifecycle 상태전이 테스트 없음 · W4 아키텍처: room lifecycle이 "참가자 집합 변경 = 새 game session" 개념을 갖지 않음(gameRound 증가만) · **W5 Root Cause: participant-set 변경이 새 세션 경계를 만들지 않음 — session id/record 분리·1인 방 destroy 정책 부재.**

**WRPS-053 대기/탈락자 버튼 노출**
- W1 사용자: 탈락했는데 게임준비 버튼 보임 · W2 상태: screenLobby lobbyReadyBtn이 참가상태 무관 전원 렌더 · W3 테스트: UI 권한 상태 테스트 없음 · W4 아키텍처: ready 버튼 가시성이 round participation state와 분리(screenReady는 게이팅, screenLobby는 미게이팅) · **W5 Root Cause: player의 UI 권한이 round state와 일관되게 결합되지 않음(화면별 게이팅 불일치).**

**WRPS-054 restart 초대 일부만·room 섞임**
- W1 사용자: 초대장이 일부에게만 · W2 상태: 초대는 room status=reinviting을 각 기기가 로컬 recentRoomCodes 폴링으로 발견 · W3 테스트: 재초대 전달 테스트 없음 · W4 아키텍처: 초대 발견이 authoritative push가 아닌 per-device best-effort 폴링(localStorage 의존) · **W5 Root Cause: restart invite가 권위 이벤트가 아니라 기기별 폴링/로컬 히스토리 발견 → 전달 비결정적.**

**WRPS-062 다중 술래 오전환**
- W1 사용자: 다중 술래인데 전체 재게임됨 · W2 상태: insufficient-active 시 전원 loser+game_over, tooMany/tooFew는 playing 유지+auto-advance · W3 테스트: multi-loser 분기 회귀테스트 부분만 · W4 아키텍처: 4개 outcome이 단일 result 화면·미묘한 status 전이 공유 · **W5 Root Cause: multi-loser outcome 분류/전이가 명시적 상태로 분리되지 않아 경계 케이스에서 오분류(전체 재게임 오전환) 가능.**

**WRPS-063 viewport zoom/pan**
- W1 사용자: 화면이 확대/이동됨 · W2 상태: meta viewport에 스케일 잠금 없음 · W3 테스트: viewport 검증 없음 · W4 아키텍처: 게임 신뢰를 위한 viewport lock 정책 부재 · **W5 Root Cause: 앱 viewport가 잠기지 않음(user-scalable/maximum-scale/touch-action 미설정).**

**WRPS-050 OAuth 복귀 미복원**
- W1 사용자: 로그인 후 게임 안 돌아옴 · W2 상태: post-OAuth에서 discardInProgressRoomSession()이 진행세션 clear · W3 테스트: auth return 컨텍스트 복원 테스트 없음 · W4 아키텍처: OAuth 복귀가 "정확 복원 or 명시 실패" 계약 없이 홈 착지 · **W5 Root Cause: OAuth return이 game context를 복원하지 않고 세션을 폐기 → 복귀 계약 미정의.**

**WRPS-061 결과화면 고착 + stale**
- W1 사용자: 남이 나가니 내 화면이 결과에 갇힘 · W2 상태: 고착복구가 screenParticipantWait만 커버, 결과화면 미커버; stale 45s · W3 테스트: 이탈 시 화면 advance 테스트 없음 · W4 아키텍처: 화면 advance가 참가자 이벤트에 의해 보장되지 않음 · **W5 Root Cause: 참가자 이탈이 남은 기기의 화면 advance/리스트 갱신을 authoritative하게 트리거하지 않음(백스톱 부재).**

**WRPS-058/059/060 (sync drift)**: 코드상 서버 startAt 기반(DR-1) 확인되나 실기기 drift 정량 Evidence 없음 → **build15 계측 데이터 수집 전 Root Cause 확정 금지(DR-10)**. 5 Whys W5 = "정량 Evidence 미수집" → 계측 우선.

---

## 5. Root Cause 목록 (구조 원인)
1. **참가자 lifecycle side-effect가 local-diff 파생**(오디오·리스트) — WRPS-055/052/061
2. **participant-set 변경이 새 session 경계를 만들지 않음** — WRPS-056
3. **restart invite가 권위 이벤트가 아닌 per-device 폴링** — WRPS-054
4. **player UI 권한이 round state와 화면별로 불일치** — WRPS-053
5. **multi-loser outcome이 명시 상태로 분리되지 않음** — WRPS-062
6. **viewport 미잠금** — WRPS-063
7. **OAuth return 복원 계약 미정의** — WRPS-050
8. **sync drift 정량 Evidence 미수집(계측 우선)** — WRPS-058/059/060/064

---

## 6. Architecture Review (원칙 위반 점검)
| 원칙 | 관련 이슈 | 위반/정합 |
|------|-----------|----------|
| Server Authoritative | 054, 055, 061 | 현재 local-diff/폴링이 권위 부재 → Fix는 권위 이벤트 방향(위반 해소) |
| Event Sourcing / Ordering | 052, 055 | 오디오 local trigger → event-driven 지향 |
| Replay / ClockSync / Shadow | 058, 059, 060 | 계측으로 검증(코드 무변경, Evidence 우선) |
| Client Zero Game Logic | 062 | 판정은 순수 resolveElimination 유지, 클라 로컬 판정 추가 금지 |
| No Hybrid State | 053, 056 | UI 권한/세션 경계를 단일 상태로 정리 |
| Audio Event Only | 051, 052, 055, 057 | 이벤트 커버리지+dedup+metric 표준화 |
| Room Lifecycle State Machine | 054, 056, 061 | 참가자 변경=새 세션, 1인 destroy 상태전이 도입 |
| Zero Doubt | 064 | 위 전부의 집합 게이트 |
> **금지 해결책**: 클라 로컬 판정, 기기별 hardcode, legacy fallback 은폐, QA metric만 PASS시키는 수정 — 채택 안 함.

---

## 7. Build16 적용 범위 (확정 제안)

### ✅ Build16 포함 (신뢰성/공정성/상태동기화 — Release Gate 영향)
1. **QA Platform** (Build16 base: 완료 — export/report/manifest)
2. **WRPS-056** Room lifecycle: participant-set 변경=새 session(session id+round reset+record 분리), 1인 방 destroy+home
3. **WRPS-053** 대기/탈락 UI 권한: lobby ready/replay 버튼 상태 게이팅 통일
4. **WRPS-054** Restart invite 일괄 전달(권위 기반)+재입장 새 session
5. **WRPS-062** Multi-loser outcome 상태 분리(전체 재게임 오전환 제거)
6. **WRPS-052/055/051/057** Audio 이벤트 커버리지(join/leave/ready/countdown/result/button)+eventId dedup+missing/dup metric
7. **WRPS-063** Viewport lock
8. **WRPS-050** OAuth return: game context 복원 or 명시 실패
9. **WRPS-066** 닉네임 정책(최초 등록 후 유지 + 내기록 변경 버튼)
10. **WRPS-061** 이탈 시 결과화면 advance 백스톱 + stale 제거
11. **WRPS-065** QR 벌칙설정 후 제거, **WRPS-067** 직전 결과 노출, **WRPS-068** 문구(경미, 저비용 동반)

### 🔬 Evidence-gated (build15 계측 수집 후 판단 — 지금 추측 수정 금지)
- **WRPS-058/059/060/064** sync drift/지연: build15(자동 QA) 실기기 데이터 → qa-report → Root Cause 확정 후 별도 처리

### ⏸ Build16 제외 (polish, non-gate)
- **WRPS-069** 효과음 품질, **WRPS-070** 애니메이션, **WRPS-071** UI polish

---

## 8. Design Rule 후보 (제안 — Fix 반영 시 확정)
- **DR-13**: 참가자 lifecycle side-effect(입퇴장 오디오/리스트)는 per-device local diff가 아니라 authoritative 이벤트에서 파생한다. (WRPS-055/052/061)
- **DR-14**: Room participant set 변경은 새 game session을 생성한다(session id·round reset·record 분리). (WRPS-056)
- **DR-15**: 대기/탈락(waiting/disqualified) player는 다음 유효 라운드까지 UI-passive(버튼 비노출/비활성). (WRPS-053)
- **DR-16**: 오디오는 모든 기기에서 event-covered·deduped·metric-visible 해야 한다. (WRPS-051/052/055/057)
- **DR-17**: 게임 신뢰를 위해 앱 viewport를 잠근다. (WRPS-063)
- **DR-18**: OAuth return은 정확한 game context를 복원하거나 명시적으로 실패한다. (WRPS-050)

---

## 9. 수정 순서 제안 (Root Cause 단위, 저위험·고확신 우선)
1. WRPS-063 viewport (1줄, 최고 확신·최저 위험) + regression(viewport 검증)
2. WRPS-053 UI 권한 게이팅 (렌더 게이트 통일) + test
3. WRPS-056 room lifecycle 상태머신 (핵심, 신중) + test
4. WRPS-061 이탈 백스톱 + WRPS-054 invite 권위화 + test
5. WRPS-062 multi-loser 상태 분리 + test
6. WRPS-052/055/051/057 audio 커버리지+dedup+metric + test
7. WRPS-050 oauth restore, WRPS-066 닉네임, WRPS-065/067/068 동반 + test
> 각 단계: Root Cause 단위 수정 → regression test 추가 → npm test → 다음. codex-critic 검증 후 orchestrator 승인.

---

## 10. 미결/리스크
- WRPS-058/059/060: 실기기 계측 데이터 없이 수정 시 DR-10 위반(추측). build15 QA 데이터 선행 필수.
- WRPS-065/067: 렌더 경로 추가 Evidence 필요(코드 정독).
- room lifecycle(056) 변경은 광범위 — 회귀 위험 최고, 테스트 커버리지 선행 필요.

## 11. Release Gate (현재)
- Critical open 10 + Evidence-gated 4 → **NOT READY**. Build16 신뢰성 Fix + build15 계측 PASS 후 재평가.
