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
| DR-6 | 음성 단일 소스 정책(녹음/TTS 중 하나, 로케일 분리). MP3 매핑 이벤트는 TTS 금지.<br>**TTS 예외 도입 후 폐기(Build19→Build19-B, WRPS-052-B19)**: 최초 "mp3에 이미 풀구호가 녹음돼 있다"는 06-26/28 청취 기록을 신뢰해 TTS 교체를 반대했으나, 2026-07-08 whisper(OpenAI) 전사로 `ASSETS/rps/voice/ko/` 14개 파일 전체를 실제 확인한 결과 **"안 내면 술래 가위바위보!!" 문구를 담은 파일이 애초에 존재하지 않음**이 확정되어(`ko_game_start.mp3`="게임을 시작합니다." — 전혀 다른 문구) `intro`(ko) 1개 이벤트에 한해 TTS_OVERRIDE로 mp3보다 우선하도록 도입했었다. **이후 사용자가 기존 단어별 녹음(`ko_scissors/rock/paper.mp3`="가위"/"바위"/"보", `ko_game_ready.mp3`="준비")의 실제 내용을 직접 청취로 확인** → TTS를 완전히 제거하고, 4개 검증된 사람 목소리 파일을 카운트다운에서 순차 재생(준비→가위→바위→보)하는 방식으로 대체(DR-6 위반 없음 — 전부 mp3, TTS 미사용). "안 내면 술래…" 풀구호 자체는 여전히 사람 목소리로 존재하지 않으므로, 신규 MC 녹음이 준비되면 `ko_game_start.mp3`류 단일 파일 방식으로 재전환 검토 가능(현재 backlog). | WRPS-045, WRPS-052-B19 |
| DR-7 | 런타임 UI/오디오/동기화 결함은 단위테스트가 못 잡는다 → 순수 로직 분리 + event-sourced 엔진 결정론 시뮬, 나머지는 실기기 QA. | WRPS-049 |
| DR-8 | 라이브 RC는 Strangler Fig로만 전환(추가 모듈+flag OFF+섀도우 후 점진). big-bang 금지. | WRPS-049 |
| DR-9 | 권위자가 라운드 비참가일 때도 라운드 종료 트리거 이중화(전원 완료 즉시 + 서버시각 백스톱). | WRPS-026 |
| DR-10 | Device-gated 결함은 (계측 빌드 → 자동 메트릭 Analyzer → Gate 평가) 파이프라인으로 Evidence 기반 확정. 추측 분석 금지. | WRPS-026/036, WES Sprint |
| DR-11 | 새 Sprint/Build 시작 전 환경 자동 사전점검(pwd·branch·working tree·origin 동기화·쓰기권한·remote). 하나라도 비정상이면 Build 시작 금지. | Build15 EPERM 중단, WES |
| DR-13 | 참가자 lifecycle side-effect(입퇴장 오디오/리스트)는 per-device local diff가 아닌 authoritative 이벤트에서 파생 (제안). | WRPS-055 |
| DR-14 | Room participant set 변경 = 새 game session(참가자 서명으로 기록 분리). | WRPS-056 |
| DR-15 | 대기/탈락(waiting/disqualified) player는 다음 유효 라운드까지 UI-passive. | WRPS-053 |
| DR-16 | 오디오는 모든 기기에서 event-covered·deduped·metric-visible (제안). | WRPS-051/052/055/057 |
| DR-17 | 게임 신뢰를 위해 앱 viewport를 잠근다(user-scalable=no, touch-action). | WRPS-063 |
| DR-18 | OAuth return은 정확한 game context 복원 또는 명시적 실패 (제안). | WRPS-050 |
| DR-12 | QA 계측 자동화: 앱은 QA 빌드에서 세션 자동 시작·게임/방 종료 시 자동 스냅샷·`__qaMetrics.export()`로 표준 입력 산출. BUILD_MANIFEST로 Evidence 출처를 식별. 사용자는 플레이만. | Build16, WES |
