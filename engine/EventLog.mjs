// EventLog — append-only 이벤트 로그
//  - 중복 eventId 무시(멱등 append)
//  - seq 순서로 정렬해 replay 가능 → 어떤 시점에서도 결정론적으로 상태 재구성
//  - 서버 권위 전환 시 이 로그가 곧 source of truth(event sourcing)

export function createEventLog() {
  const entries = [];
  const seen = new Set();

  /** @returns {boolean} 새로 추가됐으면 true, 중복이면 false */
  function append(ev) {
    if (!ev || ev.id == null || seen.has(ev.id)) return false;
    seen.add(ev.id);
    entries.push(ev);
    return true;
  }

  function ordered() {
    return [...entries].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  }

  /** 로그를 순서대로 reducer에 적용해 상태를 재구성한다. */
  function replay(reducer, initial) {
    return ordered().reduce((s, ev) => reducer(s, ev), initial);
  }

  return {
    append,
    ordered,
    replay,
    entries: () => [...entries],
    get size() { return entries.length; },
  };
}
