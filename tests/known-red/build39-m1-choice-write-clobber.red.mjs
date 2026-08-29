import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ════════════════════════════════════════════════════════════════════════════
// Build39 M1 (RED, 수정 금지) — 참가자 선택 write 가 이미 발행된 결과 인코딩을 지운다.
//
// 배경(실측): qa-report-build38 …00-03-07 / 방 3VT6 / gameNo=4 round=1
//   TAGGER_SNAPSHOT_STALE  unresolvedIds=['p_1787959849147']   ← 자기 자신
//   snapshotRetryDurationMs=2612, TAGGER_FALLBACK_SOURCE=localJudge (세션 중 유일)
//
// 의미(정정됨): "unresolved" 는 내 write 가 안 보인다는 뜻이 아니라
//   base 는 있는데 host 의 결과 인코딩이 그 행에 없다는 뜻이다.
//   (getUnresolvedActiveParticipants: getChoiceBase(p.choice) && !hasConfirmedRoundResult(p.choice))
//
// 이 파일이 고정하는 계약:
//   choice 컬럼은 base 를 참가자가, result 를 host 가 쓰는 **공유 컬럼**이다.
//   참가자의 선택 write 는 이미 그 행에 실린 확정 결과 인코딩을 지워서는 안 된다.
//   지운다면 자기 행만 unresolved 가 되는 현상이 구조적으로 설명된다
//   (이 단말이 write 할 수 있는 행은 자기 행뿐이므로).
//
// ⚠️ M1 이 실제로 발생했는지는 host 증거 없이 확정할 수 없다. 이 RED 는 "이 경로가
//    구조적으로 열려 있는가"만 고정한다 — production 수정은 하지 않는다(CEO 지시 14).
// ⚠️ 공허성 방지: 정상 경로(인코딩 없는 행에 쓰기)를 대조군으로 함께 둔다.
// ════════════════════════════════════════════════════════════════════════════

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

function extractBlock(a, b) {
  const s = html.indexOf(a);
  if (s < 0) throw new Error('start marker: ' + a);
  const e = html.indexOf(b, s);
  if (e < 0) throw new Error('end marker: ' + b);
  return html.slice(s, e);
}

// parseRoundChoice 는 ROUND_CHOICES / ROUND_RESULT_VALUES 상수에 의존하므로 그 선언부터 포함한다.
const CHOICE_ENC_SRC = extractBlock('const ROUND_CHOICES = ["scissors", "rock", "paper"];', 'function getParticipantSignature(');
const WRITE_SRC = extractBlock('async function updateParticipantChoice(choice) {', '// --- 기존 UI 제어 로직 수정 ---');

/** updateParticipantChoice 를 실제 소스에서 실행하고 DB 에 실린 최종 값을 돌려준다. */
async function runWrite({ existingChoice }) {
  const ME = 'p_self';
  const rows = { [ME]: { id: ME, choice: existingChoice } };
  const writes = [];
  const db = {
    from: () => ({
      update: (patch) => {
        const rec = { patch, id: null };
        const chain = {
          eq: (col, v) => { rec.id = v; writes.push(rec); rows[v] = { ...rows[v], ...patch }; return chain; },
        };
        chain.then = (res) => res({ error: null });
        return chain;
      },
    }),
  };
  const state = {
    currentUserId: ME, roomCode: 'BYZ7', gameRound: 4, round: 1, status: 'playing', role: 'participant',
    participants: [{ id: ME, choice: existingChoice }],
  };
  const factory = new Function(
    'db', 'state', 'QA', 'qaRoundCtx', 'qaNextTraceId', 'getGameRound',
    CHOICE_ENC_SRC + '\n' + WRITE_SRC + '\nreturn { updateParticipantChoice, hasConfirmedRoundResult, getChoiceBase };'
  );
  const mod = factory(
    db, state, { emit: () => {} }, () => ({}), () => 't1', () => 4
  );
  return { mod, rows, writes, ME, state };
}

describe('M1 — 선택 write 가 결과 인코딩을 덮어쓰는가', () => {
  it('전제(공허성 가드): 인코딩 헬퍼가 실제로 동작한다', async () => {
    const { mod } = await runWrite({ existingChoice: 'rock' });
    expect(mod.hasConfirmedRoundResult('rock|lose')).toBe(true);
    expect(mod.hasConfirmedRoundResult('rock')).toBe(false);
    expect(mod.getChoiceBase('rock|lose')).toBe('rock');
  });

  it('[대조군] 인코딩이 없는 행에 쓰는 것은 정상이다', async () => {
    const { mod, rows, ME } = await runWrite({ existingChoice: 'rock' });
    await mod.updateParticipantChoice('paper');
    expect(rows[ME].choice).toBe('paper');
  });

  it('[RED-M1] 확정 결과 인코딩이 실린 행을 맨 base 로 덮어쓰면 안 된다', async () => {
    // host 가 이미 "rock|lose" 를 발행한 뒤, 참가자가 아직 로컬 status=playing 인 창에서
    // 다른 손을 누르면 selectChoice -> updateParticipantChoice("paper") 가 실행된다.
    const { mod, rows, ME } = await runWrite({ existingChoice: 'rock|lose' });
    await mod.updateParticipantChoice('paper');
    expect(mod.hasConfirmedRoundResult(rows[ME].choice),
      `확정 결과 인코딩이 지워졌다: "rock|lose" -> "${rows[ME].choice}" — ` +
      '이 행은 이후 스냅샷에서 unresolved 로 잡혀 결과 판정을 지연시킨다')
      .toBe(true);
  });

  it('[RED-M1b] 인코딩이 실린 행에는 write 자체가 억제되거나 조건부여야 한다', async () => {
    // ⚠️ 소스에 'hasConfirmedRoundResult' 문자열이 있는지로 판정하면 안 된다 —
    //    Build39 계측이 로깅 목적으로 그 이름을 쓰고 있어 가드가 없어도 통과한다
    //    (실제로 한 번 그렇게 공허 통과했다). 반드시 "write 가 나갔는가"로 본다.
    const plain = await runWrite({ existingChoice: 'rock' });
    await plain.mod.updateParticipantChoice('paper');
    expect(plain.writes.length, '공허성 가드: 정상 경로에서 write 가 나가야 한다').toBe(1);

    const encoded = await runWrite({ existingChoice: 'rock|lose' });
    await encoded.mod.updateParticipantChoice('paper');
    const wrote = encoded.writes.filter(w => w.patch && w.patch.choice === 'paper');
    expect(wrote.length,
      '확정 인코딩이 실린 행에도 무조건 덮어쓰기 write 가 나간다 — 조건부/억제 경로가 없다')
      .toBe(0);
  });

  it('[참고] 이 창이 열려 있음을 소스로 확인한다 — 결과 인코딩 write 가 status 전이보다 앞선다', () => {
    const pub = extractBlock('async function publishHostRoundResult(', 'function scheduleFetchParticipants');
    const rowWrite = pub.indexOf('await Promise.all(active.map(async p =>');
    // Build40 P0-1 이 세 번째 인자(continuation)를 더했다 — 닫는 괄호까지 정확 일치시키지 않는다.
    // rowWrite 이후의 첫 status 전이를 찾는다 — 앞쪽 early-return 분기의 호출(1001)이 아니라
    // per-row write(2155) 뒤에 오는 호출이어야 "인코딩 write 가 전이보다 앞선다"는 창이 증명된다.
    const afterRow = pub.slice(rowWrite).search(/await updateRoomStatusScheduled\("result", "result"[,)]/);
    const statusWrite = afterRow < 0 ? -1 : rowWrite + afterRow;
    expect(rowWrite, 'per-row 결과 write 를 찾지 못했다').toBeGreaterThan(0);
    expect(statusWrite, 'status=result 전이를 찾지 못했다').toBeGreaterThan(rowWrite);
    // 참가자 쪽 가드는 로컬 state.status 만 본다 → 위 두 write 사이에는 아직 playing 이다.
    const sel = extractBlock('async function selectChoice(choice, event) {', 'function updateSelectedCount()');
    expect(sel).toContain('if (state.status !== "playing") return;');
  });
});
