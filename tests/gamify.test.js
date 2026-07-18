// Engine + quest tests against a fixture database carrying minimal copies of
// the reader plugin's tables and the core CV tables the plugin reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openGamifyStore, gamifyUser } from '../store.js';
import { levelFor, xpOf, readStats, streakOf, maybeSpendFreeze, checkAchievements } from '../engine.js';
import { ensureBoard, ensureCoop, activeQuests, questProgress, refreshQuests, rerollQuest, weekStartOf } from '../quests.js';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamify-test-'));
  const db = openGamifyStore(path.join(dir, 'catalog.db'));
  db.exec(`
    CREATE TABLE reader_progress (user_id INTEGER, issue_id INTEGER, page INTEGER DEFAULT 0, pages INTEGER DEFAULT 0, completed INTEGER DEFAULT 0, updated_at TEXT, PRIMARY KEY (user_id, issue_id));
    CREATE TABLE reader_stats_daily (user_id INTEGER, day TEXT, pages INTEGER DEFAULT 0, completed INTEGER DEFAULT 0, PRIMARY KEY (user_id, day));
    CREATE TABLE cv_series (comicvine_id INTEGER PRIMARY KEY, name TEXT, publisher TEXT);
    CREATE TABLE cv_issues (comicvine_id INTEGER PRIMARY KEY, cv_series_id INTEGER, issue_number TEXT, cover_date TEXT);
    CREATE TABLE library_files (id INTEGER PRIMARY KEY AUTOINCREMENT, cv_issue_id INTEGER, valid INTEGER DEFAULT 1);
    CREATE TABLE reading_lists (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER DEFAULT 0, name TEXT, arc_cv_id INTEGER);
    CREATE TABLE reading_list_items (list_id INTEGER, position INTEGER, cv_issue_id INTEGER, PRIMARY KEY (list_id, cv_issue_id));
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, disabled INTEGER DEFAULT 0);
    INSERT INTO users VALUES (1,'alice',0),(2,'bob',0);
  `);
  return { db, dir };
}
const cleanup = (dir, db) => {
  try { db?.close(); } catch { /* already closed */ }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows lock lag */ }
};

// Seed a series of `n` issues; the first `read` are completed by user 1 through
// REAL reading (page pointer set + daily stats, like the reader records them).
function seedSeries(db, sid, name, n, read, { publisher = 'Image', startYear = 2010, day = '2026-07-10' } = {}) {
  db.prepare('INSERT INTO cv_series VALUES (?,?,?)').run(sid, name, publisher);
  for (let i = 1; i <= n; i++) {
    const id = sid * 1000 + i;
    db.prepare('INSERT INTO cv_issues VALUES (?,?,?,?)').run(id, sid, String(i), `${startYear + Math.floor(i / 13)}-0${(i % 9) + 1}-01`);
    db.prepare('INSERT INTO library_files (cv_issue_id) VALUES (?)').run(id);
    if (i <= read) db.prepare('INSERT INTO reader_progress VALUES (1,?,20,20,1,?)').run(id, day + 'T14:00:00Z');
  }
  if (read > 0) {
    db.prepare(`INSERT INTO reader_stats_daily VALUES (1,?,?,?)
      ON CONFLICT(user_id, day) DO UPDATE SET pages = pages + excluded.pages, completed = completed + excluded.completed`)
      .run(day, read * 20, read);
  }
}

test('levelFor: quadratic curve with titles', () => {
  assert.equal(levelFor(0).level, 0);
  assert.equal(levelFor(149).level, 0);
  assert.equal(levelFor(150).level, 1);
  assert.equal(levelFor(600).level, 2);
  assert.equal(xpOf({ issues: 2, pages: 44 }, 6), 150); // 2×50 + 44 + 6
  assert.ok(levelFor(150 * 144).title.length > 0); // clamps into TITLES
});

test('streakOf: consecutive days, gaps, and freeze coverage', () => {
  const { db, dir } = fixture();
  for (const day of ['2026-07-14', '2026-07-15', '2026-07-17']) {
    db.prepare('INSERT INTO reader_stats_daily VALUES (1,?,10,1)').run(day);
  }
  // Gap on the 16th breaks the run: current (from the 17th) = 1, best = 2.
  let s = streakOf(db, 1, '2026-07-17');
  assert.deepEqual({ c: s.current, b: s.best }, { c: 1, b: 2 });
  // A freeze token covering the 16th bridges it into one 4-day run.
  db.prepare('INSERT INTO gamify_freezes VALUES (1,?)').run('2026-07-16');
  s = streakOf(db, 1, '2026-07-17');
  assert.deepEqual({ c: s.current, b: s.best }, { c: 4, b: 4 });
  cleanup(dir, db);
});

test('maybeSpendFreeze: spends only with a live streak, a missed day, and a token', () => {
  const { db, dir } = fixture();
  db.prepare('INSERT INTO reader_stats_daily VALUES (1,?,10,1)').run('2026-07-15'); // day-before-yesterday
  gamifyUser(db, 1);
  assert.equal(maybeSpendFreeze(db, 1, '2026-07-17'), false); // no tokens
  db.prepare('UPDATE gamify_user SET tokens=1 WHERE user_id=1').run();
  assert.equal(maybeSpendFreeze(db, 1, '2026-07-17'), true);  // covers the 16th
  assert.equal(gamifyUser(db, 1).tokens, 0);
  assert.equal(streakOf(db, 1, '2026-07-17').current, 0 + 2 - 2 + 2, 'streak alive through the frozen day'); // 15th+16th run
  cleanup(dir, db);
});

test('checkAchievements: unlocks once, banks XP', () => {
  const { db, dir } = fixture();
  seedSeries(db, 5, 'Saga', 12, 12); // 12 completed issues, one full series
  db.prepare('INSERT INTO reader_stats_daily VALUES (1,?,120,3)').run('2026-07-11'); // marathon day
  const first = checkAchievements(db, 1, '2026-07-17');
  const keys = first.map((a) => a.key);
  assert.ok(keys.includes('first-issue'));
  assert.ok(keys.includes('issues-10'));
  assert.ok(keys.includes('series-complete'));
  assert.ok(keys.includes('marathon'));
  assert.ok(!keys.includes('issues-50'));
  const bonus = gamifyUser(db, 1).xp_bonus;
  assert.ok(bonus > 0);
  assert.equal(checkAchievements(db, 1, '2026-07-17').length, 0, 'idempotent');
  assert.equal(gamifyUser(db, 1).xp_bonus, bonus);
  cleanup(dir, db);
});

test('quest lifecycle: board generation, state-based progress, completion XP', () => {
  const { db, dir } = fixture();
  seedSeries(db, 7, 'Chew', 10, 8);       // 2 owned-unread → finish_series quest
  seedSeries(db, 9, 'Old Stuff', 6, 0, { startYear: 1985 }); // backlog fodder
  const today = '2026-07-17';
  ensureBoard(db, 1, today);
  const board = activeQuests(db, 1);
  assert.equal(board.length, 3);
  const kinds = board.map((q) => q.kind);
  assert.ok(kinds.includes('finish_series'));
  const fin = board.find((q) => q.kind === 'finish_series');
  assert.equal(fin.target, 2);
  assert.equal(questProgress(db, fin), 0);
  // Read the two remaining issues → quest completes and banks its XP.
  for (const id of fin.params.issueIds) db.prepare('INSERT INTO reader_progress VALUES (1,?,20,20,1,?)').run(id, today + 'T10:00:00Z');
  const doneQuests = refreshQuests(db, today);
  assert.ok(doneQuests.some((q) => q.id === fin.id));
  assert.ok(gamifyUser(db, 1).xp_bonus >= fin.xp);
  // Board doesn't regenerate a 4th quest mid-week for the done slot.
  ensureBoard(db, 1, today);
  assert.equal(activeQuests(db, 1).length, 2);
  cleanup(dir, db);
});

test('fair play: mark-read earns nothing, daily caps clamp, streaks need real pages', () => {
  const { db, dir } = fixture();
  seedSeries(db, 21, 'Honest', 8, 0);
  // Bulk "mark read" the whole series: completed=1 but page=0, no daily stats
  // (exactly how the reader's setRead writes it).
  for (let i = 1; i <= 8; i++) {
    db.prepare('INSERT INTO reader_progress VALUES (1,?,0,20,1,?)').run(21000 + i, '2026-07-15T12:00:00Z');
  }
  // No XP, no count-achievements, no Completionist — claims aren't reading.
  assert.equal(readStats(db, 1).issues, 0);
  assert.equal(checkAchievements(db, 1, '2026-07-17').length, 0);
  // A set quest over those issues reports zero progress.
  const q = { kind: 'set', user_id: 1, params: { issueIds: [21001, 21002, 21003] } };
  assert.equal(questProgress(db, q), 0);
  // Actually reading one of them counts (page pointer + stats, like the reader).
  db.prepare('UPDATE reader_progress SET page=19 WHERE user_id=1 AND issue_id=21001').run();
  assert.equal(questProgress(db, q), 1);

  // Daily caps: a 50-issue / 2000-page day counts as 20 issues / 500 pages.
  db.prepare('INSERT INTO reader_stats_daily VALUES (1,?,2000,50)').run('2026-07-16');
  const s = readStats(db, 1);
  assert.equal(s.issues, 20);
  assert.equal(s.pages, 500);
  // A raised cap counts more of it.
  assert.equal(readStats(db, 1, { issues: 100, pages: 5000, streakMin: 3 }).issues, 50);

  // Streak days need >= streakMin real pages (completions always count).
  db.prepare('INSERT INTO reader_stats_daily VALUES (2,?,1,0)').run('2026-07-17'); // 1-page tap
  assert.equal(streakOf(db, 2, '2026-07-17').current, 0);
  db.prepare('INSERT INTO reader_stats_daily VALUES (3,?,3,0)').run('2026-07-17');
  assert.equal(streakOf(db, 3, '2026-07-17').current, 1);
  cleanup(dir, db);
});

test('ensureBoard: the size setting caps the weekly board', () => {
  const { db, dir } = fixture();
  seedSeries(db, 11, 'Chew', 10, 8);
  seedSeries(db, 13, 'Old Stuff', 6, 0, { startYear: 1985 });
  ensureBoard(db, 1, '2026-07-17', 2);
  assert.equal(activeQuests(db, 1).length, 2);
  // Raising the size mid-week tops the board up; clamping guards nonsense.
  ensureBoard(db, 1, '2026-07-17', 99);
  assert.ok(activeQuests(db, 1).length <= 4);
  assert.ok(activeQuests(db, 1).length >= 3);
  cleanup(dir, db);
});

test('coop quest sums all non-opted-out users; reroll respects the weekly cap', () => {
  const { db, dir } = fixture();
  seedSeries(db, 3, 'Filler', 8, 4);
  const today = '2026-07-17';
  ensureCoop(db, today, 2);
  const coop = db.prepare("SELECT * FROM gamify_quests WHERE user_id IS NULL AND status='active'").get();
  assert.ok(coop.target >= 20);
  db.prepare('INSERT INTO reader_stats_daily VALUES (1,?,40,2)').run('2026-07-05');
  db.prepare('INSERT INTO reader_stats_daily VALUES (2,?,40,3)').run('2026-07-06');
  // seedSeries banked 4 completions for user 1 on 2026-07-10 (inside the window)
  assert.equal(questProgress(db, { ...coop, params: {} }, []), 9);
  assert.equal(questProgress(db, { ...coop, params: {} }, [2]), 6, 'opt-out excluded');

  ensureBoard(db, 1, today);
  const q1 = activeQuests(db, 1)[0];
  assert.equal(rerollQuest(db, 1, q1.id, today).error, undefined);
  // Burn the remaining rerolls, then expect the cap error.
  let denied = null;
  for (let i = 0; i < 4; i++) {
    const q = activeQuests(db, 1)[0];
    if (!q) break;
    const r = rerollQuest(db, 1, q.id, today);
    if (r.error) { denied = r.error; break; }
  }
  assert.match(String(denied), /no rerolls left/);
  assert.equal(weekStartOf('2026-07-17'), '2026-07-13'); // Monday anchor sanity
  cleanup(dir, db);
});
