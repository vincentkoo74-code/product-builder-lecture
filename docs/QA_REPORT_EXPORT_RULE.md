# QA 리포트 내보내기 — 상시 운영 규칙

**적용 시점: 2026-08-29 이후 모든 필드 QA**

## 왜 이 규칙이 생겼나

Build38 3-device 필드 테스트에서 3개 리포트가 업로드됐지만, **실제 게임 세션이 담긴 것은 1개뿐**이었다.

| 파일 | 세션 | 이벤트 | 내용 |
|---|---|---|---|
| `qa-report-build38-…00-03-07.json` | `4nnehw7i` | 154 | ✅ 방 3VT6 전체 게임 |
| `qa-report-build38-…00-00-13.json` | `lmxuxbnc` | 2 | ❌ 세션 시작만 |
| `qa-report-build38-…00-31-30.json` | `lmxuxbnc` | 23 | ❌ clock sync + 화면 전환만 |

뒤 두 개는 **같은 단말의 같은 세션**이고, 게임이 끝난 뒤 시작된 idle 세션이다.
그 단말이 실제로 게임을 치른 세션(`uu2fnpsu`)은 `QA_SESSION_RECOVERED` 기록으로만 남고 **내보내지지 않았다.**

리포트는 현재 세션 + `previousSession` **1개**만 담는다. 게임 후 앱을 idle로 두면 새 세션이 시작되고, 게임 세션은 한 칸 밀려나 결국 유실된다.

## 규칙

> **게임 세션이 끝나면 즉시 QA 리포트를 내보낸다.**

기기마다:

1. 테스트 게임을 끝까지 진행한다
2. **앱을 idle 상태로 두지 않는다** — 홈으로 나가거나 화면을 끄고 방치하지 않는다
3. 곧바로 QA 리포트를 내보낸다
4. 기기 역할을 파일명이나 메모로 기록한다
5. **3개를 한 번에** 같은 폴더에 업로드한다

## 파일명

권장:

```
HOST-IPHONE-<timestamp>.json
PARTICIPANT-IPHONE-<timestamp>.json
PARTICIPANT-ANDROID-<timestamp>.json
```

앱이 만드는 파일명을 바꿀 수 없으면, 같은 폴더에 매핑 메모를 함께 올린다:

```
qa-report-build38-2026-08-29-00-03-07.json = PARTICIPANT-IPHONE
qa-report-build38-2026-08-29-00-24-10.json = HOST-IPHONE
qa-report-build38-2026-08-29-00-31-30.json = PARTICIPANT-ANDROID
```

## 업로드 위치

```
Google Drive / Maru RPS / RPS-KR-QA
folder id: 1S39atdkl7B903u3eayw_tLBdMkZB3ARw
```

업로드 후 파일 목록을 눈으로 확인한다. 2026-08-29 회차에서 메모 파일은 올라갔는데
JSON 하나(`…00-24-10.json`)가 끝내 색인에 나타나지 않은 사례가 있다.

## 리포트가 쓸모 있는지 확인하는 법

내보낸 JSON을 열어 확인한다:

- `qaMetrics.session.deviceRole` — `host`가 최소 1개 있어야 한다
- `qaMetrics.recent` 길이 — 게임 한 판이면 보통 100건 이상
- `qaMetrics.recent[].roomCode` — 테스트한 방 코드가 있어야 한다
- `COUNTDOWN_START` / `ROUND_RESULT` 이벤트 존재

이 중 하나라도 비어 있으면 그 리포트로는 타임라인을 재구성할 수 없다.

## 다음 3-device 테스트 시나리오

Build39 계측이 들어간 빌드로 진행한다.

| 기기 | 역할 |
|---|---|
| A | iPhone — **Host** |
| B | iPhone — Participant |
| C | Android — Participant |

최소 진행 범위:

1. 방 생성
2. 3인 전원 입장
3. 준비 완료
4. 게임 시작
5. **여러 라운드**
6. **최소 1회 재경기(새 게임)**
7. 최종 결과

**한 라운드만 하고 멈추지 않는다.** Build38에서 관측된 두 이상 현상(카운트다운 6초 지연,
결과 스냅샷 2.6초 정체)이 **모두 재경기 직후 새 게임의 첫 라운드**에서 나타났다.

종료 즉시 3대 모두 내보내 함께 업로드한다.
