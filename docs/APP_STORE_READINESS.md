# 앱등록 준비상태 점검

점검일: 2026-05-29

## 요약 판정

- 웹앱 출시/테스트 준비도: 85%
- Supabase 운영 자동화 준비도: 80%
- App Store / Google Play 제출 준비도: 45%

현재 웹 배포와 Supabase 자동화는 앱 테스트에 사용할 수 있는 수준입니다. 다만 App Store와 Google Play에 제출하려면 Capacitor 네이티브 프로젝트 생성, 앱 아이콘/스플래시 준비, 실기기 QA, 스토어 메타데이터 작성이 추가로 필요합니다.

## 현재 통과한 항목

- 프로덕션 앱 접속 정상: https://product-builder-lecture-phi.vercel.app/
- 개인정보 처리방침 페이지 공개 정상: https://product-builder-lecture-phi.vercel.app/privacy.html
- 이용약관 페이지 공개 정상: https://product-builder-lecture-phi.vercel.app/terms.html
- 계정 삭제 안내 페이지 공개 정상: https://product-builder-lecture-phi.vercel.app/account-delete.html
- `npm.cmd test` 통과: `index.html` 내 JavaScript 문법 정상
- `npm.cmd run build:web` 통과: `dist/` 빌드 정상
- Supabase / GitHub Actions 자동배포 최근 성공
- 앱 내부에 계정 삭제 버튼 존재
- Apple `.p8` 키 파일은 로컬에 있으나 `.gitignore`에 의해 Git 추적 대상은 아님

## 제출 전 주요 막힘 항목

### 1. Capacitor 네이티브 프로젝트 미생성

현재 저장소에 `ios/`, `android/` 디렉터리가 없습니다.

즉, 아직 App Store용 IPA나 Google Play용 AAB를 빌드할 수 없습니다.

### 2. Capacitor CLI 로컬 설치 상태 확인 필요

현재 `node_modules/.bin/cap.cmd`가 없습니다.

다음 단계에서 먼저 의존성을 설치한 뒤 Capacitor 플랫폼을 생성해야 합니다.

```powershell
npm.cmd install
npm.cmd run cap:add:android
npm.cmd run cap:add:ios
npm.cmd run cap:sync
```

### 3. 앱 아이콘 / 스플래시 자산 필요

스토어 제출에는 다음 자산이 필요합니다.

- iOS 앱 아이콘
- Android 앱 아이콘
- Android adaptive icon
- 스플래시 화면
- App Store / Google Play 스크린샷

현재 저장소에서 별도 앱 아이콘/스플래시 전용 자산은 확인되지 않았습니다.

### 4. 네이티브 OAuth 테스트 필요

카카오/라인 로그인은 웹에서는 확인됐지만, Capacitor 앱 내부 WebView에서는 OAuth 리다이렉트와 세션 처리 방식이 달라질 수 있습니다.

실기기에서 반드시 확인해야 합니다.

- 카카오 로그인
- 라인 로그인
- 게스트 모드
- 로그인 후 기록 저장
- 계정 삭제
- 로그아웃 후 재로그인

### 5. 실기기 QA 필요

다음 항목은 iPhone과 Android 기기에서 직접 확인해야 합니다.

- QR 스캔 후 게임방 참여
- 호스트 방 만들기
- 참가자 입장/퇴장
- 술래 숫자 설정
- 반복 라운드 진행
- 최종 술래 확정
- 다음게임 호스트 전환
- 게임 다시 하기
- 소리/햅틱 동작
- 느린 네트워크 상황
- 앱 백그라운드/복귀 후 상태 유지

## 다음 작업 순서

1. `npm.cmd install`로 Capacitor CLI와 의존성 정리
2. `npm.cmd run cap:add:android`로 Android 프로젝트 생성
3. `npm.cmd run cap:add:ios`로 iOS 프로젝트 생성
4. 앱 아이콘/스플래시 생성 및 적용
5. Android Studio에서 AAB 빌드 테스트
6. Xcode에서 IPA/TestFlight 빌드 테스트
7. 네이티브 OAuth 리다이렉트 테스트
8. App Store Connect / Google Play Console 메타데이터 작성
9. 개인정보 처리방침, 이용약관, 계정 삭제 안내 URL 등록
10. 실기기 QA 후 제출

## 참고 공식 문서

- Apple App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- Google Play Data safety: https://support.google.com/googleplay/android-developer/answer/10787469
- Capacitor Docs: https://capacitorjs.com/docs
