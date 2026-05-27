// Apple Sign In Client Secret JWT 생성기
//
// 사용법:
//   1. npm install jose (한 번만)
//   2. 이 파일의 상단 4개 상수를 본인 값으로 수정
//   3. .p8 파일을 P8_PATH 위치에 복사
//   4. node scripts/generate-apple-jwt.mjs
//   5. 출력된 JWT를 Supabase Apple Provider 의 "Secret Key (for OAuth)" 에 붙여넣기
//
// ⚠️ JWT 는 180일 후 만료 — 6개월마다 이 스크립트 다시 실행 + Supabase 갱신 필요

import { SignJWT, importPKCS8 } from "jose";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ========================================
// 여기를 본인 값으로 수정 (4개)
// ========================================
const TEAM_ID   = "3JN8PM3TPS";              // Apple Developer Team ID (Console 우상단)
const KEY_ID    = "S2B6746YKA";    // .p8 다운로드 시 받은 10자리 Key ID
const CLIENT_ID = "com.maru.rps.web";        // Services ID (com.maru.rps.web)
const P8_FILE   = "AuthKey_S2B6746YKA.p8"; // .p8 파일명
// ========================================

const p8Path = resolve(__dirname, "..", P8_FILE);

let keyText;
try {
  keyText = readFileSync(p8Path, "utf8");
} catch (e) {
  console.error("\n❌ .p8 파일을 못 읽음:", p8Path);
  console.error("   파일을 위 경로에 복사한 후 다시 시도하세요.\n");
  process.exit(1);
}

const privateKey = await importPKCS8(keyText, "ES256");

const ISSUED_AT  = Math.floor(Date.now() / 1000);
const SIX_MONTHS = 60 * 60 * 24 * 180; // Apple 최대 허용 (180일)
const EXP        = ISSUED_AT + SIX_MONTHS;

const jwt = await new SignJWT({})
  .setProtectedHeader({ alg: "ES256", kid: KEY_ID })
  .setIssuer(TEAM_ID)
  .setIssuedAt(ISSUED_AT)
  .setExpirationTime(EXP)
  .setAudience("https://appleid.apple.com")
  .setSubject(CLIENT_ID)
  .sign(privateKey);

console.log("\n=== Apple Client Secret JWT ===\n");
console.log(jwt);
console.log("\n=== 정보 ===");
console.log("  Issued at:  ", new Date(ISSUED_AT * 1000).toISOString());
console.log("  Expires at: ", new Date(EXP * 1000).toISOString(), "(180일 후)");
console.log("\n복사해서 Supabase Apple Provider 의 'Secret Key (for OAuth)' 에 붙여넣기");
console.log("⚠️  180일 후 재생성 + Supabase 갱신 필수\n");
