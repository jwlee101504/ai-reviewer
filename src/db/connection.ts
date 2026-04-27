import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type Db = Database.Database;

export function openDb(file = "data/bot.sqlite"): Db {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}
