import { post } from "./api";

const healthy = async () => {
  try {
    return (await fetch("/api/health", { cache: "no-store" })).ok;
  } catch {
    return false;
  }
};
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Ask the desktop server to restart (a pending restore or phone access then applies),
 * wait for it to go down and come back, then reload the page.
 * Throws the server's error when it cannot restart itself (e.g. run with `npm start`).
 */
export async function restartShop(): Promise<void> {
  await post("/system/restart");
  for (let i = 0; i < 20 && (await healthy()); i++) await pause(500);
  for (let i = 0; i < 120 && !(await healthy()); i++) await pause(1000);
  window.location.reload();
}
