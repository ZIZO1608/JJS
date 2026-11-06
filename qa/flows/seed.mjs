import { login } from "./lib.mjs";
const a = await login("jabal", process.env.QA_PASS_ADMIN ?? "qaAdmin123");
console.log("demo", (await a("POST", "/system/demo-data")).json);
const cl = (await a("GET", "/clients")).json;
const list = cl.clients ?? cl.rows ?? cl;
console.log("clients", list.length, list.map((c) => c.name));
const first = list[0];
console.log("portal", (await a("POST", `/clients/${first.id}/portal`, { username: "qaclient", password: "qaClient123" })).json);
