'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

/**
 * 打开（必要时初始化）SQLite 数据库。
 *
 * 数据模型：
 *  - fixtures / cues          当前草稿（可反复增删改）
 *  - versions                 已发布的不可变演出版本（仅追加，绝不修改/删除）
 *  - version_fixtures/cues    发布时刻的快照数据，播放端只读取这些表
 */
function openDb(dbPath) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS fixtures (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cues (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      cue_no       INTEGER NOT NULL UNIQUE,
      fixture_id   INTEGER NOT NULL REFERENCES fixtures(id) ON DELETE RESTRICT,
      trigger_time REAL    NOT NULL,
      target_level REAL    NOT NULL,
      duration     REAL    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cues_time ON cues(trigger_time, cue_no);

    CREATE TABLE IF NOT EXISTS versions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      version_no INTEGER NOT NULL UNIQUE,
      note       TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS version_fixtures (
      version_id        INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
      fixture_ref_id    INTEGER NOT NULL,
      name              TEXT NOT NULL,
      PRIMARY KEY (version_id, fixture_ref_id)
    );

    CREATE TABLE IF NOT EXISTS version_cues (
      version_id   INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
      cue_no       INTEGER NOT NULL,
      fixture_ref_id INTEGER NOT NULL,
      trigger_time REAL    NOT NULL,
      target_level REAL    NOT NULL,
      duration     REAL    NOT NULL,
      PRIMARY KEY (version_id, cue_no)
    );
    CREATE INDEX IF NOT EXISTS idx_vcues_time
      ON version_cues(version_id, trigger_time, cue_no);
  `);

  return db;
}

module.exports = { openDb };
