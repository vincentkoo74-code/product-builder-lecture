# MARU RPS V1.0_JP — 외부 송신 기술 인벤토리

작성: 2026-09-02 (Sprint JP-02C) · CRIS · **기술 인벤토리 — 법적 판단 아님**

⚠️ 일본 법령상 외부送信 고지 의무의 유무·범위는 **HIKARI 소관**이다.
이 문서는 그 판단에 필요한 **기술적 사실**만 제공한다.

측정 방법: 실제 브라우저로 JP 전체 흐름(시작 → 게스트 → 도전 생성 → 초대 → 두 번째 참가자 →
준비 → 1라운드 → nextRound)을 구동하며 모든 요청 목적지를 기록했다.

## JP 런타임 외부 목적지 (JP-02C 이후)

| HOST | PURPOSE | REQUIRED_FOR_CORE_GAME | OPTIONAL | USER_DATA_SENT | IDENTIFIERS_SENT | CURRENTLY_ACTIVE |
|---|---|---|---|---|---|---|
| `cmfxhehpreanijwanwrr.supabase.co` | JP 백엔드(REST/Realtime/Auth/Edge Function) — Tokyo, ap-northeast-1 | **예** | 아니오 | 방 코드·닉네임·선택·라운드 상태 | 게스트 참가자 id(앱 생성), 익명 JWT | **예** |

**JP 런타임의 외부 목적지는 이것 하나다.** 실측 확인:
```
hosts: { "127.0.0.1:<앱 자신>": 106, "cmfxhehpreanijwanwrr.supabase.co": 143 }
thirdPartyStatic: []
```

## 제거된 목적지 (JP-02C)

| HOST | 이전 용도 | 상태 |
|---|---|---|
| `fonts.googleapis.com` | 웹폰트 CSS | **JP 에서 제거** (KR/EN 은 유지) |
| `fonts.gstatic.com` | 웹폰트 파일 | **JP 에서 제거** (KR/EN 은 유지) |

JP 이전/이후 실측(동일 조건, 각 3회, 콜드 컨텍스트·변종마다 새 브라우저):

| | googleapis | gstatic | 원격 폰트 바이트 | 로컬 폰트 |
|---|---|---|---|---|
| BEFORE (정적 `<link>`) | 1 | 25 | 1,284,882 | 4건 / 12,412,144B |
| AFTER (로케일 주입) | **0** | **0** | **0** | 4건 / 12,412,144B |

로컬 폰트 요청·바이트는 변하지 않았다 — JP 는 이전에도 같은 번들을 받고 있었고,
JP-02C 가 없앤 것은 **그 위에 얹혀 있던 원격 폰트**다.

## 비활성 외부 의존 (현 JP 흐름에서 요청 없음)

| HOST | 분류 | 비고 |
|---|---|---|
| `product-builder-lecture-phi.vercel.app` (`OAUTH_BRIDGE_URL`) | LEGACY EXTERNAL DEPENDENCY / INACTIVE | LINE/Kakao OAuth 복귀 브릿지. JP 는 LINE Login 비활성·Kakao 제거로 도달하지 않는다. JP-BL-008/009 와 함께 재검토 |
| `kauth.kakao.com` / `kapi.kakao.com` | KR 전용 | JP 런타임 도달 불가(JP-BL-002 실측 0건) |
| `<ref>.supabase.co/functions/v1/kakao-auth` | DEPLOYED LEGACY / UNUSED BY JP | JP 도달 불가 |

## 사용자 데이터 관점 (사실만)

Tokyo 백엔드로 전송되는 것:
- 방 코드(앱 생성 4자), 참가자 표시명(사용자 입력 닉네임 또는 JP 기본값 `ゲスト`)
- 선택(rock/paper/scissors), 준비 상태, 라운드 번호, 벌칙 텍스트(사용자 입력)
- 초대 토큰(앱 생성 난수), 익명 JWT

전송되지 **않는** 것(현 JP 흐름):
- 이메일·전화번호·LINE user ID(LINE 미통합)
- 위치정보·연락처·기기 식별자
- 분석 이벤트(전송 경로 미구현 — 설계 전용)

## 남은 판단 항목 (HIKARI)

1. 위 목적지가 일본 외부送信 고지 대상인가
2. Tokyo 리전 Supabase 가 처리위탁/제3자 제공 중 무엇에 해당하는가
3. KR/EN 로케일의 Google Fonts 요청이 JP 사용자에게 발생할 수 있는 경로(언어 전환)를 고지 대상으로 볼 것인가
   — 기술적 사실: JP 사용자가 앱 내에서 언어를 ko/en 으로 바꾸면 그 시점부터 Google Fonts 를 로드한다
