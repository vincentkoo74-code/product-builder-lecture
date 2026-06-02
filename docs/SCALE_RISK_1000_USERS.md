# 1000명 동시접속 리스크 분석

목표: 한 방 1000명이 아니라, 여러 게임방 합산 1000명 동시 사용자가 들어와도 앱 진행이 깨지지 않도록 구조를 단순화한다.

## 현재 구조 요약

- 클라이언트는 Supabase Realtime 구독과 3초 polling fallback을 함께 사용한다.
- 방 상태는 `rooms.status`, `rooms.round`, `rooms.penalty`가 중심이다.
- 참가자 상태는 `participants.choice`, `participants.is_ready`, `participants.is_host`가 중심이다.
- 게임 판정은 주로 호스트 클라이언트가 트리거한다.

## 가장 큰 리스크

| 리스크 | 영향 | 현재 완화 | 추가 권장 |
|---|---|---|---|
| 모든 클라이언트 3초 polling | 사용자 수가 늘면 DB 읽기 급증 | Realtime 병행 | polling 간격을 상황별로 늘리거나 host-only polling으로 축소 |
| 호스트 클라이언트 판정 의존 | 호스트 폰이 잠기거나 느리면 진행 지연 | 자동/수동 판정 버튼 | 판정 Edge Function 또는 DB RPC로 이전 |
| 참가자 row 전체 조회 | 방 인원이 많으면 매번 전체 목록 전송 | 방 단위 필터 | 필요한 컬럼만 select, 페이지/요약 테이블 분리 |
| 빠른 중복 클릭 | 중복 참가자/중복 ready | 중복 프로필 정리 | DB unique index `(room_id, name)` 검토 |
| Realtime + polling 경합 | 화면 전환 순서가 기기별로 달라짐 | sequence guard 일부 있음 | 상태 전이를 단일 함수/서버 트리거로 통일 |
| 한 방 대규모 인원 | QR 파티 앱 UX와 DB 부하 모두 악화 | 없음 | 방당 권장 최대 20~50명 제한 |

## 1000명 대응 기준

현실적인 기준은 다음과 같다.

- 방 50개 x 방당 20명 = 1000명
- 방 100개 x 방당 10명 = 1000명

한 방 1000명은 현재 UI/Realtime/판정 구조에 맞지 않는다.

## 구조 단순화 제안

### 1. 방 상태 전이 테이블화

허용 상태:

```text
waiting -> ready -> playing -> result -> lobby|stats|reinviting
```

모든 상태 변경은 `setRoomStatus(nextStatus, reason)` 하나로 통과시킨다.

### 2. 클라이언트 트리거 축소

현재 여러 클라이언트가 같은 이벤트를 보고 렌더/판정/자동시작을 시도한다. 다음 원칙으로 줄인다.

- DB 쓰기는 호스트 또는 서버 함수만 한다.
- 참가자는 자기 row만 쓴다.
- 결과 판정은 서버 함수 또는 호스트 단일 트리거만 한다.
- 참가자 기기는 화면 표시와 자기 선택만 담당한다.

### 3. Polling 정책 변경

권장:

- Realtime 연결 정상: polling off
- Realtime 미연결: 8~10초 fallback
- `playing` 중 선택 대기: 호스트만 2~3초 polling
- 참가자 화면은 Realtime 우선, 필요 시 수동 새로고침 버튼

### 4. DB 제약 추가 후보

출시 직전 적용 후보:

```sql
create unique index if not exists participants_room_name_unique
on public.participants(room_id, lower(name));
```

주의: 기존 중복 데이터 정리 후 적용해야 한다.

### 5. 방 정리 정책

완료된 방은 다음 중 하나로 명확히 분리한다.

- `rooms.status = 'archived'`로 soft delete
- 참가자 rows 삭제, 방 row 유지
- 방 row까지 삭제하되 최근 기록은 별도 테이블에 저장

현재 앱의 “한판 더”는 마지막 호스트가 과거 방을 다시 열 수 있어야 하므로, 완전 삭제보다는 `archived/reinviting` 모델이 더 안전하다.

## 리팩터링 우선순위

1. `game-engine.js`: 승패 판정 순수 함수 분리
2. `room-repository.js`: Supabase 읽기/쓰기 함수 분리
3. `room-state-machine.js`: 상태 전이 단일화
4. `renderers/`: 화면별 렌더 함수 분리
5. `realtime.js`: Realtime과 polling 정책 분리

## 출시 전 결론

현재 앱은 소규모 파티 게임 기준으로 충분히 동작한다. 1000명 동시 사용자를 목표로 할 경우 “여러 방 합산 1000명” 기준으로 설계해야 하며, 출시 후 트래픽이 생기면 polling 축소와 서버 판정 이전이 최우선이다.
