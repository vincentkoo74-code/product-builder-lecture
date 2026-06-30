# 📐 DESIGN RULES (HQ Knowledge Base)

> WES v2 §12. 종결 이슈에서 도출한 재사용 설계 규칙. 차기 프로젝트(MaruSnap/Gourmet/FitFlow) 재사용.
> 상세 근거는 `LESSONS_LEARNED.md`.

| DR | 규칙 | 근거 |
|---|---|---|
| DR-1 | Countdown = 서버 timestamp + 충분한 lead. 클라이언트 로컬 시계를 시작/순서 판단에 쓰지 않는다. | WRPS-015/047 |
| DR-2 | Clock offset은 sub-second 정밀. 초단위 소스(HTTP Date)는 +500ms 중앙보정 또는 RTT 롤링 중앙값(last-N). | WRPS-047 |
| DR-3 | lead > 애니메이션 대기 캡. 빠른 단말이 공유 startAt 전에 시작 금지. | WRPS-047 |
| DR-4 | Audio = event reaction + eventId/round-key dedup. 결과음/효과음은 키 기반 1회. | WRPS-046/048 |
| DR-5 | 2회 호출 가능한 전이(result→game_over 등)는 side-effect(통계·오디오)에 idempotency 가드. | WRPS-046/003 |
| DR-6 | 음성 단일 소스 정책(녹음/TTS 중 하나, 로케일 분리). MP3 매핑 이벤트는 TTS 금지. | WRPS-045 |
| DR-7 | 런타임 UI/오디오/동기화 결함은 단위테스트가 못 잡는다 → 순수 로직 분리 + event-sourced 엔진 결정론 시뮬, 나머지는 실기기 QA. | WRPS-049 |
| DR-8 | 라이브 RC는 Strangler Fig로만 전환(추가 모듈+flag OFF+섀도우 후 점진). big-bang 금지. | WRPS-049 |
| DR-9 | 권위자가 라운드 비참가일 때도 라운드 종료 트리거 이중화(전원 완료 즉시 + 서버시각 백스톱). | WRPS-026 |
| DR-10 | Device-gated 결함은 (계측 빌드 → 자동 메트릭 Analyzer → Gate 평가) 파이프라인으로 Evidence 기반 확정. 추측 분석 금지. | WRPS-026/036, WES Sprint |
