# MARU RPS V1.0_JP — JP-BL-022 기술적 추적가능성 (HIKARI 핸드오프)

작성 2026-09-02 · CRIS · **READ/ANALYZE only — 코드·DB 변경 없음**
근거: 저장소 정적 분석(스키마·마이그레이션·Edge Function·클라이언트) + JP-02 F 검증 증거.
Tokyo 운영 데이터에 삭제를 실행하지 않았다. **법적 판단은 하지 않는다.**

## 1. 결정적 사실 3가지

1. **`participants` 에는 사용자 식별 컬럼이 없다.** 스키마 전체에서 FK 는 3개뿐이다:
   `participants.room_id → rooms.id`, `user_game_stats.user_id → auth.users`,
   `user_game_history.user_id → auth.users`. participants ↔ auth 연결은 **존재하지 않는다.**
   (`20260827004000_jp_v1_rls_target.sql` 주석도 "participants 에 소유자 식별 컬럼이 없다"고 명시)

2. **`participants.id` 는 타임스탬프에서 만든다** — 호스트 `h_<Date.now()>`, 참가자 `p_<Date.now()>`.
   auth 신원에서 파생되지도, 매핑되지도 않는다.

3. **삭제 후 라이브 DB 에는 역추적 경로가 남지 않는다.** 상관을 만들 수 있던 두 테이블
   (`user_game_stats.display_name`, `user_game_history.room_id`)이 **CASCADE 로 함께 사라지기 때문이다.**
   즉 상관 정보는 삭제 **이전에만** 존재한다.

## 2. 삭제 흐름 (실제 코드)

```
사용자 확인(showConfirmPopup)
 → db.auth.getSession() → access_token
 → Edge Function `delete-account` (Authorization: Bearer)
 → admin.auth.getUser(token)            [세션 검증]
 → admin.auth.admin.deleteUser(user.id) [하드 삭제]
 → 클라이언트: signOut + localStorage 3키 제거
   (rpsAuthState / rpsNickname / rpsAccountStatsCache)
```
Edge Function 은 participants 를 건드리지 않는다. 로그 출력도 없다.

## 3. 삭제 후 상태

| 대상 | 삭제 후 | 근거 |
|---|---|---|
| `auth.users` | 삭제 | `deleteUser` |
| `user_game_stats` (display_name 포함) | **CASCADE 삭제** | FK on delete cascade |
| `user_game_history` (user_id, room_id) | **CASCADE 삭제** | FK on delete cascade |
| `participants` (name = 닉네임) | **잔존** | FK 없음 |
| `rooms` | 잔존 | — |
| `rpsRecentRoomCodes:authed` (기기) | **잔존** | 삭제 루틴이 제거하지 않음 |
| `rpsQAReport.v1` (기기, opt-in) | **잔존** | 삭제 루틴이 제거하지 않음 |

## 4. 식별자 분류

| IDENTIFIER | STORAGE | 삭제 후 잔존 | 직접 링크 | 간접 재식별 | 보존 이유 | 익명화/삭제 효과 | 엔지니어링 영향 |
|---|---|---|---|---|---|---|---|
| auth user UUID | `auth.users`, JWT | 아니오 | 직접 | NONE | — | 이미 제거 | 없음 |
| `user_game_stats.display_name` | DB | 아니오(CASCADE) | 직접 | NONE | — | 이미 제거 | 없음 |
| `user_game_history.user_id`+`room_id` | DB | 아니오(CASCADE) | 직접 | NONE | — | 이미 제거 | 통계 화면 공백 |
| **`participants.name` (닉네임)** | DB | **예** | 없음 | **MEDIUM** | 방 기록 무결성 | 치환 시 표시명만 변경 | 진행 중 방에 표시 변화 |
| `participants.id` (`p_<ms>`) | DB | 예 | 없음 | LOW | 행 PK | 삭제 시 라운드 집합 변동 | CORE 영향 |
| `participants.created_at` | DB | 예 | 없음 | LOW | 정렬·RLS 창 | — | 없음 |
| `rooms.id` (4자) | DB | 예 | 없음 | LOW | 방 식별 | — | — |
| `rpsRecentRoomCodes:authed` (code+nickname+participantId) | 기기 localStorage | **예** | 없음 | **MEDIUM(기기 보유자 한정)** | 재입장 UX | 제거 가능·CORE 무영향 | 없음 |
| `rpsQAReport.v1` | 기기 localStorage | 예(opt-in 시) | 없음 | LOW/UNKNOWN | QA 계측 | 제거 가능 | 없음 |
| Supabase Auth/플랫폼 로그 | 플랫폼 | **UNKNOWN** | UNKNOWN | UNKNOWN | 플랫폼 정책 | 저장소로 확인 불가 | — |
| 백업/PITR | 플랫폼 | **UNKNOWN** | UNKNOWN | UNKNOWN | 플랫폼 정책 | 저장소로 확인 불가 | — |

## 5. 닉네임 재식별 분석 (핵심)

**닉네임은 임의 입력이 아닐 수 있다.** SNS 로그인 시:

```js
const name = meta.full_name || meta.name || meta.preferred_username
  || (user.email || "").split("@")[0] || "";
if (name && !loadNickname()) saveNickname(name);
```

즉 기본 닉네임이 **SNS 실명** 또는 **이메일 로컬파트**가 될 수 있고, 그 값이
방 생성/참가 시 `participants.name` 으로 기록된다. 사용자가 바꾸지 않으면 그대로 남는다.

**노출 범위:** `jp_participants_select` 는 `using (true)` 다 — 잔존 닉네임은
**anon 키만 있으면 누구나, 기간 제한 없이 조회 가능**하다(단순 보관이 아니다).

닉네임을 일반값으로 치환하면 남는 것: `id`(타임스탬프), `room_id`, `created_at`,
`is_host`, `choice`, 전적 카운터, `is_ready`, `leave_after_round`.
이들만으로 개인을 특정하려면 **외부 지식**(그 시각 그 방에 누가 있었는지)이 필요하다.

## 6. 선택지별 기술적 결과

**A 현행 유지** — 변경 없음. 닉네임(실명일 수 있음)이 공개 조회 가능 상태로 잔존.

**B 익명화** — ⚠️ **현재 구조로는 온전히 구현할 수 없다.**
삭제 시점에 "이 사용자의 participants 행"을 특정할 방법이 없다(2·3절).
가능한 것은 근사치뿐이며 각각 결함이 있다:
- `user_game_stats.display_name` / `user_game_history.room_id` 로 매칭 → **CASCADE 로 이미 사라진 뒤**라
  반드시 삭제 **이전에** 수행해야 한다.
- 닉네임 문자열 매칭 → **동명이인·게스트의 행을 잘못 수정**할 수 있다(닉네임은 고유하지 않다).
- 기기의 `rpsRecentRoomCodes:authed` 사용 → 그 기기가 기억하는 최근 20개뿐, **불완전**.
- RLS `jp_participants_update` 는 **24시간 이내 행만** 허용 → 그보다 오래된 행은
  service_role(Edge Function)이라야 수정 가능.

**C 행 삭제** — B 의 특정 문제를 그대로 안고, 추가로 **CORE 판정 집합이 바뀐다**
(진행 중 라운드의 참가자 수·승패 계산). `jp_participants_delete` 도 24시간 창 제약을 받는다.

## 7. UNKNOWN / PLATFORM-LEVEL

저장소 증거로 확정할 수 없는 항목(추정하지 않는다):
- Supabase Auth 내부 로그의 삭제 사용자 잔존 여부·보존기간
- Edge Function 호출 로그의 내용·보존기간
- 대시보드 로그 보존기간
- 자동 백업 / PITR 의 보존기간과 삭제 반영 여부

저장소에는 백업·복원 스크립트나 문서화된 백업 경로가 **없다**(`scripts/` 확인).

## 8. HIKARI 로 되돌리는 질문

1. 삭제 **이전에** 익명화를 수행하는 방식(삭제 트랜잭션에 선행 단계 추가)이 법적으로 요구/허용되는가.
2. 닉네임 매칭으로 **타인 행을 잘못 수정할 위험**을 감수할 수 없다면, 불완전한 익명화는 허용되는가.
3. 플랫폼 백업/로그(위 7절 UNKNOWN)는 삭제 의무 범위에 포함되는가 — 포함된다면 Supabase 플랫폼 확인이 필요하다.
4. 기기 로컬 잔존(`rpsRecentRoomCodes:authed`)도 삭제 대상인가. (이는 CORE 영향 없이 제거 가능하다.)
