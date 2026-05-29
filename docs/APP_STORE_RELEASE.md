# 앱스토어 제출 준비 체크리스트

대상 앱: 마루의 가위바위보  
번들 ID 초안: `com.maru.rps`  
프로덕션 URL: `https://product-builder-lecture-phi.vercel.app/`

## 1. 로컬 패키징

Capacitor 공식 흐름은 `package.json`, 빌드된 웹 에셋 디렉터리, 그 안의 `index.html`을 요구한다. 이 프로젝트는 `npm run build:web`으로 `dist/`를 만들고, `capacitor.config.ts`의 `webDir`도 `dist`로 맞췄다.

```powershell
npm.cmd install
npm.cmd run build:web
npm.cmd run cap:add:ios
npm.cmd run cap:add:android
npm.cmd run cap:sync
```

iOS 빌드:

```powershell
npm.cmd run cap:open:ios
```

Android 빌드:

```powershell
npm.cmd run cap:open:android
```

## 2. 스토어 심사 필수 항목

- 개인정보 처리방침 URL: `https://product-builder-lecture-phi.vercel.app/privacy.html`
- 이용약관 URL: `https://product-builder-lecture-phi.vercel.app/terms.html`
- 계정 삭제 안내 URL: `https://product-builder-lecture-phi.vercel.app/account-delete.html`
- 앱 내 계정 삭제: `내 기록` 팝업 하단의 `계정 삭제`
- 로그인 리뷰 방법: 게스트 모드가 있으므로 리뷰 노트에 “로그인 없이 마루랑 놀기 선택 가능”을 적는다.
- 백엔드: Supabase 프로젝트와 Edge Functions가 리뷰 기간 내내 켜져 있어야 한다.

## 3. App Store Connect 입력 초안

앱 이름:

```text
마루의 가위바위보
```

부제:

```text
QR로 함께 하는 파티 가위바위보
```

설명:

```text
마루의 가위바위보는 한 사람이 방을 만들고 친구들이 QR 코드로 바로 참여하는 실시간 파티 게임입니다.
술래 숫자와 벌칙을 정하고, 가위 바위 보 대결을 반복해 최종 술래를 정할 수 있습니다.

주요 기능
- QR 코드로 빠른 게임방 참여
- 카카오톡, LINE, Google, Apple 로그인 또는 게스트 모드
- 실시간 준비 상태와 게임 결과 동기화
- 술래 숫자 설정과 벌칙 변경
- 계정 로그인 시 최근 게임 기록과 승률 저장
- 한국어, 영어, 일본어 지원
```

키워드:

```text
가위바위보,파티게임,술래,벌칙,QR게임,친구게임
```

리뷰 노트:

```text
이 앱은 QR 방 생성 후 다른 기기가 방 코드 또는 QR로 참여해 테스트할 수 있습니다.
로그인 없이도 “로그인 없이 마루랑 놀기”로 주요 게임 흐름을 테스트할 수 있습니다.
계정 기능 테스트가 필요한 경우 카카오/LINE/Google/Apple 로그인 중 하나를 사용할 수 있습니다.
계정 삭제는 로그인 후 “내 기록” 팝업 하단의 “계정 삭제” 버튼에서 가능합니다.
```

## 4. Google Play Console 입력 초안

앱 카테고리:

```text
Games / Casual
```

데이터 보안 요약:

```text
수집 데이터: 닉네임, 로그인 식별자, 이메일 또는 대체 이메일, 게임 결과/승률 기록
사용 목적: 계정 관리, 게임 기록 저장, 실시간 게임 진행
제3자 공유: Supabase 및 로그인 제공자 인증 처리
계정 삭제: 앱 내 계정 삭제 및 공개 계정 삭제 안내 URL 제공
```

## 5. 제출 전 실제 기기 테스트

- iPhone 실제 기기에서 QR 스캔, 카메라 권한, OAuth 리다이렉트 확인
- Android 실제 기기에서 QR 스캔, OAuth 리다이렉트 확인
- 카카오/LINE/Google/Apple 로그인 각각 1회
- 게스트 모드 3명 게임
- 한판 더 초대
- 계정 삭제 후 재로그인 및 기록 삭제 확인
- 네트워크 약한 상태에서 재접속/중복 참가자 정리 확인

## 6. 남은 수동 작업

- Apple Developer Program 활성화
- Apple Sign In Service ID와 iOS Bundle ID 최종 확인
- Google Play 개발자 계정 생성
- 앱 아이콘 1024x1024, Android adaptive icon, 스플래시 이미지 제작
- 스토어 스크린샷: iPhone 6.7인치, iPhone 6.5인치, Android phone 기준
- 앱 심사용 연락처와 지원 URL 확정
