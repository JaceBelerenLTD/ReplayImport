import path from "node:path";
import fs from "node:fs";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const dbPath = path.join(process.cwd(), "apps", "api", "data", "rankings.sqlite");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

async function openDb() {
  const db = await open({ filename: dbPath, driver: sqlite3.Database });

  await db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS rankings_player (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rankings_match (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      file_name TEXT,
      map TEXT,
      duration_sec INTEGER,
      replay_id TEXT UNIQUE,
      result TEXT NOT NULL,
      delta INTEGER NOT NULL DEFAULT 15,
      replay_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rankings_match_player (
      match_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      team TEXT NOT NULL CHECK(team IN ('A','B')),
      PRIMARY KEY (match_id, player_id),
      FOREIGN KEY(match_id) REFERENCES rankings_match(id) ON DELETE CASCADE,
      FOREIGN KEY(player_id) REFERENCES rankings_player(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS rankings_ingest_log (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      status TEXT NOT NULL,
      message TEXT NOT NULL,
      file_name TEXT,
      map TEXT,
      duration_sec INTEGER,
      result TEXT
    );
  `);

  return db;
}

export const dbPromise = openDb();
