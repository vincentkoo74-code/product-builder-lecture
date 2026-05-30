import { cp, mkdir, rm } from "node:fs/promises";

const dist = new URL("../dist/", import.meta.url);
const root = new URL("../", import.meta.url);

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const file of ["index.html", "main.js", "style.css", "privacy.html", "terms.html", "account-delete.html", "oauth-bridge.html"]) {
  await cp(new URL(file, root), new URL(file, dist), { force: true });
}

await mkdir(new URL("ASSETS", dist), { recursive: true });
for (const dir of ["fonts", "rps"]) {
  await cp(new URL(`ASSETS/${dir}`, root), new URL(`ASSETS/${dir}`, dist), { recursive: true, force: true });
}

console.log("Built web assets into dist/");
