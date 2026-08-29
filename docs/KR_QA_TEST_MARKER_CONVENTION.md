# KR-QA-TEST-MARKER-CONVENTION

**테스트가 소스의 부수적 형식에 의존하지 않게 한다.**

등록: 2026-08-29 (Build39 계측 작업 중 누적 6파일이 같은 이유로 깨진 뒤)

---

## 왜 만들었나

Build39 한 사이클에서 **소스 결합 취약성으로 6개 테스트 파일이 깨졌다.** 어느 것도 제품 결함이 아니었다 — 전부 **부수적 문자열을 계약으로 굳힌** 탓이다.

| 유형 | 깨진 파일 | 무엇이 계약이 아니었나 |
|---|---|---|
| 클래스 목록을 마커에 포함 | `build29-rematch-advance-resilience` | `<section class="card maru-card hidden" id="screenRoundResult">` — CSS 클래스 하나 추가로 깨짐 |
| 시그니처를 마커에 포함 | `rc3-harness-support`, `build37-a7`, `host-transfer-stage1`, `waiting-state-stage2a` | `function scheduleFetchParticipants(roomCode, delayMs = 80) {` — 로깅용 인자 추가로 4개 동시 붕괴 |
| 인접/길이 제한 정규식 | `build29-render-unblock`, `build22-critical-sync-safety` | "다음 줄이 바로 X여야" / "700자 안에" — 계측 한 줄 삽입으로 깨짐 |

각 테스트가 **실제로 지키려던 계약**은 그대로 유효했다. 깨진 것은 결합 방식뿐이다.

---

## 규칙

### A. 런타임 의미 단언을 우선한다

소스 문자열보다 **동작**을 본다:

- DOM 결과 (요소 존재, geometry, 가시성)
- 상태 전이
- 방출된 QA metric
- 함수 반환값 / 호출 여부

```js
// ❌ 소스에 문자열이 있는가
expect(html).toContain('loserBox.classList.toggle("hidden"');

// ✅ 실제로 그렇게 동작하는가
const { rows } = await runRenderLobby({ role: 'participant' });
expect(rows.loserFlow.total).toBe(0);
```

### B. 소스 추출이 필요하면 명시적·유일한 마커를 쓴다

식별자까지만 잡는다. 인자·클래스·공백은 넣지 않는다.

```js
// ❌
extractBlock('function scheduleFetchParticipants(roomCode, delayMs = 80) {', ...)
extractBlock('<section class="card maru-card hidden" id="screenRoundResult">', ...)

// ✅
extractBlock('function scheduleFetchParticipants(roomCode', ...)
extractBlock('id="screenRoundResult"', ...)
```

### C. 마커 개수는 정확히 1이어야 한다

```js
function extractBlock(start, end, label) {
  const n = html.split(start).length - 1;
  if (n !== 1) throw new Error(`[${label}] 마커 ${n}건 — 정확히 1건이어야 한다: ${start}`);
  ...
}
```

0건이면 마커가 깨진 것이고, 2건 이상이면 **엉뚱한 블록을 잡는다.** 실제로 Build38에서
`</div>\n<div class="c-body">`가 16곳에 있어 mutation이 다른 화면에 들어간 사고가 있었다.

### D. 쓰지 않는다

- 함수 시그니처 전체 매칭
- 임의의 문자 길이 창 (`[\s\S]{0,700}`) — 계약이 "N자 안"인 경우는 없다
- 인접 가정 ("바로 다음 줄이 X")
- `className` 문자열 전체 일치
- 공백/들여쓰기 민감 매칭

**순서**가 계약이면 순서만 고정한다:

```js
// ❌ 인접 강제
/setInterval\(async \(\) => \{\s*\n\s*const \{ data: room \} = await/

// ✅ 순서만 고정, 사이 줄 허용
/setInterval\(async \(\) => \{[\s\S]{0,400}?const \{ data: room \} = await[\s\S]*?await fetchParticipants\(/
```

### E. DOM은 필요한 id/class를 개별로 단언한다

```js
// ❌
expect(section).toContain('class="card maru-card card-flush-bottom hidden"');

// ✅
expect(section.classList.contains('card-flush-bottom')).toBe(true);
expect(section.classList.contains('maru-card')).toBe(true);
```

### F. 계측 삽입에 견뎌야 한다

QA metric 호출이 **추가되어도** 테스트는 유효해야 한다. 계측은 앞으로도 계속 늘어난다.

추출본에서 실행하는 테스트는 새 헬퍼가 스코프에 없을 수 있다. 프로덕션 쪽은
`typeof` 가드를 쓰는 것이 이 리포의 관례다 (`index.html`의 `rearmHostProgressionAuthority`,
`qaRoundCtx`, `qaNextTraceId`):

```js
if (typeof qaObserveCountdownStartAt === "function") qaObserveCountdownStartAt(value, source);
```

**중요**: `try { QA.emit(...) } catch {}` 안에서 헬퍼가 던지면 그 catch가 **이벤트 전체를 삼킨다.**
Build39에서 실제로 기존 `TAGGER_SNAPSHOT_STALE` metric이 이 방식으로 사라졌다. 컨텍스트를
못 얻어도 이벤트 자체는 나가야 한다:

```js
Object.assign({ ... }, (typeof qaRoundCtx === "function" ? qaRoundCtx() : {}))
```

### G. 기존 취약 테스트는 필요할 때만 손댄다

깨진 것만 고친다. **행동 단언은 절대 약화하지 않는다** — 결합만 좁힌다.
"통과시키기 위해" 임계값을 낮추거나 단언을 지우는 것은 금지다.

### H. 모든 소스 추출 테스트에 공허성 가드를 넣는다

추출이 빗나가면 단언이 **조용히 통과**한다. 실측 사례가 여럿 있다:

- 카드에 `hidden`이 붙어 있어 높이가 항상 0 → "얇아졌다" 단언이 공허 통과
- `judgePure`에 `{id, choice}`를 넘겨 전부 걸러짐 → 결과 `{}`로 공허 통과
- 계측이 쓴 `hasConfirmedRoundResult` 문자열에 속아 "가드가 있다"로 공허 통과

```js
expect(BLOCK.length, '추출 실패').toBeGreaterThan(200);
expect(BLOCK).not.toContain('id="screenWinnerWait"');   // 과대 추출 방지
expect(host.loserFlow.total, '공허성 가드: 기준선이 0이다').toBeGreaterThan(30);
```

**"0이다"를 단언하기 전에 반드시 "원래 0이 아니었다"를 보장하는 기준선을 둔다.**

---

## 체크리스트

새 소스 추출 테스트를 쓸 때:

- [ ] 런타임 단언으로 대체할 수 없는가 먼저 검토했다
- [ ] 마커가 식별자까지만 잡는다 (인자·클래스·공백 없음)
- [ ] 마커 개수 == 1 을 검증한다
- [ ] 길이 창 / 인접 가정을 쓰지 않는다
- [ ] 계측 한 줄이 삽입돼도 통과한다
- [ ] 공허성 가드가 있다 (추출 길이 + 과대 추출 + 기준선)
