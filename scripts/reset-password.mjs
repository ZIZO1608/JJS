// Set a new password for a user when nobody can log in.
//   node scripts/reset-password.mjs                      → list the users
//   node scripts/reset-password.mjs <username> <newpass> → set the password (and re-activate the user)
// On the server: open the container terminal in Coolify and run it from /app.
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = path.join(process.env.JJS_DATA_DIR ?? path.join(root, "data"), "jjs.db");
const db = new Database(dbPath);
const [username, password] = process.argv.slice(2);

const list = () =>
  db
    .prepare("select u.username, u.name, r.name_en as role, u.active, u.deleted_at from users u left join roles r on r.id = u.role_id order by u.created_at")
    .all()
    .forEach((u) => console.log(`  ${u.username.padEnd(20)} ${u.name.padEnd(20)} ${u.role}${u.deleted_at ? "  (deleted)" : u.active ? "" : "  (inactive)"}`));

if (!username) {
  console.log(`Users in ${dbPath}:`);
  list();
  process.exit(0);
}
if (!password || password.length < 6) {
  console.error("The new password must be at least 6 characters.");
  process.exit(1);
}
const now = new Date().toISOString();
const r = db
  .prepare("update users set password_hash = ?, active = 1, deleted_at = null, updated_at = ?, synced_at = null where username = ?")
  .run(bcrypt.hashSync(password, 10), now, username.trim().toLowerCase());
if (!r.changes) {
  console.error(`No user called "${username}". The users are:`);
  list();
  process.exit(1);
}
db.prepare("delete from sessions where user_id = (select id from users where username = ?)").run(username.trim().toLowerCase());
console.log(`Password changed for "${username}". Log in with the new password.`);
