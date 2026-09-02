# Build43 게임룰(단판/삼세판/다섯판) — 설계·구현 기록

브랜치 `dev/kr-build43-game-rule` (base = dev/kr-build42-ui-direction `60b6b81`). 스키마 변경 없음, Tokyo 무접촉.

## 사양(Vincent, 2026-08-31) → 해석
- **판** = 술래 확정(gameOver)까지의 한 게임(재대결 라운드 포함). 기존 "한번더" = 다음 판.
- 단판 winsNeeded=1 · 삼세판 2(기본 3판) · 다섯판 3(기본 5판). 기본 판수는 안내 개념이고 **종료 조건은 winsNeeded 도달** — 미달이면 충족될 때까지 계속(사양 문구 그대로).
- 최종술래 수 = 술래숫자(targetLoserCount): winsNeeded 도달자가 그 수만큼 나오면 매치 종료·최종술래 선언, 이후 '한번더' 없음(방 종료는 기존 나가기/호스트 방 닫기 흐름).
- 명시한 가정: ① 판별 술래 집계는 그 판의 확정 술래 전원(+1). ② 게임 룰은 1판 시작 전 잠금(매치 중 변경 불가). ③ "게임방 종료" = 추가 판 차단 + 최종 선언(자동 방 파괴는 하지 않음 — 파괴는 호스트 수동 그대로).

## 구현(모두 index.html, 판정·realtime 무변경)
- 순수 함수 블록(마커로 테스트 추출): `MATCH_RULES/normalizeMatchRule/matchWinsNeeded/matchRuleBaseGames/sanitizeMatchTally/applyMatchGameResult/computeMatchState`.
- envelope(rooms.penalty JSON): `matchRule`(항상), `matchTally`(판별 술래 횟수), `matchStats`(판 누계 승/무/패), `matchTalliedGameNo/matchStatsGameNo`(멱등 원장) — parsePenalty 관용 파싱, buildPenaltyValue carry-forward. 구버전 envelope → 기본 single(현행과 동일 동작).
- 호스트 권위 집계: `hostComposeMatchUpdate(continuation)` — continuation.mode==='FINAL'(그 판 술래 확정) 발행에서만, gameNo 원장으로 멱등 갱신. `updateRoomStatusScheduled` 가 결과 write 에 함께 싣는다(추가 write 없음).
- 게이트: `canShowPlayAgainButton()` = host && 술래확정 && **!isMatchComplete()** — 노출과 returnToLobbyAfterGame 하드블록이 같은 소스. `#verdictActionSlot.slot-final` 토글도 이 소스로 확장(매치 종료 호스트 1행).
- 최종 선언: gameOver 렌더에서 매치 종료 시 캡/제목/메시지를 최종술래 선언으로 덮는다(ko/en/ja 키 6종).
- **UI수정룰1**: 전적 카드 승/무/패 = `getMatchCumulativeStats()` (지난 판 누계 envelope.matchStats + 현재 판 진행분, matchStatsGameNo 로 이중 집계 방지).
- **UI수정룰2**: hostRoom `#loserCountBox` 를 2열 grid 로 바꾸고 같은 박스에 `게임 룰` select(`#matchRuleSelect`), lobby 에 `#lobbyMatchRuleBox`/`#lobbyMatchRuleSelect`. `onMatchRuleChange`(편집 게이트 `isMatchRuleEditable` = 1판 시작 전 && 집계 0) + `updateMatchRuleDropdown`(BLOCKER-001 피커 보호 규칙 동일).

## 테스트
- `tests/build43-match-rule.test.mjs` 18 tests — RED 18 → GREEN 18 (순수 함수 8, envelope/집계/게이트 5, UI·i18n 5).
- 기존 스위트 갱신: build30-phase-e(게이트 확장 핀 + 샌드박스 매치 스텁), build30-rc2(샌드박스에 실소스 매치 블록/스텁 주입), build41/42(slot-final 토글 소스 핀 확장). 카드 상단 룰 라벨은 SE 375 에서 카드 성장 → 플레이 계약 침범이 확인되어 넣지 않음(룰 노출 = 설정 박스 + 최종 선언).

## 남은 것(다음 게이트)
- 3기기 필드 QA 시나리오: 삼세판 2:1, 다섯판 조기 종료(3판 연속), 미달 연장(무한 지속 아님 확인 = winsNeeded 도달 시 종료), 매치 중 룰 잠금 토스트, 구버전(빌드41) 혼재 방.
- 재대결 대기(winnerWait/loserWait) 화면의 매치 스코어 노출은 미구현(카드 누계로 대체).

## EARLY LOCK 확장 (2026-08-31, IMPLEMENTATION LOCK 승인)
- 해석(§0 승인): qualification(1/2/3회)=확정 후보(active 유지) / earlyLock(1/3/5회)=즉시 확정+다음 판부터 제외. 종료 = distinct(locked ∪ qualified) ≥ targetTaggerCount, 그 순간 host 만 `matchFinalTaggerIds`(정확히 target 명; locked 우선 → qualified 도달 순, 동판 동률은 id 정렬 tie-break) 확정.
- 순수 판정: `computeMatchDecision()` (마커 블록, 결정적 매트릭스 17 tests — §20 시나리오 4종·overshoot·동률·최소 인원 §15 강제 종료·멱등).
- envelope 추가: `matchNo`(매치 세대, 신원 가드 `getMatchEnvelope()` — 더 새 matchNo 를 본 뒤의 stale envelope 무시), `matchLockedIds[]`, `matchQualifiedIds[]`, `matchFinalTaggerIds[]`. 참가자는 `matchFinalTaggerIds` 읽기만(§16·21, 독립 판정 금지).
- 판당 엔진 목표: `getTargetLoserCount()` = 비단판이면 locked+1(신규 술래 1명/판), 설정 원본은 `getConfiguredTaggerCount()` 로 분리(동기화 3곳·클램프·드롭다운·카드 표시 교체).
- 시드(§4, 제2 메커니즘 금지): `beginNewGameRound` 가 `state.confirmedLoserIds = matchLockedIds` + locked 행에 `__loser__` 마커(기존 재대결 마커 패턴) → `computePlayerStatuses` 단일 소스로 전 클라이언트 동일 제외. 참가자측 새 판 진입(handleRoomUpdate round=1 리셋)에도 동일 시드, locked 마커는 클리어에서 제외.
- tally 델타(승인): `hostComposeMatchUpdate` 가 `confirmedLoserIds − 시드된 locked` 만 +1 (`matchTalliedGameNo` 멱등 원장 유지), `computeMatchDecision` 으로 locked/qualified/final 을 host 권위로 기록. QA 이벤트 `MATCH_DECISION`.
- 한번더(승인): 매치 진행 중 = 다음 판(원장 유지) / 매치 종료 후 = **새 매치**(`matchReset` → matchNo+1, tally/stats/locked/qualified/final/원장 전부 생략=리셋, 방 설정·벌칙·룰·술래 수 유지). `canShowPlayAgainButton` 은 원형 복귀.
- UI(§19): 목록 배지 `🔒 최종 술래`(tag.matchLocked ×3 로케일). locked 는 시드로 loserWait(대기) 화면에서 관전.
- 무변경 보장: WINNERS/LOSERS/ALL/FINAL continuation·카운트다운·판정 알고리즘·DB 스키마·grants·auth·M1/M2.

## 동결 전 명시 계약 노트 (2026-08-31, FREEZE 승인 §2)
- **A. 정상 종료**: `matchFinalTaggerIds.length === targetTaggerCount` — locked 우선 → qualified 도달 순, 동판 동률 id 정렬로 정확히 target 명만 확정된다(overshoot 시 slice).
- **B. 비상 최소 인원 종료**: 참가자 이탈/활성 고갈로 설정 target 이 수학적으로 불가능해지면 엔진은 target 미만 인원으로 종료할 수 있다(`insufficientPlayers=true`). 이는 **명시적 안전 종료**이며 정상 매치 완료가 아니다.
- **exactly-once gameOver 커버리지**: Build43 결정적 매치 종료 테스트 + 기존 TAGGER_REPLAY_IDEMPOTENT 회귀의 결합으로 보증. realtime 에코 횟수를 직접 세는 신규 E2E 는 추가하지 않았음 → **필드 QA 시나리오 H** 로 실기기 검증한다.

## B43 필드 결함 수정 (2026-08-31): 호스트 QR 미생성 + 게임룰 단판 고정
- **증상**: 호스트 화면에서 QR 미생성, 게임룰 select 가 단판으로 고정(옵션 미채움).
- **근원 원인(단일)**: `parsePenalty` 의 레거시 문자열 fallback 분기(새 방은 `createRoom` 이 `state.penalty=""` 설정 → JSON.parse 실패 → 이 분기)만 Build43 매치 필드를 싣지 않았다. `renderAll` 의 `updateMatchRuleDropdown()` → `isMatchRuleEditable()` 의 `Object.keys(matchTally=undefined)` 가 TypeError → `showScreen→renderAll` 예외가 `showHostRoom` 첫 문장에서 전파되어 이후의 `renderQr()`/옵션 채움이 실행되지 않았다(결함 2개 = 원인 1개).
- **수정**: fallback 반환에 매치 필드 전체(빈 기본값) 추가 + `isMatchRuleEditable` 에 `|| {}` 방어.
- **검증**: RED 2건(fallback 형태·방어 가드) → GREEN; headless Chrome 재현 — H43 동결본은 동일 TypeError 재현, 수정본은 QR canvas 렌더·옵션 [single,best3,best5]·변경(best3)이 state/envelope/getMatchRule 에 전파, window error 0.
- **교훈**: envelope 필드 추가 시 parsePenalty 의 **세 번째(fallback) 분기까지** 같은 형태로 맞출 것 — 두 객체 분기만 고치면 새 방(빈 penalty)에서 즉사한다. 단위 테스트가 fallback 형태를 이제 고정한다.

## 확정 룰 모델 개정 (2026-08-31, Vincent 확정 지시 — Build45 후보)
Vincent 의 확정 지시가 종전 EARLY LOCK 계약의 이중 임계(자격 1/2/3 · 잠금 1/3/5)를 **단일 임계 즉시-확정 모델**로 대체한다.

- **규칙**: 누적 패배(판 단위 술래 횟수)가 단판 **1** / 삼세판 **2** / 다섯판 **3** 에 도달하는 **즉시** 그 참가자는 "술래확정" — 개인 화면에 `술래확정` 렌더, 이후 판에서 열외(대기 상태 확정). 구현은 `matchEarlyLockThreshold(rule) = matchQualificationThreshold(rule)` 한 줄 통일 — `computeMatchDecision`/envelope/시드/델타 경로는 전부 그대로 재사용(locked 만 남고 qualified-미잠금 상태는 사실상 소멸).
- **다중 참가자 예외**: 술래확정자 수가 호스트가 정한 술래 숫자에 미달이면 게임을 지속한다(먼저 도달한 순서대로 확정, 정확히 target 명). 동판 동시 도달 동률은 종전과 같이 id 정렬 tie-break. 최소 인원 강제 종료(insufficientPlayers) 규칙 유지.
- **UI 1 (카드 셀)**: "N 라운드" → `"{게임룰} · {n}판째"` (예: `삼세판 · 2판째`) 한 줄 고정 — `.game-progress-round` white-space:nowrap + `.game-progress-top` flex-wrap:nowrap. i18n `progress.matchGameNo` ×3 (`{n}판째` / `Game {n}` / `{n}戦目`). `progress.round` 키는 다른 화면(대기실 등) 호환을 위해 유지.
  - 단판 예외(§3 표): 판 수가 1로 고정이므로 카드 셀은 룰 라벨("단판")만 표기하고 "{n}판째"를 생략한다.
- **UI 2 (승/무/패)**: 2-A 안 확정 = 매치 누계(`getMatchCumulativeStats`) 그대로 — 코드 무변경.
- **UI 3-개인**: gameOver 패배 분기에서 내가 `matchLockedIds` 에 포함 + 매치 미완료면 cap/title/msg 를 `result.capTaggerLocked("술래확정!")` / `result.titleTaggerLocked("술래확정")` / `result.msgTaggerLocked` 로 교체(벌칙 박스·마루 이미지 유지). 매치 완료 시엔 기존 최종 선언 블록이 우선.
- **UI 3-팝업**: 술래확정자 수가 목표 도달(=`getMatchState().complete`) 시 `showTaggerPopup` 이 매치 최종 모드로 전환 — 제목 `popup.matchFinalTitle` = `"최종술래 {names}"`(finalTaggerIds 닉네임, textContent 로 안전 주입), 본문 `#taggerPopupMatchMsg`: 승자 `"축하합니다! 승리하셨습니다!"` / 패자 `"다음에 힘내세요!"` + 줄바꿈 `"벌칙 {penalty}"`. 비최종 판은 종전 팝업 동작 그대로(제목 원복 + matchMsg hidden).
- **테스트**: `tests/build43-early-lock.test.mjs` 전면 개정(즉시-확정 매트릭스 + UI 핀 + parsePenalty fallback 회귀 + [2-A] 무변경 핀) — RED 8 → GREEN. build43-match-rule 18/18 · build38/41/42/35 영향 스위트 85/85 유지.

## 전적 집계 개정 — 판-최종 승/패 (2026-09-01, Vincent 판정 렌더 지시 · Build46 후보)
종전 2-A(손내기별 w/d/l 매치 누계)를 대체한다.
- **표시**: 진행 중 게임 카드의 전적은 **승/패만** 렌더(무 셀 제거, 그리드 4→3열). i18n 키(progress.draw)는 다른 화면 호환 위해 유지.
- **집계 단위**: 손내기(라운드 내 재대결)가 아니라 **판의 최종 결과만** — 판 종료(FINAL) 시 그 판의 확정 패자(newlyConfirmed)는 패+1, 나머지 active 참가자는 승+1. 예: 3인·술래1 → 그 판 = 패1·승2.
- **누적**: 삼세판=3판(조기 종료 시 그 시점까지), 다섯판=5판 동일 방식으로 판별 결과 누적.
- **동결**: 술래확정(locked)된 참가자의 전적은 확정 시점에 동결 — 이후 판의 시드 마커는 승/패 어느 쪽도 늘리지 않는다.
- **갱신 시점**: 판 완료 시에만(host 멱등 원장 matchStatsGameNo) — 진행 중 손내기 live 카운터는 카드에 합산하지 않는다.
- envelope 형태(matchStats {w,d,l}) 유지: d 는 항상 0 (wire 호환, parsePenalty 3분기 무변경).
- **카드 술래칩 삭제(2026-09-01 추가 지시)**: 게임 진행 카드(검정 박스) 안의 붉은 "술래 {n}명" 셀(`.game-progress-stat.loser`, #ff2d55) 제거 — 카드 전적 그리드는 승/패 2열. 술래 수 노출은 준비 화면 상단 칩(`[data-tagger-chip]`)만 유지. 선택지 3칸 그리드(#screenGame .choice-buttons)는 무관·무변경.

## Build46 — 연속 매치 진행 모델 (2026-09-01 승인 계약)
Build45의 "GAME → 최종형 결과 → 호스트 재시작" 모델을 폐지한다. **호스트는 매치 시작을 1회만** 누른다.
- **자동 판 전환**: 미완료 판의 gameOver 에서 host 가 `scheduleMatchAutoNextGame(3s)` 로 다음 판을 자동 예약 — `beginNewGameRound({status:"ready"})` = 기존 `phaseScheduledAt/phaseKind:"ready"` 동기 기제 재사용(제2 전환 권위 금지, 대기실 왕복 금지). echo/재렌더는 타이머 덮어쓰기 + 콜백 재검증(gameRound/상태/미완료)으로 멱등. locked 시드·WAITING(판 내부 winnerWait/loserWait) 비차단은 기존 경로 그대로.
- **미완료 판 UI(§FINAL UI RULE)**: 허용 = 이번 판 승/패(titleGameWin/titleGameLose) + 누적 패배(msgGameLoseCumulative {n}/{th}) + 자동 진행 안내(midMatchNotice) + 술래확정자 대기 표기. 금지 = 최종술래 팝업(showTaggerPopup 미완료 가드)·벌칙 박스·한번더/승률/나가기 터미널 행(finalResultBtns 빈 값)·become-host 카운트다운.
- **한번더**: `canShowPlayAgainButton` = host+술래확정 + **매치 완료 게이트** — 완료 후 "새 매치(matchReset)" 전용. 단판(=1판 매치)·레거시/오프라인은 종전 동작(게이트 우회).
- **핀 갱신(문서화)**: build23/build30-phase-e/build43-match-rule 의 구 원형(one-liner) 핀 → 새 게이트 형상으로 교체(단일 진실 소스 isTaggerSelectionComplete 단언 유지). finishRoundLocal 3곳은 Build30 autoSave 인접 계약 유지를 위해 popup→autoSave→schedule 순서.
- **QA 이벤트**: `MATCH_AUTO_NEXT_SCHEDULED`(WRPS-B46).
- **추가 UI 지시**: 홈 → "바로전 게임결과"(screenStats)의 "같은 방에서 다시 하기"(statsReplayBtn/inviteForReplay 진입 버튼) 삭제 — 처음으로만 유지(replayBtn 참조 2곳은 기존 null-guard, inviteForReplay 함수는 build29 계약 보존 위해 잔존).
- **NO-TOUCH 게이트 보정(2026-09-01)**: 자동 판 전환을 `status:"ready"`(준비 정족수 areAllActivePlayersReady 의존 — 참가자 '준비' 탭 필요)에서 **`status:"playing"`+countdownStartAt 직행**(startGame 동일 계열)으로 교체. 판 사이 사용자 입력 0회: 참가자는 'playing' 수신 → runCountdownThenShowGame 자동 진입, host 는 begin 직후 enterPlayingStateFromRoomUpdate() 로컬 진입, locked 는 `__loser__` 마커 비참가. READY 는 판 내부(재대결 준비) 전용 상태로 남는다 — 판 간 경로에서 정족수/강제시작 완전 배제.

## 🔴→🟢 Build46 판정 인시던트 RECOVERY (2026-09-01, STAGE 2 승인 계약)
**근본원인(실서버 재현·확정)**: 종전 `getTargetLoserCount() = matchLockedIds.length + 1` — 판의 집계 순간
자라는 **매치 값**이 같은 판의 **종결 조건**에 소급 주입됨. tagger≥2 에서 잠금 발생 판(G2)의 FINAL 직후
host 자기 에코가 새 목표(2)로 그 판을 미완으로 재해석 → `nextRound()` 유령 재대결(round 2) → 오토픽
패배가 tally 에 무기록(멱등 원장) → 확정 목록 오염. Build43 잠재 결함을 Build46 자동 연속이 노출.
**수리(불변 계약)**:
- `getRequiredMatchTaggerCount()` = 설정값 — **매치 종료 판정 전용**(판 종결 조건 사용 금지).
- `getGameResolutionTarget()` = 단판이면 설정값, 비단판이면 **판 시작 시드('__loser__' 행 수) + 1** —
  시드는 판 시작에만 기록되고 판 중 불변이므로 "판 시작 시점 고정" 계약이 신규 상태 없이 성립.
  matchLockedIds 는 판 종결 목표에서 **절대 읽지 않는다**.
- `getTargetLoserCount()` = getGameResolutionTarget 위임(§6 감사: 22개 호출부 전부 게임-판정 분류,
  매치측은 전부 configured/required 경유 — 모호 사용 0).
- **원장 최종성 가드** `isCurrentGameTallied()`(matchTalliedGameNo === 현재 판): `nextRound()` gameOver
  가드와 `scheduleRematchAutoAdvance` 콜백에 하드 단락 — 집계된 판은 에코/지연/예약 어떤 경로로도
  재대결·재집계 불가(목표 불변과 별개의 이중 방어, 둘 다 필수).
**검증**: RECOVERY 테스트 7 RED→GREEN + §5 정본(tagger=2 G2 에코) 결정론 + §8 매트릭스(best3/5 × req1/2
완료 정확히 1회). **라이브 Seoul**: best3·tagger2 — G2 유령 round2/오토픽/패 유실 소멸, B 열외, H 2패에서만
MATCH_FINAL(run-t2-fixed.json); best5·tagger2 동일 클린(run-b5t2.json). before 증적 run-t2b.json.

## 🔴→🟢 FIELD RACE #3 — playing-phase penalty writer 의 원장 덮어쓰기 (2026-09-01)
**필드 증상**: 삼세판/다섯판에서 승/패 누적이 쌓이지 않아 매치 무한 반복.
**근본원인(라이브 유기 재현 run-alt.json G2 + 코드 의미론 확정)**: `publishChoiceWindowEnd`(선택창 시각)와
`republishCountdownStartAsHost`(카운트다운 재발행)가 ① 사전 빌드한 pre-FINAL penalty 스냅샷을
② 무조건(penalty-only)으로 DB에 쓰고 ③ 성공 시 host 로컬 state.penalty 까지 그 구본으로 되돌렸다.
FINAL write(tally 병합·matchTalliedGameNo·continuation)와 착지 순서가 뒤집히면(실기기 RTT/지터에서 상시)
그 판의 원장이 DB·로컬 양쪽에서 증발 — 임계 도달 불가. Build30-R2 잠재 → 매치 원장(B43)+자동 연속(B46)으로 치명화.
**수리(§I 단일 질서 정합)**: 두 writer 모두 — `.eq('status','playing')` 조건부 쓰기(선택창/카운트다운 시각은
playing 에서만 의미) + `.select('id')` 적용 행 확인 후에만 로컬 반영(0행 = 레이스 패배 → 명시적 no-op +
QA `…_SKIPPED_STALE`). 오프라인은 종전 로컬 동작 유지.
**검증**: RED 3→GREEN(조건부 소스 핀 2 + 기능 no-op 샌드박스) · 교대 패자 라이브 5회 연속 클린 ·
정본 t2 클린 유지. 잔여: 유기 레이스 재현률이 낮아(랩 12회 중 1회) 물리 필드 QA 가 최종 확증 지점.
- **UI 지시 반영**: 내기록(accountStatsPopup)의 "계정 삭제" 버튼 제거(닫기만 유지 — deleteAccountWithConfirm 함수는 존치).

## Build47 — 물리 QA 3-결함 교정 (2026-09-02, SCOPE LOCK)
증거: Drive RPS-KR-QA qa-report-build46-r2(방 Y12R) + IMG_0117/IMG_0109.
- **D1(P0, 무한 매치)**: Y12R G1~9 재구성 — 물리 패자 H,H,P,P,H,H,P,H,P 인데 MATCH_DECISION 이 매 판
  newly=[그 판 패자]/locked=[]/qual=[]/complete=false, **첫 발산 = G2(H 물리누적 2)**. 매 판 시작의
  `PENALTY_MERGE_PRESERVED site=publishChoiceWindowEnd` + G1/G5 이중 FINAL = **FIELD RACE #3 필드 발현 확정**
  (가설 G 채택, A~F 기각). 코드 수정은 기수리(a22724d)로 종결 — 본 빌드에서 ①Y12R 결정론 재현+무한 매치
  감지 회귀(물리누적≥임계인데 미확정이면 즉시 FAIL) ②MATCH_DECISION 계측 자족화(cumulativeLossTally/
  matchTalliedGameNo(Prev)/configuredLossThreshold/requiredTaggerCount/newlyConfirmedTaggerIds/gameTallied) 추가.
- **D2(내부 재대결 참가자 READY 제거)**: 준비 컨텍스트 2종 분리 — 초기 매치 시작(round 1)의 '게임 준비'만
  유지. round>1(ALL/LOSERS/WINNERS 재대결)은 `isInternalRematchReadyPhase()` 단일 진실 소스로 참가자
  myReadyBtn 전면 숨김 + `markReady()` no-op(READY_TAP_IGNORED_REMATCH 계측) + 호스트 '강제 시작'이
  정족수 무관 단독 제어(`canShowForceStartReplayButton` 에서 areAllActivePlayersReady 제거) + 가이드 카피
  (host=forceStartRematch, guest=waitHost). 판→판 자동 연속(playing 직행)은 무변경 — 두 메커니즘 구분 유지.
  라이브 검증: 강제시작 단독으로 재대결 2회 진행·정상 종료.
- **D3(조기 '술래 확정' 카피)**: IMG_0117 실물 = `titleLoserConfirmedCount("술래 확정! (n/m명)")` 오노출.
  3-상태 의미론 — STATE A: **비단판 매치의 판 패배는 룰 자체로 분기**해 확정 카피 원천 불가(이번 판 패배 +
  누적 n/th + 자동 진행 안내), 확정 카피는 단판 전용. STATE B: 실제 잠금 전이당 정확히 1회
    재접속/재시작은 GATE2 관측기(`observeMatchLockedTransitions` — envelope 채택 3지점에서 기존 잠금을 기저선 시드)로 재확정을 재생성하지 않음). STATE C: MATCH_FINAL 에서만 최종 팝업/벌칙/한번더(기존 유지).
- 구계약 핀 갱신(문서화): build27(정족수 시 미노출→노출), build30-ready-force-start(토글 가드형·신정의).

- **GATE2(2026-09-02)**: 확정 전이는 세션 내 관측(NOT_CONFIRMED→CONFIRMED)에서만 — 재접속/앱재시작/에코/폴링/재렌더는 확정 이벤트를 재생성할 수 없다(기저선 시드 + 1회성 원장, 결정적 회귀 4종).

## Build47 Codex recovery contract (2026-09-02)

- `matchStats[playerId] = {wins, losses}` is the only mutable cumulative MATCH ledger. Score-card
  rendering and threshold/decision logic both read this object. The retained `matchTally` field is a
  wire-compatibility projection derived by `deriveMatchLossTally()`; it is never incremented independently.
- Legacy rooms containing only `matchTally` migrate it into canonical losses once. When canonical stats
  exist, legacy values cannot override them. FINAL writes use a status+penalty compare-and-swap, verify
  the returned row, and rebase once only while the authoritative room remains in the same phase.
- GAME ordinal voice is keyed by `(roomCode, matchNo, gameRound)` and only runs for internal round 1.
  Realtime echoes, rerenders and reconnects therefore cannot replay it, and internal rematches cannot
  advance it.
- Compact gameplay layout keeps `env(safe-area-inset-top)` while reducing the extra top margin and
  allocating the recovered height to choice/result visuals.
- The account-delete control removed by the unrelated FIELD RACE #3 change is restored to its exact
  pre-`a22724d` markup and existing handler.
