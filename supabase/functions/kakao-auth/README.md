# kakao-auth Edge Function

Kakao OAuth 콜백을 받아서 Supabase Auth 세션을 생성하는 함수.

## 배포 절차

### 1. Supabase CLI 설치 (Windows)

PowerShell에서:
```powershell
# Scoop 사용 (권장)
scoop install supabase

# 또는 직접 다운로드
# https://github.com/supabase/cli/releases — 최신 windows-amd64.zip
```

설치 후:
```powershell
supabase --version
```

### 2. Supabase 프로젝트 연결

프로젝트 루트(`d:/claude/product-builder-lecture`)에서:

```powershell
cd d:/claude/product-builder-lecture

# Supabase 로그인 (한 번만)
supabase login

# 프로젝트 연결 (Project Ref: cmfxhehpreanijwanwrr)
supabase link --project-ref cmfxhehpreanijwanwrr
```

### 3. 환경 변수 설정

Supabase Dashboard에서:
- **Project Settings → Edge Functions → Secrets**
- 또는 https://supabase.com/dashboard/project/cmfxhehpreanijwanwrr/functions/secrets

다음 2개 추가:

| Name | Value |
|---|---|
| `KAKAO_REST_API_KEY` | `bce3cbf5a9fcdb2a300ce741bca3486a` (예시) |
| `KAKAO_CLIENT_SECRET` | (카카오에서 발급받은 시크릿 코드) |

또는 CLI로:
```powershell
supabase secrets set KAKAO_REST_API_KEY=bce3cbf5a9fcdb2a300ce741bca3486a
supabase secrets set KAKAO_CLIENT_SECRET=발급받은_시크릿
```

### 4. 함수 배포

```powershell
supabase functions deploy kakao-auth --no-verify-jwt
```

`--no-verify-jwt` 옵션: 로그인 안 한 사용자가 호출하는 함수라 JWT 검증 비활성화 (OAuth 콜백용).

성공 시 출력:
```
Deployed Function kakao-auth on project cmfxhehpreanijwanwrr
Function URL: https://cmfxhehpreanijwanwrr.supabase.co/functions/v1/kakao-auth
```

### 5. 테스트 (선택)

```powershell
curl -X POST https://cmfxhehpreanijwanwrr.supabase.co/functions/v1/kakao-auth `
  -H "Content-Type: application/json" `
  -d '{"code":"test","redirect_uri":"https://product-builder-lecture-phi.vercel.app/?provider=kakao"}'
```

올바른 code가 아니므로 `kakao token exchange failed` 응답 — 정상 (함수가 동작한다는 의미).

## 환경 변수 (자동 주입)

`SUPABASE_URL` 과 `SUPABASE_SERVICE_ROLE_KEY` 는 Edge Function 환경에 자동으로 주입됨. 별도 설정 불필요.

## 트러블슈팅

| 에러 | 원인 | 해결 |
|---|---|---|
| `server not configured` | env vars 미설정 | Step 3 다시 |
| `kakao token exchange failed` | code 만료/redirect_uri 불일치 | 카카오 콘솔 Redirect URI 등록 확인 |
| `kakao user info failed` | access_token 만료 | 카카오 OAuth 다시 시도 |
| `createUser failed` | Supabase 서비스 키 권한 부족 | SERVICE_ROLE_KEY 확인 |
| `generateLink failed` | email format 문제 | Edge Function 로그 확인 |

Edge Function 로그 보기:
```powershell
supabase functions logs kakao-auth
```

또는 Dashboard → Edge Functions → kakao-auth → Logs 탭.
