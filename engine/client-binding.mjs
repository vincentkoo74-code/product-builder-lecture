// engine/client-binding.mjs
// "dumb client" 계약 — 클라이언트가 지켜야 할 구조를 코드로 고정한다.
//   CLIENT = input forwarder + state subscriber(render) + audio event-reaction. 게임 로직 0.
//
// 권위 모델(현 단계, host-authoritative):
//   - 호스트가 유일한 seq 권위. 입력을 이벤트로 만들어 transport.broadcast → 모두(자신 포함) ingest.
//   - 참가자는 로컬 상태를 바꾸지 않고 transport.sendIntent로 의도만 전달 → 호스트가 이벤트화.
//   - 모든 복제본(호스트/참가자 엔진)은 ingest(중복=eventId, 순서=seq)로 동일 상태에 수렴.
// 서버 권위 전환 시: 호스트 자리에 서버가 들어가고 동일 바인딩이 그대로 동작(코드 무변경).
//
// transport 계약(주입):
//   broadcast(ev): void            // 권위 → 모두에게 이벤트
//   onEvent(fn): () => void          // 이벤트 수신 구독
//   sendIntent(intent): void         // 참가자 → 권위 의도
//   onIntent(fn): void               // 권위만: 의도 수신

import { createEngine, EVENT_TYPES, makeEvent } from './index.mjs';
import { engineStateToView, audioEventsToSounds } from './adapters/supabase.mjs';

export function createClient({
  myId,
  isHost = false,
  transport,
  render = () => {},
  playSound = () => {},
  now = () => 0,
}) {
  const engine = createEngine({ now });
  const playedAudio = new Set(); // 클라이언트 측 재생 멱등(엔진 dedup과 이중 안전망)
  let hostSeq = 0;

  // 엔진 상태 변화 → 렌더(뷰모델만) + 오디오(이벤트 반응만)
  engine.subscribe((state) => {
    render(engineStateToView(state, myId));
    for (const s of audioEventsToSounds(state.audioEvents, myId, state, playedAudio)) {
      playedAudio.add(s.dedup);
      playSound(s.key, s.dedup);
    }
  });

  // 전송 계층에서 도착한 권위 이벤트 → ingest(순서/중복은 엔진이 처리)
  transport.onEvent((ev) => engine.ingest(ev));

  // 권위(호스트)만: 입력/의도를 이벤트로 변환해 브로드캐스트(자신도 onEvent로 ingest)
  function emit(type, payload, actorId) {
    transport.broadcast(makeEvent(type, payload, { seq: hostSeq++, ts: now(), actorId }));
  }
  if (isHost && transport.onIntent) {
    transport.onIntent((intent) => emit(intent.type, intent.payload, intent.from));
  }

  // 클라이언트 입력 단일 진입점 — 로컬 상태 변이 절대 없음
  function input(type, payload = {}) {
    if (isHost) emit(type, payload, myId);
    else transport.sendIntent({ from: myId, type, payload });
  }

  return {
    engine,
    input,
    getView: () => engineStateToView(engine.getState(), myId),
    // 결정론 검증용(서버 복구/디버그)
    verifyReplay: () => JSON.stringify(engine.replay()) === JSON.stringify(engine.getState()),
  };
}

export { EVENT_TYPES };
