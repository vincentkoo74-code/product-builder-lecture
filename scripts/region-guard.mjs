// region-guard.mjs — KR/JP 리전 및 자격증명 혼입 방지 가드 (fail-closed)
//
// 단일 기준:
//   config/active-region.json  : 이 브랜치가 빌드하는 국가 선언
//   config/regions.json        : 국가별 백엔드/공개 식별자 레지스트리(키 원문 미보관, SHA-256 지문만)
//
// 검사 대상 계층(존재하는 것만):
//   source : index.html
//   dist   : dist/index.html
//   ios    : ios/App/App/public/index.html
//   android: android/app/src/main/assets/public/index.html
//   ci     : .github/workflows/*.yml
//
// 검사 항목:
//   R1 SUPABASE_URL 이 선언된 리전의 project ref 를 가리키는가
//   R2 SUPABASE_ANON_KEY 의 SHA-256 지문이 선언된 리전의 지문과 일치하는가
//   R3 타 리전의 project ref 가 산출물에 섞여 있지 않은가
//   R4 타 리전의 공개 client id 가 섞여 있지 않은가 (known_exceptions 로만 유예)
//   R5 클라이언트 계층에 service_role JWT 가 들어 있지 않은가 (유예 불가)
//   R6 빌드 산출물의 BUILD_MANIFEST.json region 스탬프가 선언 리전과 일치하는가
//      (타 국가 빌드 산출물이 남아 있는 상태를 잡아낸다)
//
// 종료 코드: 위반 0건이면 0, 그 외 1.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

export const CLIENT_LAYERS = [
  ["source", "index.html"],
  ["dist", "dist/index.html"],
  ["ios", "ios/App/App/public/index.html"],
  ["android", "android/app/src/main/assets/public/index.html"],
];

export const MANIFEST_LAYERS = [
  ["dist", "dist/BUILD_MANIFEST.json"],
  ["ios", "ios/App/App/public/BUILD_MANIFEST.json"],
  ["android", "android/app/src/main/assets/public/BUILD_MANIFEST.json"],
];

// R6 — 산출물 매니페스트의 국가 스탬프 검사(순수 함수).
export function auditManifest({ layer, content, activeRegion, regions }) {
  const violations = [];
  let m;
  try { m = JSON.parse(content); }
  catch {
    return [{ rule: "R6", layer, severity: "error", detail: "BUILD_MANIFEST.json 파싱 실패" }];
  }
  const expectedRef = regions[activeRegion].supabase_project_ref;
  if (m.region !== activeRegion) {
    violations.push({
      rule: "R6", layer, severity: "error",
      detail: `BUILD_MANIFEST region='${m.region ?? "(없음)"}' 이 선언 리전 '${activeRegion}' 과 다르다 — 타 국가 빌드 산출물이 남아 있다. 'npm run build:web' 후 'npx cap sync' 로 재생성하라`,
    });
  }
  if (m.supabase_project_ref !== expectedRef) {
    violations.push({
      rule: "R6", layer, severity: "error",
      detail: `BUILD_MANIFEST supabase_project_ref 가 선언 리전의 ref 와 다르다`,
    });
  }
  return violations;
}

export const fingerprint = (s) =>
  "sha256:" + createHash("sha256").update(String(s), "utf8").digest("hex").slice(0, 16);

export function readConst(html, name) {
  const m = String(html).match(new RegExp(`const\\s+${name}\\s*=\\s*"([^"]*)"`));
  return m ? m[1] : null;
}

// JWT payload 의 role 클레임을 읽는다. 파싱 불가면 null.
export function jwtRole(token) {
  const parts = String(token).split(".");
  if (parts.length !== 3) return null;
  try {
    const pad = parts[1].length % 4 ? "=".repeat(4 - (parts[1].length % 4)) : "";
    const json = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/") + pad, "base64").toString("utf8");
    return JSON.parse(json).role ?? null;
  } catch {
    return null;
  }
}

// 순수 함수: 한 계층의 내용을 검사해 위반 목록을 돌려준다.
export function auditLayer({ layer, content, activeRegion, regions, exceptions }) {
  const violations = [];
  const active = regions[activeRegion];
  const foreign = Object.values(regions).filter((r) => r.code !== activeRegion);
  const exempt = new Set((exceptions || []).map((e) => e.identifier));
  const isClient = CLIENT_LAYERS.some(([name]) => name === layer);

  if (isClient) {
    const url = readConst(content, "SUPABASE_URL");
    if (!url) {
      violations.push({ rule: "R1", layer, severity: "error", detail: "SUPABASE_URL 상수를 찾지 못했다" });
    } else if (!url.includes(active.supabase_project_ref)) {
      violations.push({
        rule: "R1", layer, severity: "error",
        detail: `SUPABASE_URL 이 선언 리전(${activeRegion}=${active.supabase_project_ref}) 을 가리키지 않는다`,
      });
    }

    const anon = readConst(content, "SUPABASE_ANON_KEY");
    if (!anon) {
      violations.push({ rule: "R2", layer, severity: "error", detail: "SUPABASE_ANON_KEY 상수를 찾지 못했다" });
    } else if (fingerprint(anon) !== active.supabase_anon_key_fingerprint) {
      violations.push({
        rule: "R2", layer, severity: "error",
        detail: `SUPABASE_ANON_KEY 지문 불일치 (기대 ${active.supabase_anon_key_fingerprint}, 실제 ${fingerprint(anon)})`,
      });
    }

    // R5 — service_role JWT 는 어떤 예외로도 유예하지 않는다.
    for (const tok of content.match(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g) || []) {
      if (jwtRole(tok) === "service_role") {
        violations.push({
          rule: "R5", layer, severity: "critical",
          detail: "클라이언트 계층에 service_role JWT 가 포함되어 있다 (유예 불가)",
        });
        break;
      }
    }
  }

  for (const r of foreign) {
    if (content.includes(r.supabase_project_ref)) {
      violations.push({
        rule: "R3", layer, severity: "error",
        detail: `타 리전(${r.code}) project ref '${r.supabase_project_ref}' 가 포함되어 있다`,
      });
    }
    for (const [idName, idValue] of Object.entries(r.public_client_ids || {})) {
      if (!idValue || !content.includes(idValue)) continue;
      if (exempt.has(idName)) {
        violations.push({
          rule: "R4", layer, severity: "waived",
          detail: `타 리전(${r.code}) 공개 식별자 '${idName}' 가 포함되어 있다 — known_exceptions 로 유예됨`,
        });
      } else {
        violations.push({
          rule: "R4", layer, severity: "error",
          detail: `타 리전(${r.code}) 공개 식별자 '${idName}' 가 포함되어 있다`,
        });
      }
    }
  }

  return violations;
}

export function loadConfig(root) {
  const regions = JSON.parse(readFileSync(path.join(root, "config/regions.json"), "utf8"));
  const activeCfg = JSON.parse(readFileSync(path.join(root, "config/active-region.json"), "utf8"));
  const activeRegion = activeCfg.region;
  if (!regions.regions[activeRegion]) {
    throw new Error(`active-region.json 의 region='${activeRegion}' 이 regions.json 에 없다`);
  }
  return { regions: regions.regions, activeRegion, exceptions: activeCfg.known_exceptions || [] };
}

export function runGuard(root, { layers = null } = {}) {
  const { regions, activeRegion, exceptions } = loadConfig(root);
  const results = [];
  const scanned = [];
  const want = (name) => layers === null || layers.includes(name);

  for (const [layer, rel] of CLIENT_LAYERS) {
    if (!want(layer)) continue;
    const abs = path.join(root, rel);
    if (!existsSync(abs)) continue;
    scanned.push(`${layer} (${rel})`);
    results.push(...auditLayer({ layer, content: readFileSync(abs, "utf8"), activeRegion, regions, exceptions }));
  }

  for (const [layer, rel] of MANIFEST_LAYERS) {
    if (!want(layer)) continue;
    const abs = path.join(root, rel);
    if (!existsSync(abs)) continue;
    scanned.push(`${layer} manifest (${rel})`);
    results.push(...auditManifest({ layer: `${layer}:manifest`, content: readFileSync(abs, "utf8"), activeRegion, regions }));
  }

  const wfDir = path.join(root, ".github/workflows");
  if (want("ci") && existsSync(wfDir)) {
    for (const f of readdirSync(wfDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))) {
      scanned.push(`ci (.github/workflows/${f})`);
      results.push(
        ...auditLayer({
          layer: "ci",
          content: readFileSync(path.join(wfDir, f), "utf8"),
          activeRegion, regions, exceptions,
        }).map((v) => ({ ...v, layer: `ci:${f}` })),
      );
    }
  }

  return { activeRegion, scanned, violations: results };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const root = path.resolve(new URL("..", import.meta.url).pathname);
  const { activeRegion, scanned, violations } = runGuard(root);
  const blocking = violations.filter((v) => v.severity !== "waived");
  const waived = violations.filter((v) => v.severity === "waived");

  console.log(`region-guard: active region = ${activeRegion}`);
  console.log(`region-guard: scanned ${scanned.length} layer(s):`);
  for (const s of scanned) console.log(`  - ${s}`);

  for (const v of waived) console.log(`  WAIVED  [${v.rule}] ${v.layer}: ${v.detail}`);
  for (const v of blocking) console.error(`  ${v.severity.toUpperCase()} [${v.rule}] ${v.layer}: ${v.detail}`);

  if (blocking.length) {
    console.error(`region-guard: FAIL — ${blocking.length} blocking violation(s)`);
    process.exit(1);
  }
  console.log(`region-guard: PASS (${waived.length} waived)`);
}
