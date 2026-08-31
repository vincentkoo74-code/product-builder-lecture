# Build45 — 버튼 지오메트리 통일 + 내기록 실패 진단성 (2026-09-01, Vincent 지시)

## 문제 1: 내기록 "기록 불러오기 실패" — 근본원인 (추가 분석 결과)

**단일 근본원인 재확정(2026-09-01 라이브 실측):** Seoul(`sannrfmhevebqgfdqcps`)의
`user_game_stats` / `user_game_history` 두 테이블에 **GRANT 미적용** — PostgREST가 RLS 평가에
도달하기 전에 거부한다.

```
GET /rest/v1/user_game_stats   → 42501 "permission denied for table user_game_stats"
GET /rest/v1/user_game_history → 42501 "permission denied for table user_game_history"
GET /rest/v1/rooms             → 42703 (컬럼명 오류 = 권한 관문은 통과, 대조군 정상)
```

- 클라이언트 코드 결함 아님: `showAccountStatsPopup()`은 로그인 가드 → `getUser()` →
  두 쿼리 병렬 → 에러 시 실패 렌더. 경로 자체는 정상이며 서버가 42501 로 거부한다.
- RLS 정책 5개는 존재. **GRANT(접근 관문)와 POLICY(row 필터)는 별개** — 20260528205753 이
  raw SQL 로 테이블을 만들면서 GRANT 를 한 줄도 주지 않았다.
- 수정본은 이미 준비됨: `supabase/migrations/20260824021500_account_game_stats_grants.sql`
  (authenticated 에 최소 권한 + 시퀀스 USAGE + 자기검증 + anon 누출 방지 검증 포함).
- **로컬에서 적용 불가**(자격증명 전무 · Seoul 변경은 Dashboard 경유 원칙). 적용 경로 2택:
  1. Dashboard SQL Editor 에 위 마이그레이션 파일 붙여넣기 → 실행
  2. 터미널에 `! supabase login` 후 요청(준비된 apply 스크립트로 원격 적용)
  적용 후 검증: scratchpad `seoul-stats-grant-verify.sql` → 6 true + anon false,
  실기기 "내 기록" 팝업 정상.
- **클라이언트 보조 수정(이번 빌드):** 실패 렌더에 `[에러코드]` 를 함께 표기 —
  필드 스크린샷만으로 42501(권한) vs 기타(네트워크 등)를 즉시 식별한다.
  계약: `tests/build45-account-stats-error-code.test.mjs`.

## 문제 2: 버튼 지오메트리 통일

### 실측 근거 (360×732, 67버튼 감사)
| 항목 | BEFORE | AFTER |
|---|---|---|
| btn-kparty 높이 | 46.8/48/56/60/62.4/64.4px | 52(표준)/48(그리드)/56(QR 예외) |
| btn-outline.btn-full 높이 | 48/56/58/60/64.4px | 52/48 (+2줄 성장시 60) |
| 변형 버튼 font-size | 14/15/16px 혼재 | **15px 단일(44/44개)** |
| 버튼 간 간격 | 인라인 4/8/10/12/16px 혼재 | **var(--action-gap)=10px 단일(14곳 토큰화)** |
| 그리드 내부 버튼 | finalResultBtns 만 48px 표준 | action-grid/footer-actions/lobby grid 까지 48px 일원화 |

### 계약 (tests/build45-ui-button-unify.test.mjs, 14 tests)
- 토큰 `--btn-h:52px`(단일행 표준, sns-btn 실측과 정렬) / 간격은 기존 `--action-gap:10px` 로 통일.
- 변형 그룹 규칙(`.btn-kparty/.btn-primary/.btn-success/.btn-light/.btn-outline/.btn-danger`):
  `min-height:var(--btn-h)` + 세로 패딩 12px + fs15 + line-height 1.25. 모든 개별 정의·미디어
  오버라이드보다 **뒤**에 위치(캐스케이드 승리, 순서를 테스트가 고정). 협폭 미디어는 가로 패딩만 조정.
- 2열 액션 그리드 압축 표준(48px, padding 12px 10px): `#finalResultBtns>button`(기존) +
  `.compact-action-grid>button`(기존) + **`.action-grid>button`/`.footer-actions>button`/**
  **`#screenLobby .grid>button`(신규 일원화)**. confirmPopup CTA 도 전용 56px → 표준 토큰.
- 버튼 인라인 margin 픽셀값 금지(전부 `var(--action-gap)`), `.compact-action-grid` gap 도 토큰.
- 명시 예외(회귀 방지 핀): `.qr-direct-row .btn-kparty` 56px(코드 입력 높이 매칭) ·
  `.btn-quiet`/원형 아이콘류 44px(터치 최소, build35 계약) · `choice-button`(게임 대형 버튼) ·
  `quick-btn`(아이콘+라벨 2단). 긴 라벨의 2줄 성장(60px)은 허용 — 텍스트 삭제 금지 원칙(build42 결정 2).

### 검증
- 신규 계약 14/14 + 영향 스위트(build35/38/39/41/42) 115/115 GREEN — 지오메트리·fold 예산 계약 유지.
- 실렌더 재감사: 변형 버튼 fs 15px 100%, 높이 분포 {52:25, 48:13, 56:1(예외), 60:5(2줄 성장)}.
