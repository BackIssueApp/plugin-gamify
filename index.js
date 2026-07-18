// Gamify plugin for BackIssue — reading as a quest.
//
// Solo loop: XP + levels from reading (via the reader plugin's history), daily
// streaks with freeze tokens, a yearly goal, achievements, and a weekly quest
// board generated from the user's OWN library state (finish-that-series,
// arc/list hunts, backlog clearing, pace quests). Household loop: a monthly
// co-op quest everyone contributes to, plus a leaderboard (opt-out per user).
// Completions and level-ups land in the notification bell (and any NotifyHub
// channels). Soft-depends on the reader plugin's tables — without them the UI
// simply reports there's nothing to score yet.
import config from '../../src/config.js';
import { notify } from '../../src/notifications.js';
import { openGamifyStore, gamifyUser } from './store.js';
import { readStats, xpOf, levelFor, streakOf, maybeSpendFreeze, maybeEarnToken, checkAchievements, ACHIEVEMENTS, dayStr } from './engine.js';
import { activeQuests, ensureBoard, ensureCoop, refreshQuests, rerollQuest, questProgress, monthStartOf, weekStartOf } from './quests.js';

const today = () => dayStr(Date.now());

export default function register(api) {
  api.registerClientAsset({ js: 'client/ui.js', css: 'client/ui.css' });

  // All default ON (an unset key means the admin never touched it), so the
  // checks are `!== false`. Quest count defaults to 3 of the 4 flavors.
  api.registerSettings({
    gamifyEnabled: { type: 'bool' },      // master switch — off = no sweeps, board reports disabled
    gamifyHousehold: { type: 'bool' },    // co-op quest + leaderboard (the Household tab)
    gamifyNotify: { type: 'bool' },       // bell/NotifyHub events (progress still tracked when off)
    gamifyCelebration: { type: 'bool' },  // the client-side level-up overlay
    gamifyQuestCount: { type: 'int', min: 1, max: 4 },
    // Fair-play knobs: how much counts per day toward XP/quests/leaderboard,
    // and how many real pages a day needs to keep a streak alive.
    gamifyDailyIssueCap: { type: 'int', min: 1, max: 200 },
    gamifyDailyPageCap: { type: 'int', min: 50, max: 5000 },
    gamifyStreakMinPages: { type: 'int', min: 1, max: 50 },
  });
  const enabled = () => config.gamifyEnabled !== false;
  const household = () => config.gamifyHousehold !== false;
  const notifying = () => config.gamifyNotify !== false;
  const questCount = () => Math.max(1, Math.min(4, Number(config.gamifyQuestCount) || 3));
  const caps = () => ({
    issues: Math.max(1, Math.min(200, Number(config.gamifyDailyIssueCap) || 20)),
    pages: Math.max(50, Math.min(5000, Number(config.gamifyDailyPageCap) || 500)),
    streakMin: Math.max(1, Math.min(50, Number(config.gamifyStreakMinPages) || 3)),
  });

  let db = null;
  const store = () => (db ||= openGamifyStore(config.dbPath));
  const hasReader = () => {
    try { store().prepare('SELECT 1 FROM reader_progress LIMIT 1').get(); return true; }
    catch { return false; }
  };

  const activeUserIds = () => {
    try { return store().prepare('SELECT id FROM users WHERE disabled=0').all().map((r) => r.id); }
    catch { return [0]; } // open mode
  };
  const optOutIds = () => store().prepare('SELECT user_id FROM gamify_user WHERE opt_out=1').all().map((r) => r.user_id);

  // The periodic sweep: quests, achievements, streak upkeep, notifications.
  // Also run lazily before serving /me so the board is always current.
  function sweep({ emit = true } = {}) {
    if (!enabled() || !hasReader()) return;
    if (!notifying()) emit = false; // progress still tracked, just silently
    const d = store();
    const t = today();
    const users = activeUserIds();
    if (household()) ensureCoop(d, t, users.length || 1);
    for (const uid of users) {
      maybeSpendFreeze(d, uid, t, caps().streakMin);
      ensureBoard(d, uid, t, questCount());
      for (const a of checkAchievements(d, uid, t, caps())) {
        if (emit) notify(d, { type: 'gamify.achievement', category: 'system', level: 'info', title: `Achievement unlocked: ${a.title}`, body: `${a.desc} (+${a.xp} XP)`, userId: uid });
      }
      const s = streakOf(d, uid, t, caps().streakMin);
      if (maybeEarnToken(d, uid, s.current) && emit) {
        notify(d, { type: 'gamify.token', category: 'system', level: 'info', title: `Streak reward: freeze token earned`, body: `${s.current}-day reading streak — a freeze token will cover a missed day.`, userId: uid });
      }
      // Level-up detection (reading XP moves without us; compare to last seen).
      const u = gamifyUser(d, uid);
      const lvl = levelFor(xpOf(readStats(d, uid, caps()), u.xp_bonus)).level;
      if (lvl > u.last_level) {
        // Leveling up tops up the streak-freeze bank (cap 2) — the celebration
        // overlay presents this as the level reward, so it must really happen.
        d.prepare('UPDATE gamify_user SET last_level=?, tokens=MIN(2, tokens+1) WHERE user_id=?').run(lvl, uid);
        if (emit && lvl > 0) {
          const after = gamifyUser(d, uid);
          const t2 = levelFor(xpOf(readStats(d, uid, caps()), after.xp_bonus)).title;
          notify(d, { type: 'gamify.level', category: 'system', level: 'info', title: `Level ${lvl} — ${t2}!`, body: `You leveled up. Streak freeze topped up — ${after.tokens} banked.`, userId: uid });
        }
      }
    }
    for (const q of refreshQuests(d, t, optOutIds(), caps().issues)) {
      if (!emit) continue;
      // A leftover co-op quest keeps ticking if household features are turned
      // off mid-month, but its completion shouldn't announce itself.
      if (q.user_id == null) { if (household()) notify(d, { type: 'gamify.quest', category: 'system', level: 'info', title: 'Household quest complete!', body: q.title }); }
      else notify(d, { type: 'gamify.quest', category: 'system', level: 'info', title: `Quest complete: ${q.title}`, body: `+${q.xp} XP`, userId: q.user_id });
    }
  }

  // Hourly sweep so notifications fire even when nobody has the board open.
  api.registerStartup(() => {
    setTimeout(() => { try { sweep(); } catch (e) { console.warn('gamify sweep failed:', e?.message || e); } }, 90 * 1000);
    setInterval(() => { try { sweep(); } catch (e) { console.warn('gamify sweep failed:', e?.message || e); } }, 60 * 60 * 1000);
  });

  // ---- everything the board + profile widget need, in one call ----
  api.registerRoute('get', '/api/gamify/me', (req, res) => {
    if (!enabled()) return res.json({ ready: false, disabled: true, reason: 'Gamify is turned off in Settings.' });
    if (!hasReader()) return res.json({ ready: false, reason: 'The reader plugin records reading history — install it to play.' });
    try { sweep(); } catch { /* board still renders from last state */ }
    const d = store();
    const uid = req.user?.id ?? 0;
    const t = today();
    const u = gamifyUser(d, uid);
    const stats = readStats(d, uid, caps());
    const xp = xpOf(stats, u.xp_bonus);
    const yearStart = t.slice(0, 4) + '-01-01';
    const yearRead = d.prepare('SELECT COALESCE(SUM(completed),0) n FROM reader_stats_daily WHERE user_id=? AND day>=?').get(uid, yearStart).n;
    const quests = activeQuests(d, uid).map((q) => ({ ...q, progress: questProgress(d, q, [], caps().issues) }));
    const coop = household()
      ? d.prepare(`SELECT * FROM gamify_quests WHERE user_id IS NULL AND period_start=? AND status IN ('active','done')`).get(monthStartOf(t))
      : null;
    const rerolls = d.prepare(`SELECT COUNT(*) n FROM gamify_quests WHERE user_id=? AND period_start=? AND status='rerolled'`).get(uid, weekStartOf(t)).n;
    res.json({
      ready: true,
      settings: { household: household(), celebration: config.gamifyCelebration !== false },
      stats, level: levelFor(xp), streak: streakOf(d, uid, t, caps().streakMin), tokens: u.tokens,
      goal: { target: u.goal_target, read: yearRead, year: Number(t.slice(0, 4)) },
      quests,
      coop: coop ? { ...coop, params: undefined, progress: questProgress(d, { ...coop, params: {} }, optOutIds(), caps().issues) } : null,
      achievements: ACHIEVEMENTS.map((a) => {
        const row = d.prepare('SELECT unlocked_at FROM gamify_achievements WHERE user_id=? AND key=?').get(uid, a.key);
        return { key: a.key, title: a.title, desc: a.desc, xp: a.xp, unlockedAt: row?.unlocked_at || null };
      }),
      optOut: !!u.opt_out,
      rerollsLeft: Math.max(0, 3 - rerolls),
    });
  }, { access: 'viewer' });

  api.registerRoute('post', '/api/gamify/goal', (req, res) => {
    const target = Math.max(0, Math.min(10000, Math.round(Number(req.body?.target) || 0)));
    const d = store(); const uid = req.user?.id ?? 0;
    gamifyUser(d, uid);
    d.prepare('UPDATE gamify_user SET goal_target=? WHERE user_id=?').run(target, uid);
    res.json({ target });
  }, { access: 'viewer' });

  api.registerRoute('post', '/api/gamify/optout', (req, res) => {
    const d = store(); const uid = req.user?.id ?? 0;
    gamifyUser(d, uid);
    d.prepare('UPDATE gamify_user SET opt_out=? WHERE user_id=?').run(req.body?.optOut ? 1 : 0, uid);
    res.json({ optOut: !!req.body?.optOut });
  }, { access: 'viewer' });

  api.registerRoute('post', '/api/gamify/reroll', (req, res) => {
    const r = rerollQuest(store(), req.user?.id ?? 0, Number(req.body?.questId), today());
    res.status(r.error ? 400 : 200).json(r);
  }, { access: 'viewer' });

  // Household: this month's per-user tallies (opted-out users hidden).
  api.registerRoute('get', '/api/gamify/leaderboard', (req, res) => {
    if (!enabled() || !household()) return res.json({ rows: [], disabled: true });
    if (!hasReader()) return res.json({ rows: [] });
    const d = store();
    const t = today();
    const start = monthStartOf(t);
    const out = optOutIds();
    const users = activeUserIds().filter((id) => !out.includes(id));
    const rows = users.map((uid) => {
      const m = d.prepare('SELECT COALESCE(SUM(completed),0) issues, COALESCE(SUM(pages),0) pages FROM reader_stats_daily WHERE user_id=? AND day>=?').get(uid, start);
      let name = 'local';
      try { name = d.prepare('SELECT username FROM users WHERE id=?').get(uid)?.username || 'local'; } catch { /* open mode */ }
      const u = gamifyUser(d, uid);
      return { userId: uid, username: name, issues: m.issues, pages: m.pages, level: levelFor(xpOf(readStats(d, uid, caps()), u.xp_bonus)).level };
    }).sort((a, b) => (b.issues - a.issues) || (b.pages - a.pages));
    res.json({ month: start.slice(0, 7), rows });
  }, { access: 'viewer' });
}
