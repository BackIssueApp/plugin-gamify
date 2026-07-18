// Gamify client — injected by core via window.BackIssue. The redesigned Quests
// board (hero with conic level ring + streak chips, iconed quest cards, cyan
// co-op card, medal-grid achievements, podium leaderboard), the profile level
// card, and the NEW one-shot level-up celebration (confetti, ring, rewards) that
// fires when /api/gamify/me reports a higher level than the last one seen.
// Plain vanilla JS + ui.css classes over core tokens — no framework.
(function () {
  // Icons beyond the core set (inline SVG so sizing/rendering is exact).
  const GX = {
    flame: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2s4 4 4 8a4 4 0 0 1-8 0c0-1 .5-2 .5-2S6 10 6 13a6 6 0 0 0 12 0c0-5-6-11-6-11z"/></svg>',
    snow: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M2 12h20M5 5l14 14M19 5 5 19"/></svg>',
    book: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    layers: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 9 5-9 5-9-5 9-5z"/><path d="m3 12 9 5 9-5M3 17l9 5 9-5"/></svg>',
    swords: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="m13 19 6-6M16 16l4 4M19 21l2-2"/><path d="M14.5 6.5 18 3h3v3l-3.5 3.5"/></svg>',
    medal: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="15" r="6"/><path d="M9 9 6 2M15 9l3-7M9.5 2h5"/></svg>',
    lock: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    reroll: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5"/></svg>',
    levelup: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-8 8h5v10h6V11h5z"/></svg>',
  };
  const QUEST_ICONS = ['book', 'layers', 'swords'];
  const CONF_COLORS = ['#ff2d6f', '#ffd24b', '#2bd4d9', '#5fd38a', '#a78bfa', '#ff6b98'];
  const PODIUM = [
    { h: 46, c: '#ffd24b' }, { h: 32, c: '#c9c9d4' }, { h: 24, c: '#cd7f45' },
  ];
  const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  window.BackIssue.registerClient((api) => {
    const esc = api.escapeHtml;
    let overlay = null;
    let me = null;
    let tab = 'quests';
    let menuBtn = null;

    // Settings panel — the dedicated Plugins tab when the core has it (Gamify
    // isn't a download source), falling back to the Sources slot on older
    // cores. Toggles default ON: an unset key means the admin never touched it.
    const setSlot = api.slot('settings-plugin-panels') || api.slot('settings-plugin-sources');
    if (setSlot && !document.getElementById('set-gamifyEnabled')) {
      const block = document.createElement('div');
      block.className = 'src-block';
      block.innerHTML =
        '<div class="src-toggle">' +
          '<label class="switch"><input id="set-gamifyEnabled" type="checkbox" checked><span class="switch__track"></span></label>' +
          '<div class="src-toggle__text"><b>Gamify</b><span class="modal__note src-toggle__note">Reading as a quest — XP, streaks, achievements and a weekly quest board built from your library.</span></div>' +
        '</div>' +
        '<div id="gamify-config" class="src-config">' +
          '<label class="field field--check"><input id="set-gamifyHousehold" type="checkbox" checked><span>Household features (monthly co-op quest + leaderboard)</span></label>' +
          '<label class="field field--check"><input id="set-gamifyNotify" type="checkbox" checked><span>Notifications for quests, achievements and level-ups</span></label>' +
          '<label class="field field--check"><input id="set-gamifyCelebration" type="checkbox" checked><span>Level-up celebration overlay</span></label>' +
          '<label class="field"><span>Weekly quests</span><input id="set-gamifyQuestCount" type="number" min="1" max="4" placeholder="3"></label>' +
          '<p class="modal__note">Individual users can additionally hide themselves from the household leaderboard and co-op quest on the Quests board. With notifications off, progress still counts — it just stays quiet.</p>' +
          '<div class="fields-row">' +
            '<label class="field"><span>Issues/day that count</span><input id="set-gamifyDailyIssueCap" type="number" min="1" max="200" placeholder="20"></label>' +
            '<label class="field"><span>Pages/day that count</span><input id="set-gamifyDailyPageCap" type="number" min="50" max="5000" placeholder="500"></label>' +
            '<label class="field"><span>Min pages for a streak day</span><input id="set-gamifyStreakMinPages" type="number" min="1" max="50" placeholder="3"></label>' +
          '</div>' +
          '<p class="modal__note"><b>Fair play</b>: only reading done in the reader earns XP, quests and streaks — “mark read” updates the library but scores nothing. These caps bound what a single day can earn (XP, quests, leaderboard) and how few pages still count as a streak day.</p>' +
        '</div>';
      setSlot.appendChild(block);
      const en = document.getElementById('set-gamifyEnabled');
      en.onchange = () => api.refreshSourceUI();
      api.onSourcesSync(() => {
        document.getElementById('gamify-config')?.classList.toggle('open', en.checked);
        return false; // not a download source — never counts toward the no-sources warning
      });
    }

    const pct = (a, b) => (b ? Math.min(100, Math.round((a / b) * 100)) : 0);
    const bar = (done, total, cls) =>
      '<div class="gx-bar"><div class="gx-fill ' + (cls || '') + '" style="width:' + pct(done, total) + '%"></div></div>';

    async function load() {
      me = await api.get('/api/gamify/me');
      maybeCelebrate();
    }

    function close() { overlay?.remove(); overlay = null; }

    async function open() {
      if (overlay) return;
      overlay = document.createElement('div');
      overlay.className = 'gx-overlay';
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
      document.addEventListener('keydown', function onEsc(e) {
        if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); }
      });
      overlay.innerHTML = '<div class="gx-panel"><div class="gx-head">' +
        '<span class="gx-head-icon">' + api.icon('target') + '</span>' +
        '<b class="gx-head-title">Quests</b>' +
        '<div class="gx-tabs">' +
          '<button data-t="quests" class="gx-tab is-active">Quests</button>' +
          '<button data-t="badges" class="gx-tab">Achievements</button>' +
          '<button data-t="house" class="gx-tab">Household</button>' +
        '</div>' +
        '<button class="gx-x" aria-label="Close">' + api.icon('close') + '</button></div>' +
        '<div class="gx-body" id="gx-body"><p class="gx-note">Loading…</p></div></div>';
      overlay.querySelector('.gx-x').onclick = close;
      overlay.querySelectorAll('.gx-tab').forEach((b) => {
        b.onclick = () => {
          tab = b.dataset.t;
          overlay.querySelectorAll('.gx-tab').forEach((x) => x.classList.toggle('is-active', x === b));
          render();
        };
      });
      document.body.appendChild(overlay);
      try { await load(); } catch { me = null; }
      render();
    }

    const body = () => overlay.querySelector('#gx-body');

    function render() {
      if (!overlay) return;
      if (!me) { body().innerHTML = '<p class="gx-note">Couldn’t load your progress.</p>'; return; }
      if (!me.ready) { body().innerHTML = '<p class="gx-note">' + esc(me.reason || 'Not ready yet.') + '</p>'; return; }
      // Household features off → no Household tab (and never render its view).
      const houseOff = me.settings?.household === false;
      const houseTab = overlay.querySelector('[data-t="house"]');
      if (houseTab) houseTab.style.display = houseOff ? 'none' : '';
      if (houseOff && tab === 'house') { tab = 'quests'; overlay.querySelectorAll('.gx-tab').forEach((x) => x.classList.toggle('is-active', x.dataset.t === 'quests')); }
      if (tab === 'quests') renderQuests();
      else if (tab === 'badges') renderBadges();
      else renderHouse();
    }

    // ---- hero (every tab) --------------------------------------------------
    function heroCard() {
      const L = me.level, S = me.streak, G = me.goal;
      const ringPct = pct(L.into, L.span);
      return '<div class="gx-hero"><div class="gx-hero-glow"></div>' +
        '<div class="gx-hero-top">' +
          '<div class="gx-ring" style="background:conic-gradient(var(--accent,#ff2d6f) ' + ringPct + '%, #2c2740 0)">' +
            '<div class="gx-ring-in"><span class="gx-ring-num">' + L.level + '</span><span class="gx-ring-cap">Level</span></div>' +
          '</div>' +
          '<div class="gx-hero-main"><div class="gx-hero-title">' + esc(L.title) + '</div>' +
            bar(L.into, L.span, 'gx-fill--xp') +
            '<div class="gx-mono-sub">' + L.xp.toLocaleString() + ' XP · ' + (L.next - L.xp) + ' to next</div>' +
          '</div>' +
        '</div>' +
        '<div class="gx-chips">' +
          '<span class="gx-chip gx-chip--flame"><span class="gx-flame">' + GX.flame + '</span><span><b>' + S.current + '</b> day streak</span></span>' +
          '<span class="gx-chip"><span><b class="gx-strong">' + S.best + '</b> best</span></span>' +
          '<span class="gx-chip" title="Auto-spent when you miss a day"><span class="gx-snow">' + GX.snow + '</span><span><b class="gx-strong">' + me.tokens + '</b> freeze' + (me.tokens === 1 ? '' : 's') + '</span></span>' +
        '</div>' +
        '<div class="gx-goal">' + (G.target
          ? '<div class="gx-goal-head"><span class="gx-dim">' + G.year + ' reading goal</span><span class="gx-mono"><b class="gx-green">' + G.read + '</b> / ' + G.target + '</span></div>' +
            '<div class="gx-goal-row">' + bar(G.read, G.target, 'gx-fill--goal') + '<button class="gx-link" id="gx-goal-edit">change</button></div>'
          : '<button class="gx-goal-set" id="gx-goal-edit">Set a ' + G.year + ' reading goal</button>') +
        '</div></div>';
    }

    function wireGoal() {
      const btn = body().querySelector('#gx-goal-edit');
      if (!btn) return;
      btn.onclick = async () => {
        const v = prompt('Issues to read in ' + me.goal.year + ' (0 clears the goal):', me.goal.target || 100);
        if (v == null) return;
        try { await api.post('/api/gamify/goal', { target: Number(v) }); await load(); render(); }
        catch (e) { api.toast(String(e), 'error'); }
      };
    }

    // ---- quests tab --------------------------------------------------------
    function renderQuests() {
      const qs = me.quests || [];
      body().innerHTML = heroCard() +
        '<div class="gx-sec"><span>Weekly quests</span><span class="gx-mono gx-dim2">' + me.rerollsLeft + ' reroll' + (me.rerollsLeft === 1 ? '' : 's') + ' left</span></div>' +
        (qs.length ? qs.map((q, i) => {
          const done = q.status === 'done';
          return '<div class="gx-quest' + (done ? ' is-done' : '') + '">' +
            '<span class="gx-quest-icon">' + GX[QUEST_ICONS[i % QUEST_ICONS.length]] + '</span>' +
            '<div class="gx-quest-main">' +
              '<div class="gx-quest-top"><span class="gx-quest-title">' + esc(q.title) + '</span><span class="gx-xp">+' + q.xp + ' XP</span></div>' +
              bar(q.progress, q.target, done ? 'gx-fill--done' : '') +
              '<div class="gx-quest-foot"><span class="gx-mono ' + (done ? 'gx-green' : 'gx-dim') + '">' + q.progress + ' / ' + q.target + '</span>' +
              (done ? '<span class="gx-done-tag">' + api.icon('check') + 'Complete</span>'
                : (me.rerollsLeft > 0 ? '<button class="gx-reroll" data-reroll="' + q.id + '">' + GX.reroll + 'reroll</button>' : '')) +
              '</div>' +
            '</div></div>';
        }).join('')
          : '<p class="gx-note">No quests yet — read something and check back, or your library may have nothing left unread!</p>') +
        (me.coop ? '<div class="gx-sec"><span>Household co-op</span></div>' +
          '<div class="gx-coop"><div class="gx-coop-top"><span class="gx-coop-icon">' + api.icon('users') + '</span><span class="gx-quest-title">' + esc(me.coop.title) + '</span></div>' +
          bar(me.coop.progress, me.coop.target, 'gx-fill--coop') +
          '<span class="gx-mono gx-dim">' + me.coop.progress + ' / ' + me.coop.target + ' issues together</span></div>' : '');
      wireGoal();
      body().querySelectorAll('[data-reroll]').forEach((b) => {
        b.onclick = async () => {
          const r = await api.post('/api/gamify/reroll', { questId: Number(b.dataset.reroll) });
          if (r.error) api.toast(r.error, 'error');
          await load(); render();
        };
      });
    }

    // ---- achievements tab --------------------------------------------------
    function renderBadges() {
      const a = me.achievements || [];
      const got = a.filter((x) => x.unlockedAt).length;
      body().innerHTML = heroCard() +
        '<div class="gx-sec"><span>Achievements</span><span class="gx-mono gx-dim2">' + got + ' / ' + a.length + '</span><span class="gx-rule"></span></div>' +
        '<div class="gx-badges">' + a.map((x) => {
          const on = !!x.unlockedAt;
          return '<div class="gx-badge' + (on ? ' is-got' : '') + '" title="' + esc(x.desc) + '">' +
            '<div class="gx-badge-top"><span class="gx-medal">' + GX.medal + '</span><span class="gx-badge-title">' + esc(x.title) + '</span></div>' +
            '<span class="gx-badge-desc">' + esc(x.desc) + '</span>' +
            '<div class="gx-badge-foot"><span class="gx-badge-xp">+' + x.xp + ' XP</span>' +
            (on ? '<span class="gx-unlocked">Unlocked</span>' : '<span class="gx-lock">' + GX.lock + '</span>') + '</div></div>';
        }).join('') + '</div>';
      wireGoal();
    }

    // ---- household tab -----------------------------------------------------
    async function renderHouse() {
      let lb = { rows: [] };
      try { lb = await api.get('/api/gamify/leaderboard'); } catch { /* solo install */ }
      const myId = api.me()?.user?.id ?? 0;
      const rows = lb.rows || [];
      const podiumOrder = [1, 0, 2]; // 2nd, 1st, 3rd
      const podium = rows.length >= 3 ? podiumOrder.map((idx) => {
        const r = rows[idx], p = PODIUM[idx], big = idx === 0;
        return '<div class="gx-pod-col">' +
          '<span class="gx-pod-avatar' + (big ? ' is-big' : '') + '" style="background:' + p.c + ';box-shadow:0 0 0 3px ' + p.c + '44">' + esc(r.username.slice(0, 1).toUpperCase()) + '</span>' +
          '<span class="gx-pod-name">' + esc(r.username) + '</span>' +
          '<span class="gx-mono gx-dim">' + r.issues + ' iss</span>' +
          '<div class="gx-pedestal" style="height:' + p.h + 'px;border-color:' + p.c + '55;background:linear-gradient(180deg,' + p.c + '33,transparent);color:' + p.c + '">' + (idx + 1) + '</div>' +
          '</div>';
      }).join('') : '';
      body().innerHTML = heroCard() +
        '<div class="gx-sec"><span>This month’s leaderboard</span><span class="gx-mono gx-dim2">' + esc(lb.month || '') + '</span><span class="gx-rule"></span></div>' +
        (podium ? '<div class="gx-podium">' + podium + '</div>' : '') +
        (rows.length ? rows.map((r, i) => {
          const you = r.userId === myId;
          const rankC = i === 0 ? '#ffd24b' : i === 1 ? '#c9c9d4' : i === 2 ? '#cd7f45' : 'var(--faint,#6f6885)';
          return '<div class="gx-lb-row' + (you ? ' is-you' : '') + '">' +
            '<span class="gx-lb-rank" style="color:' + rankC + '">' + (i + 1) + '</span>' +
            '<span class="gx-lb-avatar' + (you ? ' is-you' : '') + '">' + esc(r.username.slice(0, 1).toUpperCase()) + '</span>' +
            '<span class="gx-lb-name">' + esc(r.username) + ' <span class="gx-mono gx-dim">lv ' + r.level + '</span></span>' +
            '<span class="gx-mono gx-dim">' + r.issues + ' iss · ' + r.pages + ' pp</span></div>';
        }).join('') : '<p class="gx-note">Nobody on the board yet this month.</p>') +
        '<label class="gx-opt"><span class="switch"><input type="checkbox" id="gx-optout"' + (me.optOut ? ' checked' : '') + '><span class="switch__track"></span></span>Hide me from the household leaderboard and co-op quest</label>';
      wireGoal();
      body().querySelector('#gx-optout').onchange = async (e) => {
        await api.post('/api/gamify/optout', { optOut: e.target.checked });
        await load(); render();
      };
    }

    // ---- level-up celebration ---------------------------------------------
    // Fires when /me reports a higher level than the last one this browser saw
    // for this user. Never on first sight (just records), one-shot per level.
    function levelKey() { return 'gamifyLevel:' + (api.me()?.user?.id ?? 0); }

    function maybeCelebrate() {
      if (!me?.ready) { if (me?.disabled && menuBtn) menuBtn.style.display = 'none'; return; }
      if (menuBtn) menuBtn.style.display = '';
      const cur = me.level.level;
      const seen = localStorage.getItem(levelKey());
      localStorage.setItem(levelKey(), String(cur)); // always record, even when the overlay is off
      if (me.settings?.celebration === false) return;
      if (seen == null || Number(seen) >= cur || cur <= 0) return;
      celebrate(Number(seen), cur);
    }

    function celebrate(prev, next) {
      document.querySelector('.gx-party')?.remove();
      const still = reducedMotion();
      const el = document.createElement('div');
      el.className = 'gx-party' + (still ? ' is-still' : '');
      const confetti = still ? '' : Array.from({ length: 28 }, (_, i) => {
        const ang = (i / 28) * Math.PI * 2;
        const dist = 120 + (i % 5) * 34;
        const dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist * 0.82 + 40;
        const rot = (i % 2 ? 1 : -1) * (180 + (i % 4) * 90);
        return '<span class="gx-conf" style="--dx:' + dx.toFixed(0) + 'px;--dy:' + dy.toFixed(0) + 'px;--dr:' + rot + 'deg;background:' + CONF_COLORS[i % CONF_COLORS.length] + ';animation-delay:' + ((i % 6) * 0.03) + 's;' + (i % 3 === 0 ? 'border-radius:50%;' : '') + '"></span>';
      }).join('');
      el.innerHTML = '<div class="gx-party-card">' + confetti +
        '<div class="gx-party-in"><div class="gx-party-sheen"></div><div class="gx-party-glow"></div>' +
          '<div class="gx-party-kicker">Level up</div>' +
          '<div class="gx-party-ring"><div class="gx-party-ringfill"></div>' +
            '<div class="gx-party-ring-in"><span class="gx-party-num">' + next + '</span><span class="gx-ring-cap">Level</span></div>' +
            '<div class="gx-party-from">' + prev + ' → ' + next + '</div>' +
          '</div>' +
          '<div class="gx-party-title">' + esc(me.level.title) + '</div>' +
          '<div class="gx-mono gx-dim">' + me.level.xp.toLocaleString() + ' XP total</div>' +
          '<div class="gx-party-rewards">' +
            '<div class="gx-reward"><span class="gx-reward-icon" style="color:var(--accent,#ff2d6f)">' + GX.medal + '</span>' +
              '<div><div class="gx-reward-title">New title: ' + esc(me.level.title) + '</div><div class="gx-reward-sub">Shown on your profile and the leaderboard</div></div></div>' +
            '<div class="gx-reward"><span class="gx-reward-icon" style="color:#2bd4d9">' + GX.snow + '</span>' +
              '<div><div class="gx-reward-title">Streak freeze topped up</div><div class="gx-reward-sub">' + me.tokens + ' banked — covers a day you miss</div></div></div>' +
          '</div>' +
          '<div class="gx-party-actions">' +
            '<button class="gx-party-nice">Nice</button>' +
            '<button class="gx-party-view">View quests</button>' +
          '</div>' +
        '</div></div>';
      const done = () => el.remove();
      el.addEventListener('click', (e) => { if (e.target === el) done(); });
      el.querySelector('.gx-party-nice').onclick = done;
      el.querySelector('.gx-party-view').onclick = () => { done(); open(); };
      document.body.appendChild(el);
    }

    // ---- profile widget ----------------------------------------------------
    const slot = api.slot('profile-plugin-slot');
    if (slot) {
      const box = document.createElement('div');
      box.className = 'gx-profile';
      slot.appendChild(box);
      (async () => {
        try {
          await load();
          if (!me?.ready) return;
          const ringPct = pct(me.level.into, me.level.span);
          box.innerHTML = '<button class="gx-profile-card">' +
            '<span class="gx-ring gx-ring--sm" style="background:conic-gradient(var(--accent,#ff2d6f) ' + ringPct + '%, #2c2740 0)">' +
              '<span class="gx-ring-in"><span class="gx-ring-num">' + me.level.level + '</span></span></span>' +
            '<span class="gx-profile-text"><b>' + esc(me.level.title) + '</b>' +
            '<span class="gx-mono gx-dim">' + me.level.xp.toLocaleString() + ' XP · ' + me.streak.current + '-day streak</span></span>' +
            '</button>';
          box.querySelector('.gx-profile-card').onclick = open;
        } catch { /* board still reachable from the menu */ }
      })();
    } else {
      // No profile page mounted (rare) — still record the level for celebrations.
      load().catch(() => {});
    }

    menuBtn = api.addMenuAction('Quests', open, api.icon('target'), { section: 'Reading' });
  });
})();
