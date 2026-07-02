// EventBus — 결정론적 이벤트 전달
//  - 중복 이벤트(eventId 동일) 무시
//  - 순서 보장: sequenceId 기준. 미래 seq는 버퍼링했다가 빈 자리가 채워지면 순서대로 flush
//  - 과거(이미 지난) seq는 stale로 폐기
// 서버 권위 전환 시에도 동일 규칙(서버 sequenceId)으로 동작한다.

export function createEventBus() {
  const seen = new Set();          // 처리한 eventId
  const handlers = new Map();      // type → Set<fn>, '*' = 전체
  const pending = new Map();       // seq → event (out-of-order 버퍼)
  let nextSeq = 0;

  function on(type, fn) {
    if (!handlers.has(type)) handlers.set(type, new Set());
    handlers.get(type).add(fn);
    return () => handlers.get(type)?.delete(fn);
  }

  function fire(ev) {
    handlers.get(ev.type)?.forEach((fn) => fn(ev));
    handlers.get('*')?.forEach((fn) => fn(ev));
  }

  function deliver(ev) {
    seen.add(ev.id);
    fire(ev);
    nextSeq = ev.seq + 1;
  }

  /** @returns {{accepted:boolean, reason?:string, buffered?:boolean}} */
  function emit(ev) {
    if (ev == null || ev.type == null) return { accepted: false, reason: 'invalid' };
    if (seen.has(ev.id)) return { accepted: false, reason: 'duplicate' };
    if (ev.seq == null) { seen.add(ev.id); fire(ev); return { accepted: true }; } // 순서 무관 이벤트
    if (ev.seq < nextSeq) return { accepted: false, reason: 'stale' };
    if (ev.seq > nextSeq) { pending.set(ev.seq, ev); return { accepted: true, buffered: true }; }
    deliver(ev);
    // 버퍼에 이어지는 연속 seq를 순서대로 방출
    while (pending.has(nextSeq)) {
      const n = pending.get(nextSeq);
      pending.delete(n.seq);
      if (!seen.has(n.id)) deliver(n);
      else nextSeq = n.seq + 1;
    }
    return { accepted: true };
  }

  return {
    on,
    emit,
    get nextSeq() { return nextSeq; },
    get pendingCount() { return pending.size; },
    get seenCount() { return seen.size; },
  };
}
