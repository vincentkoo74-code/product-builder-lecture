import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Build18 — iOS 음성 재생 복구(WRPS-052) + ROUND_RESULT metric 중복 제거(WRPS-072).
// 오디오/섀도우 로직은 index.html 인라인에 깊게 묶여 있어 정적 계약(static contract)으로 회귀를 잠근다.

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

describe('WRPS-052 — iOS 음성 재생 복구 + 진단 계측', () => {
  it('loadBuffer는 실패 단계(fetch/http/decode)를 loadErrors에 남긴다', () => {
    expect(html).toContain('const loadErrors = new Map()');
    expect(html).toMatch(/stage\s*=\s*\(status == null\)\s*\?\s*'fetch'\s*:\s*\(status >= 400\s*\?\s*'http'\s*:\s*'decode'\)/);
    expect(html).toContain("loadErrors.set(src, { stage, status, message");
  });

  it('WebAudio 디코드 실패 시 HTMLAudioElement fallback으로 라우팅한다', () => {
    expect(html).toContain('function playVoiceFallback(');
    expect(html).toMatch(/loadBuffer\(src\)\.then\(\(buf\)\s*=>\s*\{[\s\S]{0,200}playVoiceFallback\(src, eventKey, id, qaT0, pri\)/);
    expect(html).toContain('const el = new Audio(src);');
  });

  it('fallback은 무음 시 재생하지 않고, 성공/실패를 audioPlayed로 기록한다', () => {
    // 무음 가드
    expect(html).toMatch(/function playVoiceFallback[\s\S]{0,400}if \(isMuted\(\)\) return;/);
    // 성공/실패 emit 분기
    expect(html).toMatch(/pr\.then\(emitOk\)\.catch\(emitFail\)/);
  });

  it('재생 성공 시 audioPlayed=true + audioSource + audioMode를 남긴다', () => {
    // WebAudio 경로
    expect(html).toMatch(/audioPlayed: true, audioMissing: false, audioFallbackUsed: false[\s\S]{0,120}audioMode: audioModeInfo\(\)/);
    // audioMode 정의(무음/컨텍스트 상태로 볼륨 vs 코드경로 구분)
    expect(html).toMatch(/function audioModeInfo\(\)[\s\S]{0,160}return \{ muted: mu, ctxState: st \}/);
  });

  it('실패 metric은 audioError + loadError(진단)를 포함한다', () => {
    expect(html).toMatch(/audioPlayed: false, audioMissing: true, audioFallbackUsed: true, audioError:/);
    expect(html).toContain('loadError: err');
  });

  it('stopVoice는 fallback HTMLAudioElement도 정지한다', () => {
    expect(html).toMatch(/function stopVoice\(\)[\s\S]{0,200}voiceFallbackEl\.pause\(\)/);
  });
});

describe('WRPS-072 — ROUND_RESULT metric 중복 제거', () => {
  it('eventId별 1회 가드(M.seenResult)를 초기화한다', () => {
    expect(html).toContain('if (!M.seenResult) M.seenResult = new Set();');
  });

  it('ROUND_RESULT emit은 동일 eventId면 재기록하지 않는다', () => {
    expect(html).toMatch(/if \(!M\.seenResult\.has\(sh\.eventId\)\)\s*\{[\s\S]{0,260}eventType: 'ROUND_RESULT'/);
    expect(html).toMatch(/M\.seenResult\.add\(sh\.eventId\)/);
  });

  it('finishRoundLocal 2회 호출은 설계임을 근거로 명시한다(판정/DB 중복 아님)', () => {
    // 근거 주석(6695 WRPS-046)과 dedup 사유 주석 존재
    expect(html).toContain('finishRoundLocal은 result→game_over 전이로 라운드당 2회 이상 호출');
  });
});

// 게임 판정/서버/UI/QA persistence 구조 무변경 계약(Build18 금지사항 회귀 방지)
describe('Build18 비침습 계약(금지사항)', () => {
  it('QA persistence 구조(rpsQAReport.v1 / 세션 시딩)는 유지된다', () => {
    expect(html).toContain("const QA_STORAGE_KEY = 'rpsQAReport.v1'");
    expect(html).toContain("'rpsQASession'");
    expect(html).toContain('function exportFile(');
  });
  it('판정 순수함수(judgePure/judgeRound)는 그대로 존재한다', () => {
    expect(html).toContain('function judgeRound(');
    expect(html).toContain('Object.assign(result, judgePure(active));');
  });
});
