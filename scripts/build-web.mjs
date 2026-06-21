import { cp, mkdir, rm } from "node:fs/promises";
import { syncGameLogic } from "./sync-game-logic.mjs";

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
for (const dir of ["fonts", "rps", "vendor"]) {
  await cp(new URL(`ASSETS/${dir}`, root), new URL(`ASSETS/${dir}`, dist), { recursive: true, force: true });
}

console.log("Built web assets into dist/");
