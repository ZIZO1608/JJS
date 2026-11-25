// Puts everything the shop laptop needs into one folder: release/JJs-ERP-Setup-<version>/
//   1-JJs-ERP-Server-Setup.exe, 2-JJs-ERP-Setup.exe, "Install JJ's ERP.bat", READ ME, first-day sheet.
// Run with:  npm run dist:win:kit   (builds both installers first; Windows only)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const out = path.join(root, "release", `JJs-ERP-Setup-${version}`);

const installer = (dir, product) => {
  const file = path.join(root, "release", dir, `${product} Setup ${version}.exe`);
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}. Run "npm run dist:win:two" first.`);
  return file;
};

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(installer("server", "JJ's ERP Server"), path.join(out, "1-JJs-ERP-Server-Setup.exe"));
fs.copyFileSync(installer("client", "JJ's ERP"), path.join(out, "2-JJs-ERP-Setup.exe"));
const kit = path.join(root, "build", "client-kit");
for (const f of fs.readdirSync(kit)) fs.copyFileSync(path.join(kit, f), path.join(out, f));
const sheet = path.join(root, "docs", "first-day", "JJs-first-day-sheet.pdf");
if (fs.existsSync(sheet)) fs.copyFileSync(sheet, path.join(out, "JJs-first-day-sheet.pdf"));

console.log(`Setup kit ready: ${out}`);
for (const f of fs.readdirSync(out)) console.log(`  ${f}  (${(fs.statSync(path.join(out, f)).size / 1048576).toFixed(1)} MB)`);
