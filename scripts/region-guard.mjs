// region-guard.mjs — KR/JP 리전 및 자격증명 혼입 방지 가드 (fail-closed)
//
// 단일 기준:
//   config/active-region.json  : 이 브랜치가 빌드하는 국가 선언
//   config/regions.json        : 국가별 백엔드/공개 식별자 레지스트리(키 원문 미보관, SHA-256 지문만)
//
// 검사 계층:
//   entry   : index.html (source/dist/ios/android) — 전 규칙
//   asset   : dist·네이티브 public 아래의 나머지 텍스트 자산 — R3/R4/R5
//   manifest: 각 산출물의 BUILD_MANIFEST.json — R6
//   ci      : .github/workflows/*.yml — R3/R4
//
// 검사 항목:
//   R1 SUPABASE_URL 이 선언된 리전의 project ref 를 가리키는가
//   R2 SUPABASE_ANON_KEY 의 SHA-256 지문이 선언된 리전의 지문과 일치하는가
//   R3 타 리전의 project ref 가 산출물에 섞여 있지 않은가
//   R4 타 리전의 공개 client id 가 섞여 있지 않은가 (known_exceptions 로만 유예)
//   R5 클라이언트 계층에 service_role JWT 가 들어 있지 않은가 (유예 불가)
//   R6 빌드 산출물의 BUILD_MANIFEST.json region 스탬프가 선언 리전과 일치하는가
//   R7 필수 계층(source)이 실제로 검사됐는가 — 검사 0건을 통과로 취급하지 않는다
//
// 종료 코드: 차단 위반 0건이면 0, 그 외 1.
// `--release` 로 실행하면 known_exceptions 중 blocks_release=true 인 유예도 차단으로 승격한다.

import { readFileSync, existsSync, readdirSync, statSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

// index.html — 리전 상수가 실제로 들어 있는 진입 파일
export const CLIENT_LAYERS = [
  ["source", "index.html"],
  ["dist", "dist/index.html"],
  ["ios", "ios/App/App/public/index.html"],
  ["android", "android/app/src/main/assets/public/index.html"],
];

// 필수 계층 — 이것이 검사되지 않으면 결과를 신뢰하지 않는다(R7).
export const REQUIRED_LAYERS = ["source"];

// build-web.mjs 가 배포하는 나머지 자산도 시크릿/타리전 스캔 대상이다.
export const ASSET_SCAN_ROOTS = [
  ["dist", "dist"],
  ["ios", "ios/App/App/public"],
  ["android", "android/app/src/main/assets/public"],
];
export const SCANNABLE_EXT = new Set([".html", ".js", ".mjs", ".cjs", ".json", ".css", ".txt", ".map"]);

export const MANIFEST_LAYERS = [
  ["dist", "dist/BUILD_MANIFEST.json"],
  ["ios", "ios/App/App/public/BUILD_MANIFEST.json"],
  ["android", "android/app/src/main/assets/public/BUILD_MANIFEST.json"],
];

export const fingerprint = (s) =>
  "sha256:" + createHash("sha256").update(String(s), "utf8").digest("hex").slice(0, 16);

// 주석을 제거한다. 상수 탐색 전에만 쓰인다(R3/R4/R5 스캔은 원문을 본다).
//  - 블록 주석 `/* … */` 전체를 제거한다. URL 의 `//` 는 `/*` 가 아니므로 영향 없다.
//  - 이어서 행 전체가 `//` 로 시작하는 줄을 제거한다. `"https://…"` 안의 `//` 는
//    줄 첫 비공백이 아니므로 보존된다.
// 블록 주석을 함께 걷어내야 "살아 있는 선언이 사라지고 블록 주석 안의 옛 선언 하나만
// 남은" 경우에 죽은 값을 유일한 정답으로 오인하지 않는다.
export function stripComments(text) {
  return String(text)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

// 이전 이름 호환.
export const stripLineComments = stripComments;

// 상수 선언을 전부 찾는다. 주석 처리된 옛 선언이 먼저 매치되어 엉뚱한 값을
// 검사하던 문제(M1)를 막기 위해 주석 줄을 먼저 걷어내고, 남은 선언이 2개
// 이상이면 모호한 상태로 보고 fail-closed 로 처리한다.
export function findConst(html, name) {
  const cleaned = stripComments(html);
  const re = new RegExp(`const\\s+${name}\\s*=\\s*"([^"]*)"`, "g");
  const values = [...cleaned.matchAll(re)].map((m) => m[1]);
  return { values, value: values.length === 1 ? values[0] : null, count: values.length };
}

// 이전 API 호환용(단일 매치일 때만 값을 돌려준다).
export function readConst(html, name) {
  return findConst(html, name).value;
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

// 유예는 (owner_region, identifier) 쌍으로만 성립한다. 이름만 같고 소유 리전이
// 다른 식별자에 유예가 번지지 않게 한다(M3).
function findException(exceptions, ownerRegion, identifier) {
  return (exceptions || []).find(
    (e) => e.identifier === identifier && (e.owner_region ?? ownerRegion) === ownerRegion,
  );
}

/**
 * 한 계층의 내용을 검사해 위반 목록을 돌려준다(순수 함수).
 * checkConstants: R1/R2 수행 여부 (index.html 계열만 true)
 * checkSecrets  : R5 수행 여부 (클라이언트로 배포되는 파일이면 true)
 */
export function auditLayer({
  layer, content, activeRegion, regions, exceptions,
  checkConstants = true, checkSecrets = true,
}) {
  const violations = [];
  const active = regions[activeRegion];
  const foreign = Object.values(regions).filter((r) => r.code !== activeRegion);

  if (checkConstants) {
    const url = findConst(content, "SUPABASE_URL");
    if (url.count === 0) {
      violations.push({ rule: "R1", layer, severity: "error", detail: "SUPABASE_URL 상수를 찾지 못했다" });
    } else if (url.count > 1) {
      violations.push({
        rule: "R1", layer, severity: "error",
        detail: `SUPABASE_URL 선언이 ${url.count}개다 — 어느 것이 유효한지 모호하므로 통과시키지 않는다`,
      });
    } else if (!url.value.includes(active.supabase_project_ref)) {
      violations.push({
        rule: "R1", layer, severity: "error",
        detail: `SUPABASE_URL 이 선언 리전(${activeRegion}=${active.supabase_project_ref}) 을 가리키지 않는다`,
      });
    }

    const anon = findConst(content, "SUPABASE_ANON_KEY");
    if (anon.count === 0) {
      violations.push({ rule: "R2", layer, severity: "error", detail: "SUPABASE_ANON_KEY 상수를 찾지 못했다" });
    } else if (anon.count > 1) {
      violations.push({
        rule: "R2", layer, severity: "error",
        detail: `SUPABASE_ANON_KEY 선언이 ${anon.count}개다 — 모호하므로 통과시키지 않는다`,
      });
    } else if (fingerprint(anon.value) !== active.supabase_anon_key_fingerprint) {
      violations.push({
        rule: "R2", layer, severity: "error",
        detail: `SUPABASE_ANON_KEY 지문 불일치 (기대 ${active.supabase_anon_key_fingerprint}, 실제 ${fingerprint(anon.value)})`,
      });
    }
  }

  if (checkSecrets) {
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
      const ex = findException(exceptions, r.code, idName);
      if (ex) {
        violations.push({
          rule: "R4", layer, severity: "waived",
          blocksRelease: ex.blocks_release === true,
          exceptionId: ex.id ?? null,
          detail: `타 리전(${r.code}) 공개 식별자 '${idName}' 가 포함되어 있다 — ${ex.id ?? "known_exceptions"} 로 유예됨`
            + (ex.blocks_release === true ? " (blocks_release=true — 출시 빌드에서는 차단)" : ""),
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
      detail: "BUILD_MANIFEST supabase_project_ref 가 선언 리전의 ref 와 다르다",
    });
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

function walkFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    let st;
    try { st = statSync(abs); } catch { continue; }
    if (st.isDirectory()) walkFiles(abs, out);
    else if (SCANNABLE_EXT.has(path.extname(name).toLowerCase())) out.push(abs);
  }
  return out;
}

export function runGuard(root, { layers = null } = {}) {
  const { regions, activeRegion, exceptions } = loadConfig(root);
  const results = [];
  const scanned = [];
  const want = (name) => layers === null || layers.includes(name);
  const base = { activeRegion, regions, exceptions };

  for (const [layer, rel] of CLIENT_LAYERS) {
    if (!want(layer)) continue;
    const abs = path.join(root, rel);
    if (!existsSync(abs)) continue;
    scanned.push({ layer, what: `entry (${rel})` });
    results.push(...auditLayer({ ...base, layer, content: readFileSync(abs, "utf8") }));
  }

  // index.html 외의 배포 자산도 시크릿/타리전 스캔한다(H2).
  const entryNames = new Set(CLIENT_LAYERS.map(([, rel]) => path.basename(rel)));
  for (const [layer, rel] of ASSET_SCAN_ROOTS) {
    if (!want(layer)) continue;
    const dir = path.join(root, rel);
    if (!existsSync(dir)) continue;
    let files = [];
    try { files = walkFiles(dir); } catch { continue; }
    let count = 0;
    for (const abs of files) {
      const b = path.basename(abs);
      if (entryNames.has(b) || b === "BUILD_MANIFEST.json") continue; // 위에서 이미 검사
      count++;
      results.push(...auditLayer({
        ...base,
        layer: `${layer}:${path.relative(dir, abs)}`,
        content: readFileSync(abs, "utf8"),
        checkConstants: false,
      }));
    }
    scanned.push({ layer, what: `assets (${rel}, ${count} files)` });
  }

  for (const [layer, rel] of MANIFEST_LAYERS) {
    if (!want(layer)) continue;
    const abs = path.join(root, rel);
    if (!existsSync(abs)) continue;
    scanned.push({ layer, what: `manifest (${rel})` });
    results.push(...auditManifest({ layer: `${layer}:manifest`, content: readFileSync(abs, "utf8"), activeRegion, regions }));
  }

  const wfDir = path.join(root, ".github/workflows");
  if (want("ci") && existsSync(wfDir)) {
    for (const f of readdirSync(wfDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))) {
      scanned.push({ layer: "ci", what: `ci (.github/workflows/${f})` });
      results.push(...auditLayer({
        ...base,
        layer: `ci:${f}`,
        content: readFileSync(path.join(wfDir, f), "utf8"),
        checkConstants: false,
        checkSecrets: false,
      }));
    }
  }

  // R7 — 요청된 필수 계층이 실제로 검사되지 않았다면 "검사 0건 = 통과" 를 막는다(M2).
  const scannedLayers = new Set(scanned.map((s) => s.layer));
  for (const req of REQUIRED_LAYERS) {
    if (!want(req)) continue;
    if (!scannedLayers.has(req)) {
      results.push({
        rule: "R7", layer: req, severity: "error",
        detail: `필수 계층 '${req}' 을 검사하지 못했다 — 결과를 통과로 취급하지 않는다`,
      });
    }
  }

  return { activeRegion, scanned: scanned.map((s) => s.what), violations: results };
}

/** 위반 목록을 차단/유예로 가른다. releaseMode 면 blocks_release 유예도 차단으로 승격한다(M4). */
export function classify(violations, { releaseMode = false } = {}) {
  const blocking = [];
  const waived = [];
  for (const v of violations) {
    if (v.severity !== "waived") { blocking.push(v); continue; }
    if (releaseMode && v.blocksRelease) blocking.push({ ...v, severity: "error", promoted: true });
    else waived.push(v);
  }
  return { blocking, waived };
}

// ── CLI ────────────────────────────────────────────────────────────────────
// 경로에 공백/한글이 있거나 심볼릭 링크를 경유하면 import.meta.url 은 퍼센트
// 인코딩되고 process.argv[1] 은 원문이라 단순 문자열 비교가 항상 실패한다.
// 그 경우 CLI 블록이 통째로 건너뛰어져 "아무 검사도 안 했는데 exit 0" 이 된다.
// 실제 경로로 정규화해 비교한다.
const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  // 퍼센트 인코딩(공백/한글)과 심볼릭 링크(macOS 의 /var → /private/var 등)를
  // 모두 흡수하려면 실제 경로까지 해석해 비교해야 한다.
  const real = (p) => { try { return realpathSync(p); } catch { return path.resolve(p); } };
  try { return real(fileURLToPath(import.meta.url)) === real(fileURLToPath(pathToFileURL(path.resolve(entry)).href)); }
  catch { return false; }
})();

if (invokedDirectly) {
  const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  const releaseMode = process.argv.includes("--release");
  let out;
  try {
    out = runGuard(root);
  } catch (err) {
    console.error(`region-guard: 설정을 읽지 못했다 — ${err.message}`);
    process.exit(1);
  }
  const { activeRegion, scanned, violations } = out;
  const { blocking, waived } = classify(violations, { releaseMode });

  console.log(`region-guard: active region = ${activeRegion}${releaseMode ? " (release mode)" : ""}`);
  console.log(`region-guard: scanned ${scanned.length} layer(s):`);
  for (const s of scanned) console.log(`  - ${s}`);

  for (const v of waived) console.log(`  WAIVED  [${v.rule}] ${v.layer}: ${v.detail}`);
  for (const v of blocking) {
    console.error(`  ${v.severity.toUpperCase()}${v.promoted ? " (release-promoted)" : ""} [${v.rule}] ${v.layer}: ${v.detail}`);
  }

  if (blocking.length) {
    console.error(`region-guard: FAIL — ${blocking.length} blocking violation(s)`);
    process.exit(1);
  }
  console.log(`region-guard: PASS (${waived.length} waived)`);
}
