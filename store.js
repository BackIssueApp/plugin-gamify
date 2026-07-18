// Gamify state: XP bonuses, freeze tokens, goals, unlocked achievements and the
// quest board — in plugin-owned tables inside catalog.db (so DB backups cover
// them), own connection, core never touches these. Reading history itself stays
// in the reader plugin's tables; everything here is derived rewards state.
import Database from 'better-sqlite3';

export function openGamifyStore(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS gamify_user (
      user_id     INTEGER PRIMARY KEY,
      xp_bonus    INTEGER NOT NULL DEFAULT 0,  -- quest/achievement XP on top of reading XP
      tokens      INTEGER NOT NULL DEFAULT 0,  -- streak freeze tokens
      goal_target INTEGER NOT NULL DEFAULT 0,  -- issues per year (0 = no goal)
      opt_out     INTEGER NOT NULL DEFAULT 0,  -- hidden from household leaderboard/co-op
      last_level  INTEGER NOT NULL DEFAULT 0   -- for level-up notifications
    );
    CREATE TABLE IF NOT EXISTS gamify_achievements (
      user_id     INTEGER NOT NULL,
      key         TEXT NOT NULL,
      unlocked_at TEXT NOT NULL,
      PRIMARY KEY (user_id, key)
    );
    CREATE TABLE IF NOT EXISTS gamify_quests (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER,                    -- NULL = household co-op quest
      kind         TEXT NOT NULL,              -- count | set | finish_series | finish_list | coop
      title        TEXT NOT NULL,
      params       TEXT NOT NULL DEFAULT '{}', -- JSON: issueIds, cvSeriesId, listId, …
      target       INTEGER NOT NULL,
      xp           INTEGER NOT NULL DEFAULT 0,
      period_start TEXT NOT NULL,              -- YYYY-MM-DD inclusive
      period_end   TEXT NOT NULL,              -- YYYY-MM-DD inclusive
      status       TEXT NOT NULL DEFAULT 'active', -- active | done | expired | rerolled
      done_at      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_gq_user ON gamify_quests(user_id, status, period_end);
    CREATE TABLE IF NOT EXISTS gamify_freezes (
      user_id INTEGER NOT NULL,
      day     TEXT NOT NULL,                   -- YYYY-MM-DD covered by a freeze token
      PRIMARY KEY (user_id, day)
    );
  `);
  return db;
}

export function gamifyUser(db, userId) {
  db.prepare('INSERT OR IGNORE INTO gamify_user (user_id) VALUES (?)').run(userId);
  return db.prepare('SELECT * FROM gamify_user WHERE user_id = ?').get(userId);
}
