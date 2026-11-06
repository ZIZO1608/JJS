// QA-005: closing a day must not count money from later days.
// Puts a $100 cash move dated tomorrow into the QA database, then closes today with the
// expected amount the screen shows. The recorded difference must be 0.
//   JJS_DATA_DIR=<qa data folder> BASE=http://127.0.0.1:4420 node qa/flows/close-past-day.mjs
import path from "node:path";
import Database from "better-sqlite3";
import { login } from "./lib.mjs";

const a = await login("jabal", "qaAdmin123");
const today = new Date();
const p2 = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const tomorrow = ymd(new Date(today.getTime() + 864e5));
const date = ymd(today);

const db = new Database(path.join(process.env.JJS_DATA_DIR, "jjs.db"));
const main = db.prepare("select * from cash_boxes where system_key = 'main_cash' and deleted_at is null").get();
const cols = db.prepare("pragma table_info(box_moves)").all().map((c) => c.name);
const sample = db.prepare("select * from box_moves where box_id = ? limit 1").get(main.id);
if (!sample) throw new Error("no box move to copy; run retest.mjs first");
const row = { ...sample, id: "qa-tomorrow-" + Date.now(), amount: 100, amount_usd: 100, business_date: tomorrow, type: "deposit", note: "QA: tomorrow's cash" };
db.prepare(`insert into box_moves (${cols.join(",")}) values (${cols.map(() => "?").join(",")})`).run(...cols.map((c) => row[c] ?? null));
db.close();

const view = (await a("GET", `/days/${date}`)).json;
const shown = view.cashFlow.expected;
const closed = (await a("POST", `/days/${date}/close`, { counted: shown })).json;
const diff = closed.day?.differenceUsd ?? closed.day?.difference;
console.log(`${Math.abs(diff ?? 1) < 0.001 ? "PASS" : "FAIL"}  QA-005  screen expected ${shown}, counted ${shown}, recorded difference ${diff} (a $100 move sits on ${tomorrow})`);
