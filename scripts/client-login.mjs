// Give a client a portal login with a username and password you choose.
//   node scripts/client-login.mjs                                      → list the client logins
//   node scripts/client-login.mjs "<client name>" <username> <password> → make or update the login
// The client is created (as a business) if no client has that name yet.
// On the server: open the container terminal in Coolify and run it from /app.
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import { v7 as uuidv7 } from "uuid";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = path.join(process.env.JJS_DATA_DIR ?? path.join(root, "data"), "jjs.db");
const db = new Database(dbPath);
const [clientName, rawUsername, password] = process.argv.slice(2);

if (!clientName) {
  console.log(`Client logins in ${dbPath}:`);
  db.prepare("select a.username, c.name, a.active, a.last_login_at from client_accounts a join clients c on c.id = a.client_id where a.deleted_at is null order by c.name")
    .all()
    .forEach((a) => console.log(`  ${a.username.padEnd(20)} ${a.name.padEnd(28)} ${a.active ? "" : "(stopped) "}${a.last_login_at ? `last sign-in ${a.last_login_at.slice(0, 16)}` : "never signed in"}`));
  process.exit(0);
}
const username = (rawUsername ?? "").trim().toLowerCase();
if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
  console.error("The username needs 3–40 English letters, numbers, dot, dash or underscore.");
  process.exit(1);
}
if (!password || password.length < 6) {
  console.error("The password must be at least 6 characters.");
  process.exit(1);
}

const now = new Date().toISOString();
db.transaction(() => {
  let client = db.prepare("select id, name from clients where lower(name) = lower(?) and deleted_at is null").get(clientName.trim());
  const taken = db.prepare("select client_id from client_accounts where username = ?").get(username);
  if (taken && taken.client_id !== client?.id) {
    console.error(`The username "${username}" belongs to another client. Pick another one.`);
    process.exit(1);
  }
  if (!client) {
    client = { id: uuidv7(), name: clientName.trim() };
    db.prepare("insert into clients (id, type, name, active) values (?, 'business', ?, 1)").run(client.id, client.name);
    console.log(`Created the client "${client.name}".`);
  }
  const hash = bcrypt.hashSync(password, 10);
  const account = db.prepare("select id from client_accounts where client_id = ?").get(client.id);
  if (account) {
    db.prepare("update client_accounts set username = ?, password_hash = ?, active = 1, must_change_password = 0, deleted_at = null, updated_at = ?, synced_at = null where id = ?").run(username, hash, now, account.id);
    db.prepare("delete from client_sessions where account_id = ?").run(account.id);
  } else {
    db.prepare("insert into client_accounts (id, client_id, username, password_hash, must_change_password) values (?, ?, ?, ?, 0)").run(uuidv7(), client.id, username, hash);
  }
  console.log(`"${client.name}" can sign in at /portal with  ${username} / ${password}`);
})();
