# Changelog

Notable, user-facing changes per release. Format follows [Keep a Changelog](https://keepachangelog.com);
versions follow the tags in this repository (`vX.Y.Z` → the release bundle BackIssue's plugin catalog installs).

Contributors: please **don't** edit this file in pull requests — entries are added
by the maintainers when changes merge, so concurrent PRs don't conflict here.

## [Unreleased]

### Added

- **Translated UI.** The Quests board, the level-up celebration, the profile
  card and the settings card follow the language picked under Profile →
  Language on BackIssue builds newer than 0.9.0, English on older ones.
  Translations ship for French, German, Spanish, Italian, Portuguese and
  Dutch in `locales/`.
  Also covers the permission, job and library-type labels, the plugin
  description and the notification titles shown in BackIssue’s own screens.

### Changed

- **Faster XP and quest writes.** The plugin's database connection now uses
  the same write mode as the rest of BackIssue (WAL with normal sync), so
  awarding XP and progressing quests no longer waits on a full disk sync for
  every write. Still safe across an app crash.

## [1.0.0] — 2026-07-18

Initial release: XP + levels from reading, daily streaks with freeze tokens, a
yearly reading goal, an achievement catalog, a weekly quest board generated from
your own library (finish-that-series, arc hunts, backlog clearing, pace quests),
a monthly household co-op quest, and a per-month leaderboard with per-user
opt-out. Completions land in the notification bell (and NotifyHub channels).
