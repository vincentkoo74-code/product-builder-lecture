# LINE 로그인 문제 점검표

이 문서는 Android Capacitor 앱에서 LINE 로그인이 실패할 때 확인할 항목을 정리한 운영용 체크리스트입니다.

## 현재 앱의 LINE OAuth 구조

Android 앱 안에서 LINE 로그인을 누르면 외부 브라우저가 열립니다. 로그인 후 LINE은 먼저 Vercel의 브릿지 페이지로 돌아오고, 브릿지 페이지가 다시 앱 딥링크로 넘겨줍니다.

흐름:

1. 앱에서 LINE 로그인 버튼 선택
2. LINE OAuth 페이지로 이동
3. LINE이 아래 Callback URL로 복귀
4. `oauth-bridge.html`이 `com.maru.rps://oauth` 딥링크로 앱을 다시 호출
5. 앱이 `line-auth` Edge Function을 호출해 Supabase 세션 생성

## LINE Developers 필수 설정

LINE Developers Console에서 LINE Login 채널의 Callback URL에 아래 주소를 정확히 등록해야 합니다.

```text
https://product-builder-lecture-phi.vercel.app/oauth-bridge.html?provider=line
```

주의:

- `https://localhost/?provider=line`은 등록하지 않습니다. Android 외부 브라우저에서 localhost는 앱이 아니라 브라우저 자신을 의미합니다.
- `http://localhost:8765/?provider=line`은 로컬 웹 개발용입니다. 네이티브 앱 테스트에는 사용하지 않습니다.
- URL 끝의 `provider=line`까지 포함해야 합니다.
- LINE Developers에 저장 후 실제 반영까지 잠시 걸릴 수 있으니, 실패하면 1분 뒤 다시 테스트합니다.

## Supabase / Edge Function 확인

Supabase Edge Function 이름:

```text
line-auth
```

필요한 Supabase secrets:

```text
LINE_CHANNEL_ID
LINE_CHANNEL_SECRET
SUPABASE_SERVICE_ROLE_KEY
```

`LINE_CHANNEL_ID`는 앱 코드에도 공개값으로 들어가 있지만, `LINE_CHANNEL_SECRET`과 `SUPABASE_SERVICE_ROLE_KEY`는 절대 클라이언트 코드에 넣지 않습니다.

## Android 앱 딥링크 확인

AndroidManifest에 아래 딥링크가 있어야 합니다.

```xml
<data android:scheme="com.maru.rps" android:host="oauth" />
```

현재 로컬 Android 프로젝트 기준 위치:

```text
android/app/src/main/AndroidManifest.xml
```

## 오류별 원인

### LINE 400 Bad Request / Invalid redirect_uri value

원인:

- LINE Developers Callback URL에 현재 앱이 보내는 `redirect_uri`가 등록되어 있지 않습니다.

해결:

- Callback URL에 아래 주소를 추가합니다.

```text
https://product-builder-lecture-phi.vercel.app/oauth-bridge.html?provider=line
```

### 브라우저가 localhost로 돌아가고 앱이 열리지 않음

원인:

- 네이티브 앱 테스트 중 redirect URI가 `localhost`로 생성되고 있습니다.
- 또는 이전 빌드가 에뮬레이터에 남아 있습니다.

해결:

1. `npm run build:web`
2. `npx cap sync android`
3. Android Studio에서 앱 재설치 또는 Run

### 로그인 후 앱으로 돌아왔지만 계속 로딩

원인 후보:

- `line-auth` Edge Function 오류
- `LINE_CHANNEL_SECRET` 불일치
- 앱에 복사된 웹 자산이 최신이 아님

확인:

1. Supabase Dashboard > Edge Functions > `line-auth` Logs 확인
2. GitHub Actions `Deploy Supabase` 성공 여부 확인
3. Android Studio에서 앱 삭제 후 다시 Run

## 테스트 순서

1. LINE Developers Callback URL 저장
2. `npm test`
3. `npm run build:web`
4. `npx cap sync android`
5. Android Studio에서 앱 Run
6. LINE 로그인 버튼 선택
7. 외부 브라우저 로그인 후 앱으로 복귀하는지 확인
