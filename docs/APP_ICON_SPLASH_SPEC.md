# 앱 아이콘 / 스플래시 제작 기준

작성일: 2026-05-29

## 목적

`마루의 가위바위보`를 App Store와 Google Play에 제출하기 전에 사용할 정식 앱 아이콘과 스플래시 화면 제작 기준을 정리한다.

현재 Capacitor가 기본 아이콘/스플래시 자산을 생성했지만, 스토어 제출용으로는 브랜드가 반영된 정식 자산으로 교체해야 한다.

## 브랜드 방향

- 앱 이름: 마루의 가위바위보
- 핵심 이미지: 마루 캐릭터, 발바닥/가위바위보, 파티 게임 분위기
- 톤: 귀엽고 밝은 K-party game 느낌
- 첫인상: 친구들과 바로 QR로 모여서 한 판 할 수 있는 가벼운 게임
- 피해야 할 느낌:
  - 일반 도박/베팅 앱처럼 보이는 표현
  - 너무 복잡한 글자 중심 아이콘
  - 작은 크기에서 식별 안 되는 세밀한 장식

## 앱 아이콘 제작 기준

### 공통 원칙

- 아이콘 안에는 긴 텍스트를 넣지 않는다.
- 작은 크기에서도 마루 캐릭터 또는 발바닥/가위바위보 상징이 보여야 한다.
- 배경은 밝은 크림/오렌지 계열을 기본으로 하되, 현재 앱 UI와 어울리게 만든다.
- 외곽 여백을 충분히 둔다.
- iOS 마스크 처리를 고려해 모서리에 중요한 요소를 두지 않는다.

### 추천 구성

1. 중앙: 마루 얼굴 또는 마루가 손을 드는 이미지
2. 보조 상징: 작은 가위/바위/보 아이콘 또는 발바닥
3. 배경: 따뜻한 오렌지/크림 단색 또는 아주 약한 방사형 하이라이트
4. 텍스트: 원칙적으로 제외. 필요하면 작은 `M` 또는 발바닥 심볼 정도만 사용

### 필수 결과물

- 원본 마스터 이미지: `1024x1024 PNG`
- 투명 배경 없이 정사각형 배경 포함
- iOS AppIcon용 원본
- Android adaptive icon용 foreground/background 분리 가능 버전
- Google Play 등록용 고해상도 아이콘

## Android adaptive icon 기준

Android는 foreground와 background를 분리하는 편이 안전하다.

### foreground

- 마루 캐릭터 또는 발바닥/가위바위보 심볼
- 중앙 배치
- 가장자리에서 충분한 여백 확보
- 투명 PNG 가능

### background

- 단색 또는 부드러운 그라데이션
- 앱 UI와 맞는 따뜻한 크림/오렌지 톤
- foreground 없이도 너무 허전하지 않게 약한 패턴 사용 가능

## 스플래시 화면 제작 기준

### 목표

앱을 열었을 때 즉시 `마루의 가위바위보` 브랜드가 인식되어야 한다.

### 추천 구성

- 중앙 상단 또는 중앙: 마루 캐릭터
- 중앙 하단: 앱 이름 `마루의 가위바위보`
- 보조 문구는 가능하면 제외하거나 짧게 유지
- 배경: 앱 메인 UI와 같은 크림/오렌지 계열

### 필수 결과물

- 정사각형 스플래시 마스터: `2732x2732 PNG`
- Android 세로/가로 대응용으로 잘리는 영역 고려
- iOS safe area 고려
- 중앙 60% 영역 안에 핵심 요소 배치

## 현재 프로젝트 적용 위치

Capacitor 생성 후 현재 기본 자산 위치는 다음과 같다.

### Android

- `android/app/src/main/res/mipmap-*dpi/ic_launcher.png`
- `android/app/src/main/res/mipmap-*dpi/ic_launcher_round.png`
- `android/app/src/main/res/mipmap-*dpi/ic_launcher_foreground.png`
- `android/app/src/main/res/drawable*/splash.png`
- `android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`

### iOS

- `ios/App/App/Assets.xcassets/AppIcon.appiconset/`
- `ios/App/App/Assets.xcassets/Splash.imageset/`

현재 `android/`, `ios/` 디렉터리는 `.gitignore`에 포함되어 있어 Git 추적 대상이 아니다. 네이티브 프로젝트를 저장소에 포함할지 여부는 별도로 결정해야 한다.

## 제작 후 적용 절차

1. 정식 아이콘 마스터 PNG 제작
2. 정식 스플래시 마스터 PNG 제작
3. Android/iOS용 사이즈별 자산 생성
4. Capacitor 네이티브 프로젝트에 반영
5. `npm.cmd run cap:sync` 실행
6. Android Studio에서 Android 빌드 확인
7. Mac/Xcode에서 iOS 빌드 확인
8. 실기기에서 앱 아이콘, 스플래시, 첫 화면 확인

## 이후 진행 계획

### 1단계: 앱 아이콘 / 스플래시 정식 제작

이 문서를 기준으로 정식 앱 아이콘과 스플래시를 제작한다.

### 2단계: Android Studio 설치 후 호출

Android Studio 설치가 완료되면 다음을 진행한다.

- Android 프로젝트 열기
- Gradle sync 확인
- 디버그 빌드
- 실제 Android 기기 실행
- Google Play 제출용 AAB 빌드 준비

### 3단계: Mac 시스템 설치 후 호출

Mac 또는 클라우드 Mac 준비가 끝나면 다음을 진행한다.

- Xcode 설치 확인
- CocoaPods 설치
- iOS 프로젝트 열기
- Apple Developer 계정 연결
- iPhone 실기기 실행
- TestFlight 업로드 준비

### 4단계: 네이티브 OAuth 테스트

1~3단계 완료 후 진행한다.

- 카카오 로그인
- 라인 로그인
- 게스트 모드
- 로그인 후 기록 저장
- 계정 삭제
- 로그아웃 후 재로그인
- 앱 종료/복귀 후 세션 유지

### 5단계: 스토어 제출 준비

1~4단계 완료 후 진행한다.

- App Store Connect 등록 정보 작성
- Google Play Console 등록 정보 작성
- 개인정보 처리방침 URL 등록
- 이용약관 URL 등록
- 계정 삭제 안내 URL 등록
- 스크린샷 제작
- 심사 메모 작성
- 데이터 안전성 / 개인정보 문항 작성
- 최종 실기기 QA

## 체크리스트

- [ ] 정식 앱 아이콘 원본 제작
- [ ] Android adaptive icon foreground/background 제작
- [ ] iOS AppIcon 세트 생성
- [ ] 스플래시 마스터 제작
- [ ] Android 스플래시 반영
- [ ] iOS 스플래시 반영
- [ ] Android Studio 빌드 확인
- [ ] Xcode 빌드 확인
- [ ] 실기기에서 아이콘 확인
- [ ] 실기기에서 스플래시 확인
- [ ] 네이티브 OAuth 확인
- [ ] 스토어 스크린샷 제작
