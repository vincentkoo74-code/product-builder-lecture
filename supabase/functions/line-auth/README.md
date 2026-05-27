# line-auth Edge Function

LINE OAuth 콜백을 받아서 Supabase Auth 세션을 생성하는 함수. (KakaoTalk과 동일 패턴)

## 배포 절차

### 1. 환경 변수 설정

Supabase Dashboard에서:
- **Project Settings → Edge Functions → Secrets**
- https://supabase.com/dashboard/project/cmfxhehpreanijwanwrr/functions/secrets

다음 2개 추가:

| Name | Value |
|---|---|
| `LINE_CHANNEL_ID` | LINE Developers Console → Basic settings → Channel ID |
| `LINE_CHANNEL_SECRET` | LINE Developers Console → Basic settings → Channel secret |

또는 CLI로:
```powershell
cd d:/claude/product-builder-lecture
supabase secrets set LINE_CHANNEL_ID=2001234567
supabase secrets set LINE_CHANNEL_SECRET=발급받은_시크릿
```

### 2. 함수 배포

```powershell
supabase functions deploy line-auth --no-verify-jwt
```

성공 시:
```
Deployed Function line-auth on project cmfxhehpreanijwanwrr
Function URL: https://cmfxhehpreanijwanwrr.supabase.co/functions/v1/line-auth
```

### 3. 테스트 (선택)

```powershell
curl -X POST https://cmfxhehpreanijwanwrr.supabase.co/functions/v1/line-auth `
  -H "Content-Type: application/json" `
  -d '{"code":"test","redirect_uri":"https://product-builder-lecture-phi.vercel.app/?provider=line"}'
```

올바른 code가 아니라 `line token exchange failed` 응답 — 정상.

## 트러블슈팅

| 에러 | 원인 | 해결 |
|---|---|---|
| `server not configured` | env vars 미설정 | Step 1 다시 |
| `line token exchange failed` | redirect_uri 불일치 | LINE Console Callback URL 등록 확인 |
| `line profile fetch failed` | access_token 만료 | LINE OAuth 다시 시도 |

로그 보기:
```powershell
supabase functions logs line-auth
```

## 이메일 권한

기본적으로 LINE은 이메일을 주지 않음. Email permission이 필요하면:
- LINE Developers Console → LINE Login 탭 → **OpenID Connect** 섹션
- **Email address permission** → **Apply for permission**
- 신청서 작성 → 며칠 검토

이메일 권한 없어도 OAuth 동작 — `line_{userId}@maru-rps.local` 합성 이메일 사용.
