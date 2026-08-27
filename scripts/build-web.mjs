import { cp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { syncGameLogic } from "./sync-game-logic.mjs";
import { syncEngine } from "./sync-engine.mjs";
import { buildManifest, readBuildNumber } from "./build-manifest.mjs";
import { runGuard, classify } from "./region-guard.mjs";
import { fileURLToPath } from "node:url";

// 빌드 전 순수 로직(src/game-logic.mjs)을 index.html 인라인 블록에 동기화한다.
const synced = await syncGameLogic();
if (synced) console.log("Synced src/game-logic.mjs into index.html");

const dist = new URL("../dist/", import.meta.url);
const root = new URL("../", import.meta.url);

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const file of ["index.html", "main.js", "style.css", "privacy.html", "terms.html", "account-delete.html", "oauth-bridge.html"]) {
  await cp(new URL(file, root), new URL(file, dist), { force: true });
}

await mkdir(new URL("ASSETS", dist), { recursive: true });
for (const dir of ["fonts", "rps", "vendor", "build8"]) {
  await cp(new URL(`ASSETS/${dir}`, root), new URL(`ASSETS/${dir}`, dist), { recursive: true, force: true });
}

// WRPS-049 STEP2.2: v2 엔진 번들을 dist/index.html 에만 주입(라이브 root 무변경, 기본 OFF inert).
const engineSynced = await syncEngine();
if (engineSynced) console.log("Injected v2 engine bundle into dist/index.html");

// QA_BUILD=1: dist/index.html 에서만 __QA_BUILD__ 플래그를 true 로 치환(네이티브 QA 자동-ON).
// 출시 빌드(QA_BUILD 미설정)는 false 그대로 유지 → production 동작 무변경.
if (process.env.QA_BUILD === "1") {
  const distIndex = new URL("index.html", dist);
  const html = await readFile(distIndex, "utf8");
  const needle = "false /*__QA_BUILD_FLAG__*/";
  if (!html.includes(needle)) {
    throw new Error("QA_BUILD=1: __QA_BUILD_FLAG__ marker not found in dist/index.html — aborting to avoid silent OFF build");
  }
  await writeFile(distIndex, html.replace(needle, "true /*__QA_BUILD_FLAG__*/"));
  console.log("QA_BUILD=1: set __QA_BUILD__=true in dist/index.html (instrumented build)");
}

// BUILD_MANIFEST.json — dist 에만 생성(root source 무오염). QA/release 모두 생성하되 값이 다름.
const isQA = process.env.QA_BUILD === "1";
const gitOut = (cmd) => {
  try { return execSync(cmd, { cwd: new URL(".", root) }).toString().trim(); }
  catch { return "unknown"; }
};
let pbxproj = "";
try { pbxproj = await readFile(new URL("ios/App/App.xcodeproj/project.pbxproj", root), "utf8"); } catch { /* keep empty */ }
// V1.0_JP: 이 빌드가 어느 국가를 향하는지 config/active-region.json 에서 읽어 매니페스트에 스탬프한다.
const activeRegionCfg = JSON.parse(await readFile(new URL("config/active-region.json", root), "utf8"));
const regionRegistry = JSON.parse(await readFile(new URL("config/regions.json", root), "utf8"));
const activeRegion = activeRegionCfg.region;
const activeProfile = regionRegistry.regions[activeRegion];
if (!activeProfile) {
  throw new Error(`config/active-region.json 의 region='${activeRegion}' 이 config/regions.json 에 없다`);
}

const manifest = buildManifest({
  qa: isQA,
  build: readBuildNumber(pbxproj),
  branch: gitOut("git rev-parse --abbrev-ref HEAD"),
  commit: gitOut("git rev-parse HEAD"),
  buildTime: new Date().toISOString(),
  region: activeRegion,
  supabaseProjectRef: activeProfile.supabase_project_ref,
});
await writeFile(new URL("BUILD_MANIFEST.json", dist), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Wrote dist/BUILD_MANIFEST.json (build ${manifest.build}, qa_enabled=${manifest.qa_enabled}, mode=${manifest.release_mode})`);

// V1.0_JP fail-closed 가드: 이 빌드가 만든 계층(source/dist)에 타 국가 백엔드나
// 자격증명이 섞여 있으면 여기서 빌드를 중단한다. 네이티브 계층(ios/android)은
// `npx cap sync` 이후 `npm run guard:region` 으로 별도 검사한다.
{
  // fileURLToPath 사용: URL.pathname 은 공백/한글을 퍼센트 인코딩된 채로 돌려주어
  // path.join 에 넘기면 존재하지 않는 경로가 된다.
  const { violations } = runGuard(fileURLToPath(root), { layers: ["source", "dist"] });
  const { blocking, waived } = classify(violations, { releaseMode: process.env.MARU_RELEASE_BUILD === "1" });
  for (const v of waived) {
    console.warn(`region-guard WAIVED [${v.rule}] ${v.layer}: ${v.detail}`);
  }
  if (blocking.length) {
    for (const v of blocking) console.error(`region-guard ${v.severity.toUpperCase()} [${v.rule}] ${v.layer}: ${v.detail}`);
    throw new Error(`region-guard: ${activeRegion} 빌드에 ${blocking.length}건의 리전 위반 — 빌드 중단`);
  }
  console.log(`region-guard: PASS (region=${activeRegion}, ref=${activeProfile.supabase_project_ref})`);
}

console.log("Built web assets into dist/");
