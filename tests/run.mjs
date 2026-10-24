// npm test — builds nothing; run `npm run build` first.
// Starts the built server on a throwaway data folder for each suite, runs it, stops it.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const suites = [["api-smoke.mjs"], ["api-full.mjs", "api-sync.mjs"], ["api-wholesale.mjs"], ["api-portal.mjs"]];
let failed = 0;
let port = 4391;
for (const files of suites) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jjs-test-"));
  const p = port++;
  const server = spawn(process.execPath, ["dist/server/server/index.js"], { env: { ...process.env, JJS_DATA_DIR: dir, PORT: String(p) }, stdio: "ignore" });
  const base = `http://127.0.0.1:${p}`;
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  for (const f of files) {
    const code = await new Promise((r) => spawn(process.execPath, [path.join("tests", f)], { env: { ...process.env, BASE: base }, stdio: "inherit" }).on("exit", r));
    if (code) failed++;
  }
  // Wait for the server to exit before deleting: on Windows the open database file blocks removal.
  const exited = new Promise((r) => server.once("exit", r));
  server.kill();
  await exited;
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
console.log(failed ? `\n${failed} suite(s) failed` : "\nAll API suites passed");
process.exit(failed ? 1 : 0);
