import Database from 'better-sqlite3';
import { config, ensureDataDirs } from './config.js';

ensureDataDirs();
export const db = new Database(config.databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_scan_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY,
    folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    path TEXT NOT NULL UNIQUE,
    relative_path TEXT NOT NULL,
    filename TEXT NOT NULL,
    size INTEGER NOT NULL,
    modified_ms REAL NOT NULL,
    file_key TEXT,
    title TEXT NOT NULL,
    sort_title TEXT NOT NULL,
    media_type TEXT NOT NULL DEFAULT 'other',
    year INTEGER,
    description TEXT NOT NULL DEFAULT '',
    genres TEXT NOT NULL DEFAULT '[]',
    runtime_seconds REAL,
    width INTEGER,
    height INTEGER,
    video_codec TEXT,
    audio_codec TEXT,
    container TEXT,
    season_number INTEGER,
    episode_number INTEGER,
    show_title TEXT,
    poster_path TEXT,
    backdrop_path TEXT,
    thumbnail_path TEXT,
    external_source TEXT,
    external_id TEXT,
    metadata_locked INTEGER NOT NULL DEFAULT 0,
    added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_scan TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_media_folder ON media(folder_id);
  CREATE INDEX IF NOT EXISTS idx_media_type ON media(media_type);
  CREATE INDEX IF NOT EXISTS idx_media_sort ON media(sort_title);

  CREATE TABLE IF NOT EXISTS progress (
    media_id INTEGER PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
    position_seconds REAL NOT NULL DEFAULT 0,
    duration_seconds REAL,
    completed INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const settingGet = db.prepare('SELECT value FROM settings WHERE key = ?');
const settingSet = db.prepare(`INSERT INTO settings(key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value=excluded.value`);

export function getSetting(key, fallback = null) {
  const row = settingGet.get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

export function setSetting(key, value) {
  settingSet.run(key, JSON.stringify(value));
}
