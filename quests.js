// The quest board: weekly auto-generated missions built from the user's OWN
// library state (that's the trick — a generic tracker can't say "you're two
// issues from finishing Saga"). Three quest flavors per week plus a monthly
// household co-op quest. Progress is state-based where possible (count of the
// quest's exact issues now completed) so it survives restarts and re-reads.
import { dayStr } from './engine.js';

const dayMs = 24 * 60 * 60 * 1000;
export function weekStartOf(today) {
  const d = new Date(today + 'T00:00:00Z');
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  return dayStr(d.getTime() - dow * dayMs);
}
export function monthStartOf(today) { return today.slice(0, 8) + '01'; }
const weekEndOf = (start) => dayStr(new Date(start + 'T00:00:00Z').getTime() + 6 * dayMs);
function monthEndOf(start) {
  const d = new Date(start + 'T00:00:00Z');
  return dayStr(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

// Quest issues only count when VERIFIED (read in the reader — mark-read zeroes
// the page pointer, so completed alone isn't enough; see engine.js fair play).
const completedSet = (db, userId, ids) => {
  if (!ids.length) return 0;
  const q = db.prepare(`SELECT COUNT(*) n FROM reader_progress WHERE user_id=? AND completed=1 AND page>0
    AND issue_id IN (${ids.map(() => '?').join(',')})`);
  return q.get(userId, ...ids).n;
};

// ---- generators ------------------------------------------------------------
// Each returns a quest row ({ kind, title, params, target, xp }) or null.

// "Finish what you started": a series the user is mid-way through, with only a
// few owned-but-unread issues left.
function genFinishSeries(db, userId) {
  const row = db.prepare(`
    SELECT ci.cv_series_id sid, cs.name, COUNT(*) remaining FROM library_files lf
    JOIN cv_issues ci ON ci.comicvine_id = lf.cv_issue_id
    JOIN cv_series cs ON cs.comicvine_id = ci.cv_series_id
    WHERE lf.valid = 1
      AND NOT EXISTS (SELECT 1 FROM reader_progress rp WHERE rp.user_id=@u AND rp.issue_id=lf.cv_issue_id AND rp.completed=1)
      AND EXISTS (SELECT 1 FROM reader_progress rp2 JOIN cv_issues ci2 ON ci2.comicvine_id = rp2.issue_id
                  WHERE rp2.user_id=@u AND rp2.completed=1 AND ci2.cv_series_id = ci.cv_series_id)
    GROUP BY ci.cv_series_id HAVING remaining BETWEEN 1 AND 6
    ORDER BY remaining ASC LIMIT 1`).get({ u: userId });
  if (!row) return null;
  const ids = db.prepare(`
    SELECT DISTINCT lf.cv_issue_id id FROM library_files lf
    JOIN cv_issues ci ON ci.comicvine_id = lf.cv_issue_id
    WHERE lf.valid=1 AND ci.cv_series_id=?
      AND NOT EXISTS (SELECT 1 FROM reader_progress rp WHERE rp.user_id=? AND rp.issue_id=lf.cv_issue_id AND rp.completed=1)`)
    .all(row.sid, userId).map((r) => r.id);
  return { kind: 'finish_series', title: `Finish what you started: ${row.name}`, params: { cvSeriesId: row.sid, issueIds: ids }, target: ids.length, xp: 60 * ids.length };
}

// "Arc hunter": one of the user's reading lists with a handful of unread items.
function genFinishList(db, userId) {
  let lists;
  try {
    lists = db.prepare('SELECT id, name FROM reading_lists WHERE user_id IN (0, ?)').all(userId);
  } catch { return null; }
  for (const l of lists) {
    const ids = db.prepare(`SELECT cv_issue_id id FROM reading_list_items WHERE list_id=?
      AND NOT EXISTS (SELECT 1 FROM reader_progress rp WHERE rp.user_id=? AND rp.issue_id=cv_issue_id AND rp.completed=1)
      ORDER BY position`).all(l.id, userId).map((r) => r.id);
    if (ids.length >= 1 && ids.length <= 12) {
      return { kind: 'finish_list', title: `Arc hunter: finish “${l.name}”`, params: { listId: l.id, issueIds: ids }, target: ids.length, xp: 40 * ids.length };
    }
  }
  return null;
}

// "Backlog slayer": the N oldest owned-but-never-read issues (by cover date).
function genBacklog(db, userId, n = 5) {
  const ids = db.prepare(`
    SELECT DISTINCT lf.cv_issue_id id, ci.cover_date FROM library_files lf
    JOIN cv_issues ci ON ci.comicvine_id = lf.cv_issue_id
    WHERE lf.valid=1
      AND NOT EXISTS (SELECT 1 FROM reader_progress rp WHERE rp.user_id=? AND rp.issue_id=lf.cv_issue_id AND rp.completed=1)
    ORDER BY ci.cover_date IS NULL, ci.cover_date ASC LIMIT ?`).all(userId, n).map((r) => r.id);
  if (ids.length < 2) return null;
  return { kind: 'set', title: `Backlog slayer: read your ${ids.length} oldest unread issues`, params: { issueIds: ids }, target: ids.length, xp: 50 * ids.length };
}

// "Keep the pace": read N issues this week, scaled to recent habits.
function genCount(db, userId) {
  const avg = db.prepare(`SELECT COALESCE(SUM(completed),0) n FROM reader_stats_daily
    WHERE user_id=? AND day >= date('now','-28 days')`).get(userId).n / 4;
  const n = Math.max(3, Math.min(15, Math.round(avg * 1.5) || 3));
  return { kind: 'count', title: `Keep the pace: finish ${n} issues this week`, params: {}, target: n, xp: 30 * n };
}

const GENERATORS = [genFinishSeries, genFinishList, genBacklog, genCount];

// ---- board management ------------------------------------------------------
export function activeQuests(db, userId) {
  return db.prepare(`SELECT * FROM gamify_quests WHERE user_id=? AND status='active' ORDER BY id`).all(userId)
    .map((q) => ({ ...q, params: JSON.parse(q.params || '{}') }));
}

// Fill the user's board to `size` active quests for this week (one per flavor,
// so the effective maximum is the number of generators).
export function ensureBoard(db, userId, today, size = 3) {
  const start = weekStartOf(today);
  const have = db.prepare(`SELECT kind FROM gamify_quests WHERE user_id=? AND period_start=? AND status IN ('active','done')`)
    .all(userId, start).map((r) => r.kind);
  const count = db.prepare(`SELECT COUNT(*) n FROM gamify_quests WHERE user_id=? AND period_start=? AND status IN ('active','done')`)
    .get(userId, start).n;
  let need = Math.max(1, Math.min(4, size)) - count;
  for (const gen of GENERATORS) {
    if (need <= 0) break;
    let q = null;
    try { q = gen(db, userId); } catch { /* missing optional tables */ }
    if (!q || have.includes(q.kind)) continue;
    db.prepare(`INSERT INTO gamify_quests (user_id, kind, title, params, target, xp, period_start, period_end)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run(userId, q.kind, q.title, JSON.stringify(q.params), q.target, q.xp, start, weekEndOf(start));
    have.push(q.kind);
    need--;
  }
}

// One household co-op quest per month: everyone's completions count together.
export function ensureCoop(db, today, activeUserCount) {
  const start = monthStartOf(today);
  const exists = db.prepare(`SELECT 1 FROM gamify_quests WHERE user_id IS NULL AND period_start=? AND status IN ('active','done')`).get(start);
  if (exists) return;
  const target = Math.max(20, activeUserCount * 15);
  db.prepare(`INSERT INTO gamify_quests (user_id, kind, title, params, target, xp, period_start, period_end)
    VALUES (NULL,'coop',?, '{}', ?, ?, ?, ?)`)
    .run(`Household run: finish ${target} issues together this month`, target, 25 * target, start, monthEndOf(start));
}

// Progress for one quest (state-based for issue sets, window sums for counts).
// Count/co-op sums are capped per day (issueCap) so a single bulk day can't
// blow through a quest — see engine.js fair play.
export function questProgress(db, q, optOutIds = [], issueCap = 20) {
  if (q.kind === 'count') {
    return db.prepare('SELECT COALESCE(SUM(MIN(completed, ?)),0) n FROM reader_stats_daily WHERE user_id=? AND day BETWEEN ? AND ?')
      .get(issueCap, q.user_id, q.period_start, q.period_end).n;
  }
  if (q.kind === 'coop') {
    const not = optOutIds.length ? `AND user_id NOT IN (${optOutIds.map(() => '?').join(',')})` : '';
    return db.prepare(`SELECT COALESCE(SUM(dc),0) n FROM (
        SELECT SUM(MIN(completed, ?)) dc FROM reader_stats_daily WHERE day BETWEEN ? AND ? ${not} GROUP BY user_id, day
      )`).get(issueCap, q.period_start, q.period_end, ...optOutIds).n;
  }
  return completedSet(db, q.user_id, q.params.issueIds || []);
}

// Sweep every active quest: mark done (award XP), expire past-window ones.
// Returns the quests newly completed (for notifications).
export function refreshQuests(db, today, optOutIds = [], issueCap = 20) {
  const finished = [];
  const rows = db.prepare(`SELECT * FROM gamify_quests WHERE status='active'`).all()
    .map((q) => ({ ...q, params: JSON.parse(q.params || '{}') }));
  for (const q of rows) {
    const progress = questProgress(db, q, optOutIds, issueCap);
    if (progress >= q.target) {
      db.prepare(`UPDATE gamify_quests SET status='done', done_at=? WHERE id=?`).run(new Date().toISOString(), q.id);
      if (q.user_id != null) {
        db.prepare('INSERT OR IGNORE INTO gamify_user (user_id) VALUES (?)').run(q.user_id);
        db.prepare('UPDATE gamify_user SET xp_bonus = xp_bonus + ? WHERE user_id=?').run(q.xp, q.user_id);
      }
      finished.push(q);
    } else if (today > q.period_end) {
      db.prepare(`UPDATE gamify_quests SET status='expired' WHERE id=?`).run(q.id);
    }
  }
  return finished;
}

// Reroll: retire a quest and draw a different flavor (max 3 rerolls a week).
export function rerollQuest(db, userId, questId, today) {
  const q = db.prepare(`SELECT * FROM gamify_quests WHERE id=? AND user_id=? AND status='active'`).get(questId, userId);
  if (!q) return { error: 'quest not found' };
  const start = weekStartOf(today);
  const rerolls = db.prepare(`SELECT COUNT(*) n FROM gamify_quests WHERE user_id=? AND period_start=? AND status='rerolled'`)
    .get(userId, start).n;
  if (rerolls >= 3) return { error: 'no rerolls left this week' };
  db.prepare(`UPDATE gamify_quests SET status='rerolled' WHERE id=?`).run(q.id);
  const have = db.prepare(`SELECT kind FROM gamify_quests WHERE user_id=? AND period_start=? AND status IN ('active','done')`)
    .all(userId, start).map((r) => r.kind);
  for (const gen of GENERATORS) {
    let nq = null;
    try { nq = gen(db, userId); } catch { /* optional tables */ }
    if (!nq || nq.kind === q.kind || have.includes(nq.kind)) continue;
    db.prepare(`INSERT INTO gamify_quests (user_id, kind, title, params, target, xp, period_start, period_end)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run(userId, nq.kind, nq.title, JSON.stringify(nq.params), nq.target, nq.xp, start, weekEndOf(start));
    return { rerolled: true };
  }
  return { rerolled: true, note: 'no replacement available' };
}
