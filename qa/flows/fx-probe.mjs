import { login } from "./lib.mjs";
const a = await login("jabal", "qaAdmin123");
console.log("fx", JSON.stringify((await a("GET", "/fx/current")).json).slice(0, 400));
