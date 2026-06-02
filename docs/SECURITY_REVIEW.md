# 보안 점검 메모

점검일: 2026-06-03

## 결론

현재 클라이언트 코드에서 발견된 공개값은 대부분 공개 가능한 식별자다. 다만 로컬 작업 폴더에 Apple Sign in 개인키 파일이 있으므로, 이 파일은 Git에 커밋하지 말고 안전한 비밀 저장소로 옮겨야 한다.

## 공개되어도 되는 값

| 항목 | 위치 | 판단 |
|---|---|---|
| Supabase URL | `index.html` | 공개 가능. 프로젝트 엔드포인트다. |
| Supabase anon JWT | `index.html` | 공개 가능. RLS가 보안 경계다. |
| Kakao REST API Key | `index.html` | OAuth client id 성격. 공개 가능하지만 도메인/리다이렉트 제한 필요. |
| LINE Channel ID | `index.html` | 공개 client id. 공개 가능하지만 Callback URL 제한 필요. |

## 공개되면 안 되는 값

| 항목 | 현재 상태 | 조치 |
|---|---|---|
| `AuthKey_S2B6746YKA.p8` | 작업 폴더에 존재, `.gitignore`로 커밋 차단 | 1Password, Apple Keychain, Supabase Vault 등으로 이동 권장 |
| Supabase service role key | Edge Function 환경변수에서만 사용 | 클라이언트 코드에 절대 넣지 않음 |
| Kakao client secret | Edge Function secret | 클라이언트 코드에 절대 넣지 않음 |
| LINE channel secret | Edge Function secret | 클라이언트 코드에 절대 넣지 않음 |
| Android keystore passwords | GitHub/Supabase secret 또는 로컬 보안 저장소 | 문서에는 변수명만 유지 |

## 관리자 페이지

현재 별도 관리자 페이지는 없다. `debug=1` 또는 `rpsDebugMode=1`은 개발 표시용으로 보이며 관리자 데이터 접근 권한을 주지 않는다.

권장 조치:

1. 관리자 기능이 생기면 URL 숨김이 아니라 Supabase Auth role 또는 Edge Function에서 서버 검증을 한다.
2. `debug` 모드에는 DB 쓰기, 참가자 강제 수정, 결제, 사용자 정보 조회 기능을 넣지 않는다.
3. 운영 배포에서 개발 버튼은 `.dev-only` + `body.debug-mode` 조건으로만 보이게 유지한다.

## 사용자 정보

저장되는 사용자 데이터:

- 닉네임
- 방 코드와 참가 상태
- 계정 로그인 시 이메일 또는 provider 대체 이메일
- 승/패/무/벌칙 횟수와 라운드별 결과

보안 경계:

- `user_game_stats`, `user_game_history`는 RLS가 켜져 있고 본인 `auth.uid()` 기준으로 조회/쓰기 제한된다.
- 방/참가자 테이블은 파티 게임 실시간 참여를 위해 공개 쓰기가 섞여 있을 가능성이 높다. 출시 전 RLS 정책을 별도 재점검해야 한다.

## 결제

현재 결제 기능은 없다. 결제 관련 secret, 상품 ID, 영수증 검증 코드도 없다.

결제 기능을 추가할 경우:

- 영수증 검증은 클라이언트가 아니라 서버/Edge Function에서 처리한다.
- App Store / Play Billing 영수증과 사용자 계정을 서버에서 연결한다.
- 결제 상태는 클라이언트 localStorage를 신뢰하지 않는다.

## 출시 전 필수 체크

1. `AuthKey_*.p8` 파일을 작업 폴더 밖으로 이동한다.
2. GitHub Secrets에 들어간 값은 이름만 문서화하고 값은 문서에 적지 않는다.
3. Supabase RLS 정책을 `rooms`, `participants`, `user_game_*` 기준으로 재검토한다.
4. Supabase Edge Function logs에 secret 값이 찍히지 않는지 확인한다.
5. OAuth redirect/callback URL을 Vercel production domain과 앱 deep link로 제한한다.
