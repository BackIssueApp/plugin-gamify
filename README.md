# Gamify

Reading as a quest. Earn XP for every page and issue, level up through
comic-flavored titles, keep a daily streak alive (freeze tokens cover a missed
day), chase achievements, and clear a **weekly quest board generated from your
own library** — finish that series you're two issues from, hunt down a story
arc, slay your backlog. Households get a monthly co-op quest and a leaderboard.

## Install

One click from **Sidebar → Plugins** in BackIssue, or drop this folder into the
app's `plugins/` directory and restart. Reading history comes from the
**Comic Reader** plugin — install that too (it's what records what you read).

## Play

- **Quests** in the sidebar (grouped with Reading) opens the board: your level,
  streak, yearly goal, three weekly quests (up to three rerolls a week), the
  household co-op quest, achievements, and the monthly leaderboard.
- Your **profile page** shows the level card at a glance.
- Completions, level-ups and unlocked achievements land in the notification
  bell — and any channels the Notifications Hub relays to.

## Settings

**Settings → Sources → Gamify** (all default on):

- **Gamify** — the master switch; off pauses sweeps and the board reports why.
- **Household features** — the monthly co-op quest and leaderboard (the
  Household tab). Off = solo mode.
- **Notifications** — bell/NotifyHub events for quests, achievements and
  level-ups. With this off, progress still counts — it just stays quiet.
- **Level-up celebration** — the one-shot overlay; the bell entry follows the
  notifications toggle instead.
- **Weekly quests** — how many quests the weekly board draws (1–4, default 3).

## Fair play (anti-cheat)

- **Only real reading scores.** XP, quests, streaks, achievements and the
  leaderboard count reading done *in the reader* (forward page turns,
  first-time completions). **"Mark read"** — single or bulk — updates your
  library like always, but earns nothing: it leaves none of the activity
  fingerprints a real read-through does.
- **Daily caps** (configurable) bound what a single day can earn — by default
  20 issues and 500 pages count per day toward XP, count quests, the co-op
  quest and the leaderboard. Skimming 300 issues in an evening scores like a
  very good day, not a month.
- **Streak days need real pages** — a day counts toward a streak only with a
  finished issue or at least a few pages actually turned (default 3), so a
  one-page tap doesn't keep a streak alive.
- Re-reading an issue never double-counts its completion (the reader's
  completion latch fires once, ever, per issue).

## Notes

- Only *you* see your solo progress; the household tab is opt-out per user
  (hide yourself from the leaderboard and co-op quest with one checkbox).
- Nothing here downloads anything or changes your library — it only reads
  reading history and awards points.
