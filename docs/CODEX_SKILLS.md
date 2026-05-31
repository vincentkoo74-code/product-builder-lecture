# Codex Skills

이 문서는 이 프로젝트에서 자주 사용할 Codex 스킬과 호출 문구를 정리합니다.

Codex 앱 메인 화면에 스킬 목록을 고정 표시할 수는 없으므로, 새 스킬을 설치하거나 자주 쓰는 작업 방식이 생기면 이 문서를 업데이트합니다.

## 자주 쓰는 스킬

| 스킬 | 언제 사용 | 호출 예시 |
| --- | --- | --- |
| `karpathy-guidelines` | 변경 범위를 좁히고, 애매한 요구를 확인하고, 검증 중심으로 작업할 때 | `karpathy-guidelines 스킬로 이 버그를 고쳐줘` |
| `investigate` | 원인 분석이 필요한 버그, 오류, 이상 동작을 디버깅할 때 | `investigate로 이 오류 원인부터 찾아줘` |
| `qa` | 웹앱을 실제로 테스트하고 발견한 문제를 고칠 때 | `qa로 배포 화면 테스트하고 문제 있으면 고쳐줘` |
| `qa-only` | 수정 없이 테스트 리포트만 받고 싶을 때 | `qa-only로 현재 앱 상태만 보고해줘` |
| `review` | 커밋/PR 전 코드 리뷰를 받을 때 | `review 스킬로 현재 diff 리뷰해줘` |
| `context-save` | 현재 작업 상태를 저장하고 나중에 이어갈 때 | `context-save로 여기까지 저장해줘` |
| `context-restore` | 이전 저장 상태를 복원해서 이어갈 때 | `context-restore로 이어서 작업하자` |
| `ship` | 변경사항을 정리해 커밋/푸시/PR 흐름으로 넘길 때 | `ship으로 이번 변경 배포 준비해줘` |
| `health` | 테스트, 린트, 품질 점검을 묶어서 볼 때 | `health로 코드 상태 점검해줘` |
| `design-review` | UI 화면의 여백, 정렬, 계층, 반응형 문제를 점검할 때 | `design-review로 모바일 화면 봐줘` |

## 이 프로젝트 추천 사용 패턴

### UI 수정

```text
karpathy-guidelines와 design-review 기준으로 작은 화면 UI 깨짐을 고쳐줘.
검증은 Android용 web asset sync까지 해줘.
```

### 게임 로직 버그

```text
investigate로 원인을 먼저 찾고, karpathy-guidelines 기준으로 최소 수정해줘.
```

### 배포 전 점검

```text
qa로 Vercel 배포 화면을 확인하고, Android cap sync까지 필요한지 점검해줘.
```

### 코드 리뷰

```text
review 스킬로 현재 diff에서 버그/회귀/테스트 누락을 찾아줘.
```

### 작업 저장

```text
context-save로 현재 결정사항과 남은 작업을 저장해줘.
```

## 로컬 설치 스킬

직접 설치한 스킬은 아래 위치에서 관리합니다.

```text
C:\Users\Vince\.codex\skills
```

현재 직접 추가한 스킬:

```text
C:\Users\Vince\.codex\skills\karpathy-guidelines\SKILL.md
```

새 스킬을 설치한 뒤에는 Codex를 완전히 종료했다가 다시 실행해야 인식됩니다.

## 운영 원칙

- 앱 로직 수정은 `karpathy-guidelines` 기준으로 작게 진행합니다.
- 버그는 가능한 한 `investigate`로 원인을 먼저 확인합니다.
- UI는 수정 후 스크린샷 또는 Android 에뮬레이터 화면으로 검증합니다.
- 배포 관련 작업은 GitHub Actions, Vercel, Supabase 상태를 함께 확인합니다.
- 새로 유용한 스킬을 설치하면 이 문서에 추가합니다.
