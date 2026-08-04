// 마루의 가위바위보 — 순수 게임 로직 (DB·DOM 비의존)
//
// 이 파일이 판정/술래-소거/전적 집계의 단일 소스다.
// - 런타임(index.html): scripts/sync-game-logic.mjs 가 빌드/동기화 시 이 파일을
//   index.html 의 GAME_LOGIC 마커 블록 사이에
//   "export " 키워드를 제거해 인라인 주입한다. 따라서 여기 정의를 인라인 코드가 공유한다.
// - 테스트(vitest): tests/*.mjs 가 이 모듈을 직접 import 해 시나리오 A~F를 검증한다.
//
// 모든 함수는 "정규화된 입력"만 받는다(인코딩 문자열 파싱은 호출측 책임).
//   player = { id, isHost, base, result, choice }
//     base   : 'scissors' | 'rock' | 'paper' | '' (이번 라운드 실제 선택값)
//     result : 'win' | 'lose' | 'draw' | '' (판정 후 채워짐)
//     choice : 원본 인코딩 문자열(마커 '__safe__'/'__loser__' 판별용, 선택)

export const PLAYER_STATUS = {
  ACTIVE: 'ACTIVE',
  LOSER_CONFIRMED: 'LOSER_CONFIRMED',
  WINNER_CONFIRMED: 'WINNER_CONFIRMED',
  // WRPS-083 2A: 현재 라운드에 참여하지 않는 참가자(라운드 진행 중 재입장자).
  // 방 참가자로는 유효하고 host 후보도 될 수 있으나, 현재 라운드의 판정/Ready/ForceStart/
  // PlayAgain/active candidate/술래 선정 완료 계산에서는 제외된다.
  WAITING: 'WAITING',
  HOST: 'HOST',
};

// a vs b 승자 선택값 반환(둘만 비교, 같은 종류는 a 반환).
export function getWinningChoice(a, b) {
  if ((a === 'scissors' && b === 'paper') || (b === 'scissors' && a === 'paper')) return 'scissors';
  if ((a === 'rock' && b === 'scissors') || (b === 'rock' && a === 'scissors')) return 'rock';
  if ((a === 'paper' && b === 'rock') || (b === 'paper' && a === 'rock')) return 'paper';
  return a;
}

// 이번 라운드 활성 플레이어들의 base 선택만으로 승/패/무를 판정한다.
// 규칙: 선택 종류가 1종(전원 동일) 또는 3종(전부 등장) → 전원 draw, 정확히 2종 → 승/패.
// active = [{ id, base }] (base 가 빈 값인 사람은 호출측에서 제외해 전달).
// 반환: { [id]: 'win'|'lose'|'draw' }
export function judgePure(active) {
  const result = {};
  const players = (active || []).filter((p) => p && p.id && p.base);
  if (players.length === 0) return result;

  const selectedTypes = [...new Set(players.map((p) => p.base))];
  if (selectedTypes.length === 1 || selectedTypes.length === 3) {
    players.forEach((p) => { result[p.id] = 'draw'; });
    return result;
  }
  const winningChoice = getWinningChoice(selectedTypes[0], selectedTypes[1]);
  players.forEach((p) => { result[p.id] = p.base === winningChoice ? 'win' : 'lose'; });
  return result;
}

// 각 참가자의 상태를 단일 규칙으로 도출한다(확정 술래/안전/활성).
// participants = [{ id, isHost, choice }]
// WRPS-042/043(2026-06-22): 호스트도 일반 플레이어로 가위바위보에 참여한다(심판 모델 폐지).
//   → isHost는 게임 상태 판정에 영향을 주지 않는다(방 관리/벌칙설정/승계 전용 플래그).
//   PLAYER_STATUS.HOST는 하위호환을 위해 상수만 유지(더는 부여되지 않음).
// 우선순위: 확정 술래 > 확정 안전 > WAITING > ACTIVE. choice 마커는 확정 배열의 폴백.
// WRPS-083 2A: WAITING이 확정 술래/안전보다 뒤인 이유 — confirmedLoserIds/confirmedSafeIds는
// "이번 게임에서 이미 확정된 결과"이고 choice 컬럼은 단일 값이라, 확정자가 퇴장 후 라운드
// 진행 중에 재입장하면 그 row의 choice가 '__waiting__'으로 덮인다. 이때 WAITING이 이기면
// 확정 술래가 재입장만으로 부활해 판정 결과가 뒤집힌다. 확정이 항상 우선해야 한다.
export function computePlayerStatuses(participants, confirmedSafeIds = [], confirmedLoserIds = []) {
  const safe = new Set(confirmedSafeIds || []);
  const loser = new Set(confirmedLoserIds || []);
  const map = {};
  (participants || []).forEach((p) => {
    if (!p || !p.id) return;
    if (loser.has(p.id) || p.choice === '__loser__') { map[p.id] = PLAYER_STATUS.LOSER_CONFIRMED; return; }
    if (safe.has(p.id) || p.choice === '__safe__') { map[p.id] = PLAYER_STATUS.WINNER_CONFIRMED; return; }
    if (p.choice === '__waiting__') { map[p.id] = PLAYER_STATUS.WAITING; return; }
    map[p.id] = PLAYER_STATUS.ACTIVE;
  });
  return map;
}

// 선택 가능한 최대 술래 수 = 플레이어 수 - 1 (최소 1명의 승자가 남아야 게임 종료).
// WRPS-043: 호스트도 플레이어이므로 playerCount는 호스트 포함 전체 참가자 수다.
//   N명 → 1 ~ (N-1) 선택 가능. 2명이면 1, 3명이면 1~2, 4명이면 1~3 ...
export function maxLoserCountFor(playerCount) {
  return Math.max(1, (Number(playerCount) || 0) - 1);
}

// 아직 술래/안전이 확정되지 않은(ACTIVE) 플레이어 id 목록(WRPS-042/043: 호스트 포함).
export function getActiveIds(participants, confirmedSafeIds = [], confirmedLoserIds = []) {
  const statuses = computePlayerStatuses(participants, confirmedSafeIds, confirmedLoserIds);
  return (participants || [])
    .filter((p) => p && p.id && statuses[p.id] === PLAYER_STATUS.ACTIVE)
    .map((p) => p.id);
}

// 한 라운드 판정 결과를 받아 술래-소거 상태 전이를 계산한다(finishRoundLocal 분기의 순수형).
// 입력:
//   roundResults  : [{ id, result }] — 이번 라운드 활성자들의 판정(win/lose/draw)
//   prevLoserIds  : 직전까지 확정 술래 id
//   prevSafeIds   : 직전까지 확정 안전 id
//   targetLoserCount : 목표 술래 수
// 반환: { outcome, newConfirmedLoserIds, newConfirmedSafeIds, nextActiveIds,
//         remainingSlots, remainingSlotsAfter, isComplete }
//   outcome ∈ 'allDraw' | 'gameOver' | 'tooMany' | 'tooFew'
//   - allDraw : 전원 무승부 → 같은 후보로 재대결
//   - gameOver: 이번 라운드 패자 수 == 남은 슬롯 → 목표 충족, 종료
//   - tooMany : 패자 수 > 남은 슬롯 → 패자들끼리 재대결로 축소, 승자 안전 확정
//   - tooFew  : 패자 수 < 남은 슬롯 → 패자 확정, 승자들끼리 추가 대결
export function resolveElimination({
  roundResults = [],
  prevLoserIds = [],
  prevSafeIds = [],
  targetLoserCount = 1,
} = {}) {
  const prevLosers = [...prevLoserIds];
  const prevSafes = [...prevSafeIds];
  const active = (roundResults || []).filter((r) => r && r.id);
  const remainingSlots = targetLoserCount - prevLosers.length;

  // 중도 퇴장 등으로 남은 활성자가 남은 술래 슬롯 이하이면, 더 가릴 수 없으므로
  // 남은 전원을 술래로 확정하고 종료한다(1명만 남아 무한 무승부에 빠지는 deadlock 방지).
  if (active.length > 0 && active.length <= remainingSlots) {
    const newLosers = [...prevLosers, ...active.map((r) => r.id)];
    return {
      outcome: 'gameOver',
      newConfirmedLoserIds: newLosers,
      newConfirmedSafeIds: prevSafes,
      nextActiveIds: [],
      remainingSlots,
      remainingSlotsAfter: targetLoserCount - newLosers.length,
      isComplete: true,
    };
  }

  const roundLosers = active.filter((r) => r.result === 'lose').map((r) => r.id);
  const roundWinners = active.filter((r) => r.result === 'win').map((r) => r.id);
  const allDraw = active.length > 0 && active.every((r) => r.result === 'draw');

  if (allDraw) {
    return {
      outcome: 'allDraw',
      newConfirmedLoserIds: prevLosers,
      newConfirmedSafeIds: prevSafes,
      nextActiveIds: active.map((r) => r.id),
      remainingSlots,
      remainingSlotsAfter: remainingSlots,
      isComplete: false,
    };
  }

  if (roundLosers.length === remainingSlots) {
    const newLosers = [...prevLosers, ...roundLosers];
    return {
      outcome: 'gameOver',
      newConfirmedLoserIds: newLosers,
      newConfirmedSafeIds: [...prevSafes, ...roundWinners],
      nextActiveIds: [],
      remainingSlots,
      remainingSlotsAfter: targetLoserCount - newLosers.length,
      isComplete: true,
    };
  }

  if (roundLosers.length > remainingSlots) {
    // 패자가 너무 많음: 패자들끼리 다시 겨뤄 남은 슬롯 수만큼으로 줄인다. 승자는 안전 확정.
    return {
      outcome: 'tooMany',
      newConfirmedLoserIds: prevLosers,
      newConfirmedSafeIds: [...prevSafes, ...roundWinners],
      nextActiveIds: roundLosers,
      remainingSlots,
      remainingSlotsAfter: remainingSlots,
      isComplete: false,
    };
  }

  // 패자가 모자람: 이번 패자 확정, 승자들끼리 추가 대결로 남은 술래를 더 가린다.
  const newLosers = [...prevLosers, ...roundLosers];
  return {
    outcome: 'tooFew',
    newConfirmedLoserIds: newLosers,
    newConfirmedSafeIds: prevSafes,
    nextActiveIds: roundWinners,
    remainingSlots,
    remainingSlotsAfter: targetLoserCount - newLosers.length,
    isComplete: false,
  };
}

// WRPS-044: 클라이언트 참가자 목록은 "최신 DB 행"을 그대로 신뢰해야 한다(호스트 승계/퇴장 후 stale 제거).
// 주어진 DB 행 배열에서 표시용 뷰(멤버 id 목록 · 단일 호스트 id · 인원수)를 도출한다.
// 전체 재조회 결과로 이 뷰를 다시 그리면 옛 호스트 행 제거·is_host 변경·신규 참가자 반영이 자동 보장된다.
export function participantListView(rows) {
  const list = (rows || []).filter((r) => r && r.id);
  const host = list.find((r) => r.is_host || r.isHost);
  return { ids: list.map((r) => r.id), hostId: host ? host.id : null, count: list.length };
}

// 권위 DB 참가자 행에서 게임 전적 요약을 만든다(클라이언트 무관 동일 결과 보장용).
// rows = [{ id, name, isHost, wins, losses, draws, penalties }]
// 승률 = wins / (wins + losses) (무승부 제외 — 기존 제품 정의 유지, account.winRateNote).
export function summarizeGameStats(rows) {
  return (rows || []).map((p) => {
    const wins = Number(p.wins || 0);
    const losses = Number(p.losses || 0);
    const draws = Number(p.draws || 0);
    const penalties = Number(p.penalties || 0);
    const decided = wins + losses;
    return {
      id: p.id || '',
      name: p.name || '',
      isHost: Boolean(p.isHost || p.is_host),
      wins,
      losses,
      draws,
      penalties,
      games: wins + losses + draws,
      winRate: decided > 0 ? Math.round((wins / decided) * 100) : 0,
    };
  });
}
