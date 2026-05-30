# 앱등록 준비상태 점검

점검일: 2026-05-29

## 요약 판정

- 웹앱 출시/테스트 준비도: 85%
- Supabase 운영 자동화 준비도: 80%
- App Store / Google Play 제출 준비도: 55%

현재 웹 배포와 Supabase 자동화는 앱 테스트에 사용할 수 있는 수준입니다. Capacitor CLI 설치, Android/iOS 네이티브 프로젝트 생성, `cap sync`까지 완료되었습니다. 다만 App Store와 Google Play에 제출하려면 앱 아이콘/스플래시 정식 제작, Android Studio 실기기 실행, Mac/Xcode iOS 빌드, 네이티브 OAuth QA, 스토어 메타데이터 작성이 추가로 필요합니다.

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
- Capacitor CLI 설치 완료: `7.6.5`
- `android/` 프로젝트 로컬 생성 완료
- `ios/` 프로젝트 로컬 생성 완료
- `npm.cmd run cap:sync` 완료
- Android Studio 설치 완료

## 제출 전 주요 막힘 항목

### 1. Android Studio 실기기 실행 확인 필요

Android Studio 설치는 완료되었습니다.

다음 호출 시 진행할 작업은 다음과 같습니다.

- `D:\claude\product-builder-lecture\android` 열기
- Gradle Sync 확인
- Android Emulator 또는 실제 Android 기기 연결
- 디버그 실행 확인
- Android에서 QR, 로그인, 게임 흐름 1차 확인

현재 단계에서는 Android Studio용 별도 CLI 키나 인증키는 필요하지 않습니다.

### 2. iOS 빌드용 Mac/Xcode 필요

iOS 프로젝트 파일은 로컬에 생성되었지만, Windows에서는 다음 작업을 할 수 없습니다.

- Xcode 실행
- iOS Simulator 실행
- iPhone용 IPA 빌드
- TestFlight 업로드

Mac 또는 클라우드 Mac 준비 후 호출해야 합니다.

### 3. 앱 아이콘 / 스플래시 자산 필요

스토어 제출에는 다음 자산이 필요합니다.

- iOS 앱 아이콘
- Android 앱 아이콘
- Android adaptive icon
- 스플래시 화면
- App Store / Google Play 스크린샷

현재 Capacitor 기본 아이콘/스플래시 자산은 생성되었지만, 스토어 제출용으로는 정식 브랜드 자산으로 교체해야 합니다.

제작 기준 문서: `docs/APP_ICON_SPLASH_SPEC.md`

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

1. 앱 아이콘/스플래시 정식 제작 및 적용
2. Android Studio 설치 후 호출: 설치 완료, 다음은 Android 프로젝트 실행 테스트
3. Mac 시스템 설치 후 호출: Xcode/iOS 빌드 및 TestFlight 준비
4. 1/2/3 완료 후 네이티브 OAuth 리다이렉트 테스트
5. 1/2/3/4 완료 후 App Store Connect / Google Play Console 제출 준비

## 현재 호출 대기 상태

### Android Studio 설치 후 다음 호출

Android Studio는 설치 완료되었습니다. 다음에 호출하면 아래 작업을 진행합니다.

- Android Studio에서 `D:\claude\product-builder-lecture\android` 열기
- Gradle Sync 오류 확인
- Android SDK/JDK 설정 확인
- Emulator 또는 실제 Android 폰 실행
- 앱 디버그 실행
- Android 네이티브 환경에서 카카오/라인/게스트 플로우 예비 확인

#### 2026-05-29 진행 기록

- Android Studio 설치 확인 완료
- Android SDK 위치 확인: `C:\Users\Vince\AppData\Local\Android\Sdk`
- Android Studio 내장 JDK 확인:
  - `C:\Program Files\Android\Android Studio1\jbr`
  - `C:\Program Files\Android\Android Studio2\jbr`
- `android/local.properties` 로컬 생성 완료:
  - `sdk.dir=C\:/Users/Vince/AppData/Local/Android/Sdk`
- `JAVA_HOME`은 Windows 전역 환경변수에 아직 설정되지 않음
- Gradle wrapper 실행 시 Java는 해결됐으나, `gradle-8.11.1-bin.zip` 다운로드가 네트워크 타임아웃으로 완료되지 않음
- 임시 다운로드 파일 위치:
  - `C:\Users\Vince\AppData\Local\Temp\gradle-8.11.1-bin.zip`

다음 진행 방법:

1. Android Studio에서 `D:\claude\product-builder-lecture\android`를 직접 열어 Gradle Sync를 실행한다.
2. Android Studio가 Gradle 배포판을 자체적으로 다운로드하도록 기다린다.
3. Sync가 실패하면 오류 화면을 캡처해서 이어서 확인한다.
4. Sync가 성공하면 Run 버튼으로 Emulator 또는 실제 Android 기기에서 실행한다.

#### 2026-05-30 진행 기록

- Android Studio Gradle Sync 실패 원인 확인:
  - 이전 Gradle 다운로드가 남긴 `.lck` / `.part` 파일 때문에 exclusive access timeout 발생
- 손상된 Gradle 캐시 정리 완료:
  - `C:\Users\Vince\.gradle\wrapper\dists\gradle-8.11.1-bin`
  - `C:\Users\Vince\.gradle\wrapper\dists\gradle-8.11.1-all`
- Windows BITS 다운로드로 Gradle 배포파일 직접 다운로드 완료:
  - `gradle-8.11.1-bin.zip`
- Gradle wrapper 캐시에 배포파일 반영 완료
- `gradlew tasks` 성공
- Android debug APK 빌드 성공:
  - `D:\claude\product-builder-lecture\android\app\build\outputs\apk\debug\app-debug.apk`
- Gradle daemon 정리 완료

다음 Android 단계:

1. Android Studio에서 `D:\claude\product-builder-lecture\android`를 다시 연다.
2. Gradle Sync가 정상 통과하는지 확인한다.
3. Emulator 또는 실제 Android 폰을 연결한다.
4. Android Studio의 Run 버튼으로 앱을 실행한다.
5. 앱 첫 화면, 게스트 모드, 카카오/라인 로그인, QR 게임방 참여를 확인한다.

### Mac 시스템 설치 후 다음 호출

Mac 또는 클라우드 Mac 준비 후 호출하면 아래 작업을 진행합니다.

- Xcode 설치 확인
- CocoaPods 설치 확인
- iOS 프로젝트 열기
- Apple Developer 계정 연결
- iPhone 실기기 실행
- TestFlight 업로드 준비

### 네이티브 1/2/3 완료 후 다음 호출

앱 아이콘/스플래시, Android Studio 실행, Mac/Xcode 준비가 끝난 뒤 호출하면 아래 작업을 진행합니다.

- 카카오 로그인 네이티브 테스트
- 라인 로그인 네이티브 테스트
- 게스트 모드 테스트
- 로그인 후 기록 저장 테스트
- 계정 삭제 테스트
- 앱 종료/복귀 후 세션 유지 테스트

### 1/2/3/4 완료 후 제출 준비 호출

위 작업이 끝난 뒤 호출하면 아래 작업을 진행합니다.

- 스토어 등록 문구 작성
- 스크린샷 목록 정리
- 심사 메모 작성
- 데이터 안전성 / 개인정보 문항 작성
- 최종 제출 체크리스트 점검

## 참고 공식 문서

- Apple App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- Google Play Data safety: https://support.google.com/googleplay/android-developer/answer/10787469
- Capacitor Docs: https://capacitorjs.com/docs
