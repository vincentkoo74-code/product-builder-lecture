# MARU RPS V1.0_JP — Local Stack Validation (2026-08-28)

실제 **PostgREST** 를 통한 JP 백엔드 재현 검증. 추가 클라우드 비용 **0원**.
라이브 Tokyo(`cmfxhehpreanijwanwrr`)·KR(`sannrfmhevebqgfdqcps`) **무변경**.

## 0. 환경 — 무엇을 세웠고 무엇을 못 세웠는가

CEO 지시는 "로컬 Supabase **풀스택**"이었다. 부분 달성이다.

| 구성요소 | 상태 |
|---|---|
| PostgreSQL 17.11 | ✅ 로컬 격리 클러스터 (포트 55432) |
| **PostgREST 16.2** | ✅ **실제 서비스 구동** (포트 3999) — 이번 세션의 핵심 성과 |
| GoTrue / Auth | ⚠️ 미구동. 대신 **PostgREST 가 서명을 검증하는 실제 HS256 JWT** 를 로컬 발급해 사용 |
| Realtime | ❌ **미구동 — 검증 못 함** |
| Kong / Storage / Studio | ❌ 미구동 (이번 검증에 불필요) |

### 왜 풀스택이 아닌가 — 회선 대역폭

Colima(오픈소스) + Docker CLI 설치는 성공했으나 **VM 디스크 이미지 다운로드가 진행되지 않았다.**
실측 대역폭이 **~55 KB/s** 다(호스트 무관, 회선 상한).

```
cloud-images.ubuntu.com  1.6 MB / 30초 = 54,605 B/s
api.supabase.com                        = 74,901 B/s
```

| 필요 | 용량 | 소요 |
|---|---|---|
| Colima VM 이미지 | ~500 MB | ~2.6 시간 |
| Supabase 스택 이미지 7종 | ~3 GB | ~15.5 시간 |
| **합계** | ~3.5 GB | **~18 시간** |

세션 내 불가능하다고 판단해, **가장 큰 검증 공백이었던 PostgREST**(단일 바이너리, Homebrew bottle)
를 우선 확보했다. Realtime 은 Elixir/BEAM 런타임이 필요해 Docker 없이는 실용적이지 않다.

**추가 비용: 0원.** 설치물 전부 오픈소스(Colima, Docker CLI, PostgreSQL 17, PostgREST 16.2).

## 1. 프로덕션 안전

- 저장소가 JP 프로덕션(`cmfxhehpreanijwanwrr`)에 **링크되어 있었다.** `--db-url` 없는 CLI 명령이
  프로덕션을 겨냥할 수 있는 상태였다. `supabase/.temp/` 를 **삭제하지 않고 백업 2부와 함께 이동**해
  격리했고, `supabase db push --dry-run` 이 `LegacyProjectNotLinkedError` 로 실패함을 확인했다.
- 모든 CLI mutation 은 `--db-url postgresql://postgres@127.0.0.1:55432/...` 로만 수행했다.
- 프로덕션 자격증명·PAT·service_role 키는 애플리케이션 검증에 **일절 사용하지 않았다.**
  로컬 JWT 시크릿은 무작위 신규 생성.

## 2. Clean bootstrap & 원장

`supabase db push --db-url <local> --include-all` → 9종 순서대로 적용, 원장 9행.

```
20260101000000 jp_v1_baseline_rooms_participants
20260528205753 account_game_stats
20260726104300 server_now_rpc
20260806013625 participants_leave_after_round
20260827002000 jp_v1_participants_room_id_index
20260827003000 jp_v1_grants_least_privilege
20260827003500 jp_v1_created_at_immutable
20260827004000 jp_v1_rls_target
20260827005000 jp_v1_realtime_publication
```

**완전 재구축**: DB 를 드롭하고 저장소만으로 재생성 → 최초본과 대조
테이블 4 / 정책 12 / 인덱스 5 / 트리거 2 / realtime 2 / 함수 2 / 원장 9 **전부 일치**,
스키마 해시 `bb88515fc5279c5888bbbf0ab1d51bdc` **동일**. 대시보드 개입 0회.

## 3. PostgREST — 실제 HTTP

### anon ALLOW (8/8)
`rooms` INSERT 201·SELECT 200·UPDATE 200 / `participants` INSERT 201 ×2·SELECT 200(2행)·
UPDATE 200·DELETE 200 / `rpc/server_now` 200 (epoch ms 반환)

### anon DENY (4/4) — GRANT 부재는 **오류로 드러난다**
| 시도 | 응답 |
|---|---|
| `DELETE /rooms` | **401** `{"code":"42501"}` |
| `GET /user_game_stats` | **401** `42501` |
| `GET /user_game_history` | **401** `42501` |
| `POST /user_game_history` | **401** `42501` |

## 4. ⛔ JP-BL-027 — 무음 RLS 거부 (이번 세션 최대 발견)

**RLS 거부는 HTTP 수준에서 성공과 구별되지 않는다.**

| 요청 | 응답 |
|---|---|
| 정상 행 `PATCH` (supabase-js 기본, Prefer 없음) | **204, 0바이트, error=null** |
| RLS 로 가려진 행 동일 요청 | **204, 0바이트, error=null** |
| `Prefer: return=representation` | 1행 vs **0행** |
| `Prefer: count=exact` | `0-0/1` vs **`*/0`** |

만료 방에 대한 7종 게임 상태 write 전부 **HTTP 200 + `[]`**:
status 전이 / round 증가 / choice / ready / host 승계 / 퇴장 예약 / 참가자 삭제.
DB 대조 확인: `OLDR status=waiting`(미반영) vs `AAAA status=ready`(반영).

### 클라이언트는 이를 탐지하지 못한다

`updateRoomStatus`·`updateRoomStatusScheduled`·`updateParticipantChoice`·`_doLeaveRoom` 은
**맨몸 await** 로 `error` 조차 보지 않는다. `markReady` 는 그 위에 `me.is_ready = true` 로
**낙관적 갱신 후 렌더**한다 → UI 는 ready, DB 는 not ready. `reserveDeferredLeave`·`nextRound` 는
`error` 만 검사한다. `promoteParticipantToHost` 만 검증 재조회로 **이미 보호**된다.

상세와 수정 시도 경위는 `JP_RELEASE_BACKLOG.md` JP-BL-027 참조.

## 5. Auth — 실제 JWT 소유권 격리

PostgREST 가 HS256 서명을 검증하는 실제 토큰으로 검증(GoTrue 미구동, §0).

| 시도 | 결과 |
|---|---|
| U1 본인 stats INSERT / UPDATE / SELECT | 201 / 200(1행) / 200(1행) |
| U1 본인 history INSERT | 201 |
| **U2 가 U1 stats 조회** | 200 **0행** |
| **U2 가 U1 history 조회** | 200 **0행** |
| **U2 가 U1 stats 변조** | 200 **0행** |
| **U2 가 U1 명의로 INSERT** | **403** `42501` |
| anon 이 stats 조회 | **401** `42501` |

## 6. 게스트 게임 플로우 — 실제 REST 17단계

방 생성 → A 참가 → B 방조회 → B 입장 → 목록(2행) → 벌칙·로비 → ready(2행) → 시작 초기화(2행) →
A 선택 → B 선택 → 판정·전적 → 다음 라운드 → 퇴장 예약 → 예약 퇴장 처리 → 호스트 승계 →
방 종료 → 참가자 정리. **전 단계 정상, 영향 행 수 모두 기대치 일치.**

## 7. Realtime — **검증 못 함**

publication 멤버십(`supabase_realtime` 에 `rooms`·`participants`)은 확인했으나,
**실제 이벤트 전달은 검증하지 못했다**(§0). 이번 세션의 가장 큰 잔여 공백이다.

## 8. GRANT (실행 중인 스택 실측)

```
participants | anon/authenticated/service_role | DELETE,INSERT,SELECT,UPDATE
rooms        | anon/authenticated             | INSERT,SELECT,UPDATE      (DELETE 없음)
rooms        | service_role                   | DELETE,INSERT,SELECT,UPDATE
user_game_history | authenticated             | INSERT,SELECT
user_game_stats   | authenticated             | INSERT,SELECT,UPDATE
```
**과잉 권한(TRUNCATE/REFERENCES/TRIGGER/MAINTAIN) 보유 건수: 0**

`.select()` 오판 위험도 확인했다 — `rooms`/`participants` 의 SELECT 정책이 `using(true)` 로
UPDATE 보다 넓고, 계정 전적 테이블도 본인 행은 통과한다. 정상 write 가 0행으로 오판되지 않는다.

## 9. created_at 불변성 (실제 REST)

INSERT 로 `2099-01-01` 주입 → `2026-08-28T00:13:42` / UPDATE 로 주입 → **불변**(status 만 변경).
불멸 행(immortal room) 생성 차단 확인.

## 10. 24시간 경계 3구간

| 방 | `Content-Range` |
|---|---|
| 최근(AAAA) | `0-0/1` 허용 |
| 만료 10분 전(NEAR) | `0-0/1` 허용 |
| 25시간 경과(OLDR) | **`*/0` 거부** |

경계 동작이 설계대로다. 단 이 거부가 §4 의 무음 실패 경로를 탄다.

## 11. 멱등성 / 롤백

- 원장 재실행 → `upToDate: true`
- 직접 재실행 9종 → 오류 0
- 롤백(문서 절차 역순) → 정책 7(allow-all 2 복구)·트리거 0·인덱스 0·realtime 0·**데이터 보존**
- 전진 복구 4종 → 전부 성공, 스키마 일치, 최종 정책 12·allow_all 0

## 12. 잔여 프로덕션 위험

| 위험 | 상태 |
|---|---|
| **JP-BL-027 무음 거부** | **실증됨. 클라이언트 미탐지. 미수정** |
| **Realtime 실제 전달 미검증** | Docker 부재 |
| GoTrue 실제 발급 토큰 미검증 | 서명 검증 경로는 실제 PostgREST 로 확인 |
| 실기기 회귀 미수행 | 24시간 경계·장시간 백그라운드 재개 |
| Tokyo `--include-all` 필요 | baseline 이 원장 최초 항목보다 앞섬 |
| 계정 전적 service_role 회수 | 라이브 첫 적용 시 실제 회수 발생 |
| free plan 자동 일시정지 | JP-PROD-GATE 미해소 |
