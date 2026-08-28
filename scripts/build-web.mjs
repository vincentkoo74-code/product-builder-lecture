import { cp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { syncGameLogic } from "./sync-game-logic.mjs";
import { syncEngine } from "./sync-engine.mjs";
import { buildManifest, readBuildNumber, KR_BACKEND_REF, JP_BACKEND_REF, RELEASE_LABEL, VALID_PLATFORMS } from "./build-manifest.mjs";

// ── KR-B37 플랫폼 분리 게이트 ────────────────────────────────────────────────
// 네이티브 빌드(ios/android)는 아래를 모두 만족해야 산출물이 나온다. 하나라도 어긋나면
// **빌드를 중단한다**(fail-closed) — 잘못된 백엔드/리전/공유URL을 실은 APK·IPA가
// 조용히 만들어져 필드 QA 증적을 오염시키는 것을 구조적으로 막는다.
const PLATFORM = process.env.MARU_PLATFORM || "";
const REGION = process.env.MARU_REGION || "";
const SHARE_BASE = process.env.MARU_SHARE_BASE_URL || "";
const isNative = PLATFORM === "ios" || PLATFORM === "android";
const fail = (msg) => { throw new Error(`[build-gate] ${msg}`); };

if (PLATFORM && !VALID_PLATFORMS.includes(PLATFORM)) {
  fail(`MARU_PLATFORM='${PLATFORM}' 은 유효하지 않다 (${VALID_PLATFORMS.join("|")})`);
}
if (isNative) {
  if (!REGION) fail("네이티브 빌드에 MARU_REGION 이 지정되지 않았다");
  if (REGION !== "KR") fail(`MARU_REGION='${REGION}' — 이 브랜치는 KR 전용이다`);
  if (!SHARE_BASE) fail("네이티브 빌드에 MARU_SHARE_BASE_URL 이 지정되지 않았다 (초대 링크가 LAN IP로 나간다)");
  const banned = [/localhost/i, /127\.0\.0\.1/, /192\.168\./, /^capacitor:\/\//i, /::1/];
  for (const re of banned) {
    if (re.test(SHARE_BASE)) fail(`MARU_SHARE_BASE_URL='${SHARE_BASE}' 에 외부에서 열 수 없는 호스트가 있다 (${re})`);
  }
  if (!/^https:\/\//i.test(SHARE_BASE)) fail(`MARU_SHARE_BASE_URL='${SHARE_BASE}' 은 https:// 로 시작해야 한다`);
}
// 출력 디렉터리를 플랫폼별로 가른다. 규율이 아니라 **경로**로 격리한다 —
// dist 하나를 공유하면 `cap sync ios` 직후 `cap sync android` 가 iOS용 산출물을 그대로 집어간다.
const OUT_DIR = isNative ? `dist/${PLATFORM}-kr/` : "dist/";

// 빌드 전 순수 로직(src/game-logic.mjs)을 index.html 인라인 블록에 동기화한다.
const synced = await syncGameLogic();
if (synced) console.log("Synced src/game-logic.mjs into index.html");

const dist = new URL(`../${OUT_DIR}`, import.meta.url);
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
// KR-B37: 출력 디렉터리가 플랫폼별로 갈렸으므로 주입 대상 경로를 명시한다
// (syncEngine 기본값은 dist/index.html 하드코딩이라 플랫폼 경로를 모른다).
const engineSynced = await syncEngine({ htmlPath: new URL("index.html", dist) });
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
  console.log(`QA_BUILD=1: set __QA_BUILD__=true in ${OUT_DIR}index.html (instrumented build)`);
}

// 네이티브 빌드: 공유 URL base 를 산출물에만 주입한다(root source 는 "" 유지).
if (isNative) {
  const distIndex = new URL("index.html", dist);
  const html = await readFile(distIndex, "utf8");
  const needle = '"" /*__SHARE_BASE_URL__*/';
  if (!html.includes(needle)) {
    fail("__SHARE_BASE_URL__ 마커를 찾지 못했다 — 주입 실패를 조용히 넘기지 않는다");
  }
  const normalized = SHARE_BASE.replace(/\/+$/, "");
  await writeFile(distIndex, html.replace(needle, `${JSON.stringify(normalized)} /*__SHARE_BASE_URL__*/`));
  console.log(`SHARE_BASE_URL 주입: ${normalized}`);
}

// BUILD_MANIFEST.json — dist 에만 생성(root source 무오염). QA/release 모두 생성하되 값이 다름.
const isQA = process.env.QA_BUILD === "1";
const gitOut = (cmd) => {
  try { return execSync(cmd, { cwd: new URL(".", root) }).toString().trim(); }
  catch { return "unknown"; }
};
let pbxproj = "";
try { pbxproj = await readFile(new URL("ios/App/App.xcodeproj/project.pbxproj", root), "utf8"); } catch { /* keep empty */ }
const manifest = buildManifest({
  qa: isQA,
  build: readBuildNumber(pbxproj),
  branch: gitOut("git rev-parse --abbrev-ref HEAD"),
  commit: gitOut("git rev-parse HEAD"),
  buildTime: new Date().toISOString(),
  platform: PLATFORM || "web",
  region: REGION || "KR",
  backendRef: KR_BACKEND_REF,
  releaseLabel: RELEASE_LABEL,
});
await writeFile(new URL("BUILD_MANIFEST.json", dist), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Wrote ${OUT_DIR}BUILD_MANIFEST.json (platform=${manifest.platform}, region=${manifest.region}, ref=${manifest.backend_ref}, build ${manifest.build}, qa=${manifest.qa_enabled})`);

// 산출물 사후 검사: 소스가 맞아도 빌드 과정에서 오염될 수 있으므로 결과물을 다시 읽어 확인한다.
{
  const outHtml = await readFile(new URL("index.html", dist), "utf8");
  if (outHtml.includes(JP_BACKEND_REF)) fail(`산출물에 Tokyo ref(${JP_BACKEND_REF})가 있다`);
  if (!outHtml.includes(KR_BACKEND_REF)) fail(`산출물에 Seoul ref(${KR_BACKEND_REF})가 없다`);
  if (isNative) {
    const m = /const SHARE_BASE_URL = "([^"]*)"/.exec(outHtml);
    if (!m || !m[1]) fail("산출물의 SHARE_BASE_URL 이 비어 있다");
    console.log(`region/share 게이트: PASS (platform=${PLATFORM}, share=${m[1]})`);
  }
}

console.log(`Built web assets into ${OUT_DIR}`);
