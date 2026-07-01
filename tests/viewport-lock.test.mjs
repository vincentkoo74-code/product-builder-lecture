import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// WRPS-063 (DR-17) — 앱 viewport 잠금 회귀 방지: 확대/축소/이동 금지.

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const viewport = (html.match(/<meta name="viewport" content="([^"]*)"/) || [])[1] || '';

describe('WRPS-063 viewport lock', () => {
  it('viewport meta에 스케일 잠금이 설정된다', () => {
    expect(viewport).toContain('user-scalable=no');
    expect(viewport).toContain('maximum-scale=1.0');
    expect(viewport).toContain('viewport-fit=cover'); // safe-area 유지(WRPS-028 회귀 방지)
  });

  it('body에 touch-action/overscroll 잠금이 있다', () => {
    expect(html).toMatch(/touch-action:\s*manipulation/);
    expect(html).toMatch(/overscroll-behavior:\s*none/);
  });
});
