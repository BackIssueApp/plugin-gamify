// The scoring engine: reading stats, XP and levels, streaks (with freeze
// tokens), and the achievement catalog. Everything derives from the reader
// plugin's tables (reader_progress / reader_stats_daily) plus core CV metadata —
// this module stores nothing except unlocked achievements (via callers).
import { gamifyUser } from './store.js';

// ---- fair play -------------------------------------------------------------
// Rewards derive from VERIFIED reading, not claimed reading. The reader plugin
// only writes reader_stats_daily from real in-reader page turns (forward-only,
// first-completion-only), while "mark read" bypasses it and zeroes `page` — so:
//  - counting stats come from reader_stats_daily (mark-read earns nothing),
//  - per-issue checks require the page pointer a real read-through leaves.
// Daily caps bound what even in-reader page-skimming can earn in a day.
export const DEFAULT_CAPS = { issues: 20, pages: 500, streakMin: 3 };
export const VERIFIED = 'completed = 1 AND page > 0'; // SQL predicate on reader_progress

// ---- reading stats ---------------------------------------------------------
export function readStats(db, userId, caps = DEFAULT_CAPS) {
  const d = db.prepare(`SELECT
      COALESCE(SUM(MIN(completed, @ci)),0) issues,
      COALESCE(SUM(MIN(pages, @cp)),0) pages,
      COALESCE(SUM(pages>0),0) days
    FROM reader_stats_daily WHERE user_id=@u`).get({ u: userId, ci: caps.issues, cp: caps.pages });
  return { issues: d.issues, pages: d.pages, days: d.days };
}

// ---- XP & levels -----------------------------------------------------------
// Reading XP: an issue finished is worth 50, a page 1 — so a typical 22-page
// issue lands ~72 XP. Quest/achievement bonuses stack on top (xp_bonus).
export function xpOf(stats, bonus = 0) {
  return stats.issues * 50 + stats.pages + (bonus || 0);
}

export const TITLES = [
  'Newsstand Browser', 'Sidekick', 'Back-Issue Digger', 'Cape Chaser', 'Panel Hopper',
  'Vigilante', 'Longbox Legend-in-Training', 'Crusader', 'Hero', 'Multiverse Wanderer',
  'Keeper of the Vault', 'Legend',
];

// Level curve: cumulative cost grows quadratically — level L starts at 150·L².
export function levelFor(xp) {
  const level = Math.floor(Math.sqrt(Math.max(0, xp) / 150));
  const start = 150 * level * level;
  const next = 150 * (level + 1) * (level + 1);
  return {
    level,
    title: TITLES[Math.min(level, TITLES.length - 1)],
    xp, into: xp - start, span: next - start, next,
  };
}

// ---- streaks ---------------------------------------------------------------
const dayMs = 24 * 60 * 60 * 1000;
export const dayStr = (d) => new Date(d).toISOString().slice(0, 10);
const addDays = (day, n) => dayStr(new Date(day + 'T00:00:00Z').getTime() + n * dayMs);

// Days that count toward a streak: a real completion, at least `streakMin`
// pages actually turned, or a freeze-token day. A one-page tap doesn't count.
function activeDays(db, userId, minPages = DEFAULT_CAPS.streakMin) {
  const read = db.prepare('SELECT day FROM reader_stats_daily WHERE user_id=? AND (pages>=? OR completed>0)').all(userId, minPages).map((r) => r.day);
  const frozen = db.prepare('SELECT day FROM gamify_freezes WHERE user_id=?').all(userId).map((r) => r.day);
  return new Set([...read, ...frozen]);
}

// Current streak counts back from today (today itself optional — the day isn't
// over); best is the longest run anywhere in history.
export function streakOf(db, userId, today, minPages = DEFAULT_CAPS.streakMin) {
  const days = activeDays(db, userId, minPages);
  let current = 0;
  let cursor = days.has(today) ? today : addDays(today, -1);
  while (days.has(cursor)) { current++; cursor = addDays(cursor, -1); }
  let best = 0;
  for (const d of days) {
    if (days.has(addDays(d, -1))) continue; // not a run start
    let len = 0, c = d;
    while (days.has(c)) { len++; c = addDays(c, 1); }
    if (len > best) best = len;
  }
  return { current, best: Math.max(best, current) };
}

// Spend a freeze token for YESTERDAY if the user read nothing, had a live
// streak the day before, and holds a token — keeps the streak alive overnight.
// Returns true when a token was spent (callers may notify).
export function maybeSpendFreeze(db, userId, today, minPages = DEFAULT_CAPS.streakMin) {
  const yesterday = addDays(today, -1);
  const days = activeDays(db, userId, minPages);
  if (days.has(yesterday) || !days.has(addDays(today, -2))) return false;
  const u = gamifyUser(db, userId);
  if (!u.tokens) return false;
  db.prepare('UPDATE gamify_user SET tokens = tokens - 1 WHERE user_id=?').run(userId);
  db.prepare('INSERT OR IGNORE INTO gamify_freezes (user_id, day) VALUES (?,?)').run(userId, yesterday);
  return true;
}

// Earn a token at each 7-day streak multiple (cap 2 held).
export function maybeEarnToken(db, userId, current) {
  if (current > 0 && current % 7 === 0) {
    const u = gamifyUser(db, userId);
    if (u.tokens < 2) { db.prepare('UPDATE gamify_user SET tokens = tokens + 1 WHERE user_id=?').run(userId); return true; }
  }
  return false;
}

// ---- achievements ----------------------------------------------------------
// Each def: { key, title, desc, xp, check(db, userId, ctx) -> bool }.
// ctx carries precomputed stats/streak so checks stay cheap.
export const ACHIEVEMENTS = [
  { key: 'first-issue', title: 'Origin Story', desc: 'Finish your first issue', xp: 50,
    check: (db, u, ctx) => ctx.stats.issues >= 1 },
  { key: 'issues-10', title: 'Pull List Regular', desc: 'Finish 10 issues', xp: 100,
    check: (db, u, ctx) => ctx.stats.issues >= 10 },
  { key: 'issues-50', title: 'Longbox Diver', desc: 'Finish 50 issues', xp: 250,
    check: (db, u, ctx) => ctx.stats.issues >= 50 },
  { key: 'issues-100', title: 'Century Club', desc: 'Finish 100 issues', xp: 500,
    check: (db, u, ctx) => ctx.stats.issues >= 100 },
  { key: 'issues-500', title: 'Omnibus Incarnate', desc: 'Finish 500 issues', xp: 1500,
    check: (db, u, ctx) => ctx.stats.issues >= 500 },
  { key: 'series-complete', title: 'Completionist', desc: 'Finish every issue of a series (6+ issues)', xp: 300,
    check: (db, u) => !!db.prepare(`
      SELECT ci.cv_series_id FROM cv_issues ci
      GROUP BY ci.cv_series_id HAVING COUNT(*) >= 6
        AND COUNT(*) = SUM(EXISTS(SELECT 1 FROM reader_progress rp WHERE rp.user_id=? AND rp.issue_id=ci.comicvine_id AND rp.completed=1 AND rp.page>0))
      LIMIT 1`).get(u) },
  { key: 'decades-5', title: 'Decade Traveler', desc: 'Read comics from 5 different decades', xp: 300,
    check: (db, u) => db.prepare(`
      SELECT COUNT(DISTINCT substr(ci.cover_date,1,3)) n FROM reader_progress rp
      JOIN cv_issues ci ON ci.comicvine_id = rp.issue_id
      WHERE rp.user_id=? AND rp.completed=1 AND rp.page>0 AND ci.cover_date IS NOT NULL`).get(u).n >= 5 },
  { key: 'publishers-5', title: 'Publisher Sampler', desc: 'Read comics from 5 different publishers', xp: 200,
    check: (db, u) => db.prepare(`
      SELECT COUNT(DISTINCT cs.publisher) n FROM reader_progress rp
      JOIN cv_issues ci ON ci.comicvine_id = rp.issue_id
      JOIN cv_series cs ON cs.comicvine_id = ci.cv_series_id
      WHERE rp.user_id=? AND rp.completed=1 AND rp.page>0 AND cs.publisher IS NOT NULL`).get(u).n >= 5 },
  { key: 'marathon', title: 'Marathon', desc: 'Read 100+ pages in a single day', xp: 150,
    check: (db, u) => !!db.prepare('SELECT 1 FROM reader_stats_daily WHERE user_id=? AND pages>=100').get(u) },
  { key: 'night-owl', title: 'Night Owl', desc: 'Finish an issue in the small hours', xp: 100,
    check: (db, u) => !!db.prepare(`SELECT 1 FROM reader_progress WHERE user_id=? AND completed=1 AND page>0
      AND CAST(substr(updated_at,12,2) AS INTEGER) BETWEEN 0 AND 4 LIMIT 1`).get(u) },
  { key: 'streak-7', title: 'Weekly Ritual', desc: 'A 7-day reading streak', xp: 200,
    check: (db, u, ctx) => ctx.streak.best >= 7 },
  { key: 'streak-30', title: 'Iron Reader', desc: 'A 30-day reading streak', xp: 750,
    check: (db, u, ctx) => ctx.streak.best >= 30 },
  { key: 'list-finisher', title: 'Arc Hunter', desc: 'Finish every issue of a reading list (5+ issues)', xp: 250,
    check: (db, u) => !!db.prepare(`
      SELECT li.list_id FROM reading_list_items li
      GROUP BY li.list_id HAVING COUNT(*) >= 5
        AND COUNT(*) = SUM(EXISTS(SELECT 1 FROM reader_progress rp WHERE rp.user_id=? AND rp.issue_id=li.cv_issue_id AND rp.completed=1 AND rp.page>0))
      LIMIT 1`).get(u) },
];

// Evaluate all defs; store and return the newly unlocked ones (with XP granted).
export function checkAchievements(db, userId, today, caps = DEFAULT_CAPS) {
  let unlocked;
  try { unlocked = new Set(db.prepare('SELECT key FROM gamify_achievements WHERE user_id=?').all(userId).map((r) => r.key)); }
  catch { unlocked = new Set(); }
  const ctx = { stats: readStats(db, userId, caps), streak: streakOf(db, userId, today, caps.streakMin) };
  const fresh = [];
  for (const a of ACHIEVEMENTS) {
    if (unlocked.has(a.key)) continue;
    let hit = false;
    try { hit = !!a.check(db, userId, ctx); } catch { /* table missing (no lists yet) */ }
    if (!hit) continue;
    db.prepare('INSERT OR IGNORE INTO gamify_achievements (user_id, key, unlocked_at) VALUES (?,?,?)').run(userId, a.key, new Date().toISOString());
    gamifyUser(db, userId);
    db.prepare('UPDATE gamify_user SET xp_bonus = xp_bonus + ? WHERE user_id=?').run(a.xp, userId);
    fresh.push(a);
  }
  return fresh;
}
