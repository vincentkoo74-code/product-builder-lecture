# MARU RPS V1.0_JP — LIFF 어댑터 경계 설계

작성: 2026-09-02 · CRIS · **설계 문서 — LIFF SDK 코드 없음**

이 문서는 Sprint JP-02 항목 E 의 산출물이다. **구현이 아니다.**
`liff.init()` 없음 · LIFF SDK 없음 · LINE Login 비활성 유지 · 운영자 채널 설정 없음.

## 0. 왜 지금 이 경계를 그리는가

JP 진입은 HIKARI 의 플랫폼 판정에 묶여 있다. 그러나 **교체 지점이 어디인지**는 지금 확정할 수 있고,
확정해 두면 판정이 내려온 뒤의 작업이 "설계"가 아니라 "배선"이 된다.

현재 초대/진입 계층은 이미 플랫폼 중립으로 만들어져 있다(JP-SYNC-INVITE / JP-ENTRY-INVITE 슬라이스).
이 문서는 그 사실을 검증하고, LIFF 가 붙을 자리를 한 곳으로 못박는다.

## 1. 현재 계층 (실측)

```
[플랫폼 진입]            ← 지금은 웹 URL 뿐. LINE 없음
      ↓
buildInviteUrl()         ← 초대 URL 생성. LINE 참조 0
      ↓
parseInviteFromSearch()  ← URL → 토큰 파싱. 형식 검증만
      ↓
beginInviteEntry()       ← 보류 컨텍스트 생성 (신원 이전)
      ↓
[신원 확립]              ← 현재: playAsGuest() / SNS. LINE 아님
      ↓
consumePendingInvite()   ← 신원 확립 후에만 소비
      ↓
openInviteEntry()        ← 권위 조회 (Tokyo)
      ↓
resolveInviteChallenge() ← 상태 판정 (CORE, 순수 함수)
      ↓
navigateFromInvite()     ← 화면/입장
      ↓
joinFromQrCode → joinRoom → Tokyo
```

**검증된 사실:** `buildInviteUrl` · `openInviteEntry` · `bootstrapInviteEntry` · `resolveInviteChallenge`
어디에도 LINE/LIFF 참조가 없다. 소스의 `liff` 언급 7건은 **전부 주석**이며 실행 코드는 0줄이다.

## 2. LIFF 어댑터 경계 — 딱 두 곳

```
┌─────────────────────────────────────────────────────────┐
│ LIFF 어댑터 (신규, 미구현)                                  │
│                                                          │
│  ① 진입 어댑터   LIFF 컨텍스트 → entryContext 정규화        │
│  ② 신원 어댑터   LINE identity → JP 세션                   │
│  ③ 공유 어댑터   초대 URL → LINE 공유 (선택)                │
└─────────────────────────────────────────────────────────┘
```

### ① 진입 어댑터

현재 `bootstrapInviteEntry(location.search, handlers)` 는 **URL 문자열 하나**만 받는다.
LIFF 는 `liff.state` 또는 쿼리로 파라미터를 전달하므로, 어댑터는 그것을 **같은 형태의 search 문자열**로
정규화해 넘기면 된다. **그 아래 계층은 한 줄도 바뀌지 않는다.**

```
LIFF 컨텍스트 → normalizeLiffEntry() → "?invite=<token>" → bootstrapInviteEntry(...)
```

### ② 신원 어댑터 (핵심, 정책 종속)

현재 신원 확립 지점은 정확히 한 곳이다: `hasUsableIdentity()` = `Boolean(getAuthState())`.
LINE 신원은 **여기에만** 연결되면 된다.

```
LINE identity → [검증] → setAuthState('line') → resumePendingInviteAfterIdentity()
```

`resumePendingInviteAfterIdentity()` 는 이미 게스트/SNS 양쪽에서 호출되고 있으므로,
LINE 경로도 같은 함수를 부르면 보류 초대 연속성(JP-ENTRY-INVITE-002)이 그대로 유지된다.

⚠️ **무엇을 신원의 권위로 삼을지는 정책 문제다** — §5 참조.

### ③ 공유 어댑터 (선택)

`openInviteEntry` 위의 초대 전송 함수 하나만 교체하면 된다.
소스 주석에 이미 *"나중에 LIFF 어댑터가 이 한 함수만 교체하면 된다"* 로 표시돼 있다.

## 3. 신원 / 세션 핸드오프

```
LINE (LIFF)                JP 클라이언트              JP 백엔드 (Tokyo)
    │                          │                          │
    │ ── identity 자료 ──────→ │                          │
    │                          │ ── 검증 요청 ──────────→ │  ← 서버 검증 필수
    │                          │ ←──── JP 세션 ────────── │
    │                          │                          │
    │                     setAuthState(...)               │
    │                     보류 초대 재개                     │
```

**설계 원칙 (이미 확립된 것과 일관)**
1. 클라이언트가 주장하는 신원을 그대로 믿지 않는다 — 서버 검증을 거친다.
2. JP 세션은 **Tokyo 전용**이다. Seoul/KR 사용자 풀과 절대 섞이지 않는다(JP-BL-005 검증됨).
3. 신원 확립 **이전**에 초대를 소비하지 않는다(JP-ENTRY-INVITE-002 계약).
4. Supabase 세션 키가 `sb-<ref>-auth-token` 이라 프로젝트별로 분리된다 — 구조적 격리.

## 4. 바뀌지 않는 것

| 계층 | 영향 |
|---|---|
| CORE 게임 규칙 · 라운드 상태 기계 | **없음** |
| 초대 토큰 발급/해석 | **없음** |
| Realtime 구독 · 폴링 안전망 | **없음** |
| Tokyo 보안(GRANT/RLS/트리거) | **없음** |
| 시장 계층(MARKET_CONFIG) | 인증 provider 목록만 |

## 5. POLICY_QUESTION_FOR_HIKARI

이 설계를 코드로 옮기기 전에 답이 필요한 항목이다. **엔지니어링이 임의로 정하지 않는다.**

1. **신원 권위** — LIFF `getProfile()` / ID Token / 백엔드 검증 중 무엇을 JP 사용자 풀의 권위로 삼는가.
   (ID Token 서버 검증이 기술적으로 가장 견고하나, 채택은 정책 판단이다.)
2. **LINE user ID 저장** — JP 백엔드에 저장 가능한가. 가능하다면 보관 위치·기간·처리위탁 고지 요건은.
3. **게스트 병행** — LINE MINI App 안에서 LINE 인증 없이 게스트 플레이를 허용해도 되는가.
4. **연동 해제(unlink)** — 해제 시 게임 데이터를 즉시 삭제하는가, 익명화하는가.
5. **채널 구성** — LINE Login 채널과 MINI App 채널을 분리하는가. 운영자 계정 귀속은.
6. **Official Account 연계** — V1 범위에 포함하는가(현재 P2).

## 6. 착수 조건

- [ ] §5 정책 1~5 확정 (HIKARI)
- [ ] 운영자 확정 → `JP_OPERATOR_CONFIG.operatorId` 주입 가능
- [ ] LINE 채널 발급 (OPERATOR_DEPENDENCY)
- [ ] 일본어 법무 문서 확정 (현재 PENDING_HIKARI)

위가 채워지면 구현 범위는 **어댑터 3개 + 신원 검증 서버 경로**이며, 그 아래 계층은 손대지 않는다.
