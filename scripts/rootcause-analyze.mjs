// scripts/rootcause-analyze.mjs — Root Cause Candidate + 5 Whys Assistant (WES v2.1)
// qa-analyze 결과({report, gate})를 받아 가능성 높은 Root Cause 후보를 Confidence와 함께 제시하고
// 5 Whys 초안을 생성한다. ⚠️ 이것은 "후보"이며, 최종 Root Cause는 Evidence로 사람이 확정한다(추측 금지).
// 앱/게임 무변경 — 순수 분석 도구.

const clamp = (v) => Math.max(0, Math.min(99, Math.round(v)));

// 규칙: (메트릭/게이트 패턴) → (Root Cause 후보, 기준 confidence, 5 Whys 초안).
export function rootCauseCandidates(analysis) {
  const r = (analysis && analysis.report) || {};
  const g = (analysis && analysis.gate) || {};
  const c = [];

  if (g['WRPS-036 countdownDrift avg < 100ms'] === 'FAIL') {
    c.push({
      wrps: 'WRPS-036', name: 'Countdown 서버시각 정렬 실패 (clock offset 추정 오차 / 네트워크 jitter)',
      confidence: clamp(62 + Math.min(35, ((r.countdownDriftAvgMs || 100) - 100) / 8)),
      evidence: `countdownDriftAvg=${r.countdownDriftAvgMs}ms, max=${r.countdownDriftMaxMs}, p95=${r.countdownDriftP95Ms}, clockOffset=${r.clockOffsetMs}`,
      whys: [
        '단말마다 카운트다운 시작 시각이 달랐다',
        '각 단말이 공유 countdownStartAt을 자기 로컬 시계로 평가했다',
        '로컬 시계의 server offset 추정에 오차가 있었다',
        'HTTP Date 초단위/ RTT 비대칭 → sub-second 보정 한계 + lead 부족',
        'Root Cause(후보): 서버시각 동기화 정밀도/전파지연 흡수가 실 네트워크에서 부족',
      ],
    });
  }
  if (g['WRPS-026 shadow match = 100%'] === 'FAIL') {
    c.push({
      wrps: 'WRPS-026', name: '엔진(resolveElimination) vs legacy 분기 판정 불일치',
      confidence: 88,
      evidence: `shadowMatch=${r.shadowMatchPct}% (${r.shadowMatch}/${r.shadowTotal})`,
      whys: [
        '특정 라운드에서 legacy 확정 술래/안전이 엔진과 달랐다',
        'legacy 인라인 분기와 game-logic resolveElimination이 같은 입력에 다른 출력',
        '입력(활성자/confirmed/choice) 구성이 두 경로에서 달랐을 가능성',
        'stale choice/마커 처리 차이 또는 호스트 특례 잔존',
        'Root Cause(후보): 판정 입력 정규화 불일치 (코드 정독으로 확정 필요)',
      ],
    });
  }
  if ((r.audioDuplicate || 0) > 0) {
    c.push({
      wrps: 'WRPS-052', name: '오디오 중복 재생 — dedup 가드 누락(eventId/round-key)',
      confidence: 85, evidence: `audioDuplicate=${r.audioDuplicate}`,
      whys: ['같은 사운드가 2회 재생', '동일 이벤트가 2회 트리거(전이/재진입)', 'eventId 또는 round-key dedup 미적용 경로 존재', 'side-effect에 idempotency 가드 부재', 'Root Cause(후보): 중복 호출 가능 전이에 dedup 미적용'],
    });
  }
  if ((r.audioMissing || 0) > 0) {
    c.push({
      wrps: 'WRPS-051', name: '음성 클립 누락 — 매핑 공백 또는 디코드/언락 실패',
      confidence: 74, evidence: `audioMissing=${r.audioMissing}, audioDelayMax=${r.audioDelayMaxMs}`,
      whys: ['특정 이벤트에서 음성이 안 났다', 'VOICE_CLIPS 매핑 공백 또는 버퍼 미디코드', 'iOS AudioContext 비-제스처 resume 실패 가능', 'preload 실패/네트워크 또는 언락 타이밍', 'Root Cause(후보): 클립 매핑 또는 오디오 언락 경로'],
    });
  }
  if ((r.staleParticipant || 0) > 0) {
    c.push({
      wrps: 'WRPS-053', name: 'Lobby stale — realtime participant DELETE 미전파(REPLICA IDENTITY)',
      confidence: 80, evidence: `staleParticipant=${r.staleParticipant}, hostChanged=${r.hostChanged}`,
      whys: ['승계/퇴장 후 옛 호스트 행이 목록에 잔존', 'participant DELETE realtime이 room_id 필터로 미전달', 'REPLICA IDENTITY 기본 → DELETE payload 제한', '전체 재조회 트리거 누락 가능', 'Root Cause(후보): DELETE 의존 대신 강제 재조회 필요(WRPS-044 패턴)'],
    });
  }
  if ((r.audioDelayMaxMs || 0) > 300) {
    c.push({
      wrps: 'WRPS-052', name: 'iOS AudioContext 언락/디코드 지연',
      confidence: 64, evidence: `audioDelayMax=${r.audioDelayMaxMs}ms, p95=${r.audioDelayP95Ms}`,
      whys: ['결과/카운트다운 음성이 늦게 났다', '재생 시점에 버퍼 미디코드(캐시 미스)', 'AudioContext suspended → resume 지연', 'preload 미완 또는 OS 인터럽트 후 재-suspend', 'Root Cause(후보): preload/언락 타이밍'],
    });
  }

  c.sort((a, b) => b.confidence - a.confidence);
  return c;
}

export function fiveWhysDraft(analysis) {
  const top = rootCauseCandidates(analysis)[0];
  if (!top) return { note: 'gate FAIL 없음 → Root Cause 후보 없음(데이터 정상 또는 NO-DATA).', whys: [] };
  return { candidate: top.name, wrps: top.wrps, confidence: top.confidence, evidence: top.evidence, whys: top.whys };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import('node:fs');
  const { analyzeQAMetrics } = await import('./qa-analyze.mjs');
  const raw = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : readFileSync(0, 'utf8');
  const analysis = analyzeQAMetrics(JSON.parse(raw));
  const cands = rootCauseCandidates(analysis);
  console.log('=== Root Cause Candidates ===');
  cands.forEach((c, i) => console.log(`  #${i + 1} [${c.confidence}%] ${c.wrps} — ${c.name}\n      evidence: ${c.evidence}`));
  if (!cands.length) console.log('  (gate FAIL 없음 — 후보 없음)');
  console.log('=== 5 Whys Draft (top candidate) ===');
  console.log(JSON.stringify(fiveWhysDraft(analysis), null, 2));
}
