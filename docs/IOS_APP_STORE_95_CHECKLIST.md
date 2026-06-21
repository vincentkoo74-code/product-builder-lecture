# iOS TestFlight 준비 체크리스트

최종 점검일: 2026-06-10

## 현재 판정

- [x] Capacitor iOS 프로젝트 생성
- [x] 웹 문법 검사 및 웹 번들 빌드 통과
- [x] Bundle Identifier 설정: `com.maru.rps`
- [x] iOS 14.0 이상 배포 대상으로 설정
- [x] 카메라 권한 설명 추가
- [x] OAuth 복귀 URL scheme 추가: `com.maru.rps`
- [x] 기본/영문/일문 앱 아이콘 추가
- [x] 앱 아이콘 1024x1024, alpha 없음 확인
- [x] 비면제 암호화 미사용 선언 추가
- [x] iOS 프로젝트와 재현에 필요한 소스를 Git 추적 대상으로 전환
- [x] CocoaPods 의존성 설치
- [x] iOS Simulator 대상 Debug 컴파일
- [x] 실제 기기 대상 Release 컴파일
- [ ] Xcode 전체 개발자 디렉터리 선택
- [ ] Apple Developer 계정 및 Team 연결
- [ ] Simulator 실행 확인
- [ ] 실제 iPhone 서명 빌드 및 기능 QA
- [ ] Release Archive 생성 및 검증
- [ ] App Store Connect 앱 레코드 생성
- [ ] TestFlight 업로드 및 처리 완료 확인

## 1. 현재 iOS 프로젝트 상태

### 준비 완료

- 프로젝트: `ios/App/App.xcworkspace`
- Scheme: `App`
- Bundle Identifier: `com.maru.rps`
- Version: `1.0`
- Build: `1`
- Signing: Automatic
- Debug Simulator 컴파일: 성공
- Release iPhoneOS 컴파일: 성공, 서명 제외 상태
- URL scheme: `com.maru.rps`
- 카메라 권한 문구: 설정됨
- Capacitor App 플러그인: Podfile에 포함
- 언어별 대체 앱 아이콘: 프로젝트 및 네이티브 브릿지에 포함
- `Info.plist`의 `ITSAppUsesNonExemptEncryption`: `false`

### 아직 확인 또는 입력 필요

- Apple Developer Team 값
- Apple Developer Program 활성 상태
- 로컬 코드 서명 인증서: 현재 유효한 identity 0개
- App Store Connect에서 `com.maru.rps` Bundle ID 사용 가능 여부
- 앱 이름 사용 가능 여부
- Simulator 및 실제 iPhone 실행
- 네이티브 OAuth, QR 카메라, 계정 삭제 실기기 QA
- App Store 개인정보 문항, 스크린샷, 지원 URL, 심사 연락처

## 2. 로컬 빌드 준비

현재 `xcode-select`가 Command Line Tools를 가리키면 Xcode 빌드가 실패한다.

터미널에서 한 번 실행:

```bash
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -runFirstLaunch
```

전역 설정을 바꾸기 전에는 아래처럼 명령별로 전체 Xcode를 지정할 수 있다. Xcode와 Capacitor 도구를 안정적으로 사용하려면 위의 `xcode-select` 설정을 권장한다.

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -version
```

프로젝트 동기화:

```bash
npm install
npm test
npm run build:web
npx cap sync ios
cd ios/App
pod install
```

Xcode에서는 반드시 workspace를 연다:

```bash
open ios/App/App.xcworkspace
```

`App.xcodeproj`가 아니라 `App.xcworkspace`를 사용해야 CocoaPods 의존성이 포함된다.

## 3. Xcode에서 해야 할 작업

### Apple Developer Team 연결

- [ ] Xcode 실행
- [ ] `Xcode > Settings > Accounts` 열기
- [ ] `+` 버튼으로 Apple ID 로그인
- [ ] Apple Developer Program이 활성화된 계정인지 확인
- [ ] `security find-identity -v -p codesigning`에서 배포 가능한 인증서 확인
- [ ] `ios/App/App.xcworkspace` 열기
- [ ] 왼쪽 프로젝트 탐색기에서 파란색 `App` 프로젝트 선택
- [ ] `TARGETS > App > Signing & Capabilities` 선택
- [ ] `Automatically manage signing` 활성화
- [ ] `Team`에서 본인의 Apple Developer Team 선택
- [ ] Bundle Identifier가 `com.maru.rps`인지 확인
- [ ] `Signing Certificate`와 `Provisioning Profile` 오류가 사라졌는지 확인

Team을 선택하면 Xcode가 프로젝트 파일에 `DEVELOPMENT_TEAM` 값을 기록할 수 있다. 개인 Team이 아니라 App Store 배포 권한이 있는 유료 Apple Developer Team을 선택해야 한다.

### 프로젝트 설정 확인

- [ ] `General > Identity > Display Name`: `마루의 가위바위보`
- [ ] `General > Identity > Version`: `1.0`
- [ ] `General > Identity > Build`: 기존 TestFlight 빌드보다 큰 정수
- [ ] `General > Minimum Deployments`: iOS 14.0 이상
- [ ] `General > App Icons and Launch Screen`: `AppIcon`, `LaunchScreen`
- [ ] `Info > URL Types`: `com.maru.rps`
- [ ] `Info > Custom iOS Target Properties`: 카메라 권한 문구 확인
- [ ] `Signing & Capabilities`: 서명 오류 없음

## 4. Simulator 및 실제 iPhone QA

### Simulator

- [ ] 앱 시작 및 홈 화면 표시
- [ ] 게스트 모드 진입
- [ ] 방 만들기와 방 코드 입장
- [ ] 벌칙 설정, 준비, 카운트다운, 선택, 결과, 재대결
- [ ] 한국어/영어/일본어 변경 및 앱 아이콘 전환
- [ ] 백그라운드 진입 후 복귀

### 실제 iPhone

- [ ] QR 카메라 권한 요청 및 QR 입장
- [ ] 카카오 로그인 후 앱 복귀
- [ ] LINE 로그인 후 앱 복귀
- [ ] Google 로그인
- [ ] Apple 로그인
- [ ] 로그아웃 및 재로그인
- [ ] 앱 내 계정 삭제
- [ ] 호스트와 참가자를 서로 다른 실제 기기에서 진행
- [ ] 약한 네트워크 및 앱 복귀 상황 확인

## 5. App Store Connect 준비

- [ ] [App Store Connect](https://appstoreconnect.apple.com/) 로그인
- [ ] `My Apps > + > New App` 선택
- [ ] Platforms: iOS
- [ ] Name: `마루의 가위바위보`
- [ ] Primary Language 선택
- [ ] Bundle ID: `com.maru.rps`
- [ ] SKU 입력
- [ ] 사용자 접근 권한 선택
- [ ] 개인정보 처리방침 URL 입력
- [ ] App Privacy 문항 작성
- [ ] 연령 등급 작성
- [ ] 카테고리 선택
- [ ] 지원 URL 및 마케팅 URL 입력
- [ ] 심사 연락처 및 리뷰 노트 작성

## 6. TestFlight 업로드

- [ ] Xcode 상단 실행 대상을 `Any iOS Device (arm64)` 또는 실제 기기로 변경
- [ ] `Product > Archive` 실행
- [ ] Organizer에서 최신 Archive 선택
- [ ] `Validate App` 실행 및 오류 해결
- [ ] `Distribute App > App Store Connect > Upload` 선택
- [ ] 자동 서명 옵션 유지
- [ ] 업로드 완료 확인
- [ ] App Store Connect의 TestFlight 탭에서 빌드 처리 완료 대기
- [ ] 수출 규정 질문이 나오면 비면제 암호화 미사용 상태 확인
- [ ] 내부 테스터 그룹 생성 및 빌드 추가
- [ ] 실제 설치 후 최종 smoke test

새 업로드마다 `CURRENT_PROJECT_VERSION`의 Build 값을 증가시켜야 한다.

## 7. TestFlight 이후 App Store 제출 전

- [ ] App Store 스크린샷 업로드
- [ ] 설명, 키워드, 부제, 프로모션 텍스트 확정
- [ ] 앱 개인정보 응답과 실제 데이터 사용 일치 확인
- [ ] 로그인 심사용 계정 또는 게스트 테스트 방법 제공
- [ ] 계정 삭제 경로를 심사 메모에 명시
- [ ] TestFlight 피드백 반영
- [ ] 최종 빌드를 App Store 버전에 연결
- [ ] 심사 제출
