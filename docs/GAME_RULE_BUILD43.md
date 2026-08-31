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
