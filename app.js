(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const els = {
    matchList: $('#matchList'), search: $('#searchInput'), date: $('#datePicker'), refresh: $('#refreshBtn'),
    sectionTitle: $('#sectionTitle'), sectionSubtitle: $('#sectionSubtitle'), crumb: $('#crumbTitle'), headingDate: $('#headingDate'),
    tabButtons: [...document.querySelectorAll('.match-tab')], navButtons: [...document.querySelectorAll('.nav-item')],
    filterBtn: $('#leagueFilterBtn'), filterPanel: $('#filterPanel'), leagueSelect: $('#leagueSelect'), clearFilters: $('#clearFilters'),
    sort: $('#sortSelect'), loadMore: $('#loadMoreBtn'), resultCount: $('#resultCount'), toast: $('#toast')
  };
  const state = { matches: [], view: 'today', tab: 'all', query: '', league: 'all', sort: 'time', loading: false, error: '', limit: 12, favorites: readFavorites(), lastUpdated: null, toastTimer: null };
  const viewLabels = { today: 'مباريات اليوم', live: 'مباشر الآن', upcoming: 'المباريات القادمة', finished: 'المباريات المنتهية', favorites: 'المفضلة' };
  const liveStatuses = new Set(['IN_PLAY', 'PAUSED', 'LIVE', '1H', '2H', 'ET', 'P', 'HT']);
  const doneStatuses = new Set(['FINISHED', 'FT', 'AET', 'PEN', 'AWARDED']);
  const upcomingStatuses = new Set(['SCHEDULED', 'TIMED', 'NS']);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function readFavorites() { try { return new Set(JSON.parse(localStorage.getItem('dreb-favorites-v2') || '[]').map(String)); } catch { return new Set(); } }
  function saveFavorites() { try { localStorage.setItem('dreb-favorites-v2', JSON.stringify([...state.favorites])); } catch { toast('تعذر حفظ المفضلة على هذا الجهاز.'); } }
  function toast(message) { els.toast.textContent = message; els.toast.classList.add('show'); clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600); }
  function todayISO() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function dateLabel(value) { if (!value) return ''; const d = new Date(`${value}T12:00:00`); return new Intl.DateTimeFormat('ar-MA', { day: 'numeric', month: 'short', year: 'numeric' }).format(d); }
  function timeLabel(value) { if (!value) return '—'; const d = new Date(value); if (Number.isNaN(d.getTime())) return '—'; return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(d); }
  function statusOf(m) { const s = String(m.status || '').toUpperCase(); if (liveStatuses.has(s)) return 'live'; if (doneStatuses.has(s)) return 'finished'; if (upcomingStatuses.has(s)) return 'upcoming'; return 'other'; }
  function statusText(m) { const s = String(m.status || '').toUpperCase(); if (s === 'PAUSED' || s === 'HT') return 'استراحة'; if (liveStatuses.has(s)) return m.minute != null ? `${m.minute}′` : 'مباشر'; if (doneStatuses.has(s)) return 'نهاية المباراة'; if (s === 'POSTPONED') return 'مؤجلة'; if (s === 'CANCELLED') return 'أُلغيت'; if (s === 'SUSPENDED') return 'متوقفة'; if (s === 'PENDING') return 'بانتظار التأكيد'; if (upcomingStatuses.has(s)) return timeLabel(m.utcDate || m.date); return 'الحالة غير متاحة'; }
  function score(m) { const h = m.homeScore ?? m.score?.fullTime?.home ?? m.score?.regularTime?.home; const a = m.awayScore ?? m.score?.fullTime?.away ?? m.score?.regularTime?.away; if (h == null || a == null) return '– : –'; return `${h} : ${a}`; }
  function teamName(team) { return team?.name || team?.shortName || 'فريق غير معروف'; }
  function teamAbbr(team) { const name = teamName(team).trim(); return (team?.tla || name.split(/\s+/).slice(0,2).map(x => x[0]).join('')).slice(0,3).toUpperCase() || 'FC'; }
  function matchId(m) { return String(m.id ?? `${m.homeTeam?.id || teamName(m.homeTeam)}-${m.utcDate || m.date}-${m.awayTeam?.id || teamName(m.awayTeam)}`); }
  function renderTeam(team, side) {
    const name = teamName(team); const crest = team?.crest;
    // Avoid inline event handlers: provider data must never become executable JS.
    const crestHtml = crest && /^https:\/\//i.test(crest)
      ? `<span class="team-crest"><img src="${esc(crest)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-fallback="${esc(teamAbbr(team))}"></span>`
      : `<span class="team-crest">${esc(teamAbbr(team))}</span>`;
    return `<div class="team ${side}">${crestHtml}<span class="team-name" title="${esc(name)}">${esc(name)}</span></div>`;
  }
  function attachCrestFallbacks() {
    els.matchList.querySelectorAll('img[data-fallback]').forEach(img => {
      img.addEventListener('error', () => {
        const fallback = document.createElement('span');
        fallback.className = 'team-crest';
        fallback.textContent = img.dataset.fallback || 'FC';
        img.parentElement?.replaceWith(fallback);
      }, { once: true });
    });
  }
  function renderMatch(m) {
    const status = statusOf(m), id = matchId(m), saved = state.favorites.has(id);
    const comp = m.competition?.name || m.competitionName || 'مباراة';
    const area = m.competition?.area?.name || m.area || m.stage || 'كرة القدم';
    const time = status === 'live' ? statusText(m) : status === 'finished' ? 'انتهت' : status === 'upcoming' ? timeLabel(m.utcDate || m.date) : statusText(m);
    const scoreText = status === 'upcoming' ? timeLabel(m.utcDate || m.date) : score(m);
    const pill = status === 'live' ? '<span class="status-pill live">مباشر</span>' : status === 'upcoming' ? '<span class="status-pill soon">قادمة</span>' : status === 'finished' ? '<span class="status-pill">منتهية</span>' : `<span class="status-pill">${esc(statusText(m))}</span>`;
    return `<article class="match-card" data-match-id="${esc(id)}"><div class="league-info"><span class="league-emblem">${esc((m.competition?.code || comp.slice(0,2)).slice(0,3).toUpperCase())}</span><div class="league-text"><strong title="${esc(comp)}">${esc(comp)}</strong><small>${esc(area)}${m.matchday ? ` · الجولة ${esc(m.matchday)}` : ''}</small></div></div><div class="teams-wrap">${renderTeam(m.homeTeam, 'home')}<div class="score-box"><div class="score-number">${esc(scoreText)}</div><div class="score-time ${status === 'live' ? 'is-live' : ''}">${esc(time)}</div></div>${renderTeam(m.awayTeam, 'away')}</div><div class="match-end">${pill}<button class="favorite-btn ${saved ? 'saved' : ''}" data-favorite="${esc(id)}" aria-label="${saved ? 'حذف من المفضلة' : 'إضافة للمفضلة'}" aria-pressed="${saved}">${saved ? '★' : '☆'}</button></div></article>`;
  }
  function visibleMatches() {
    let list = [...state.matches];
    if (state.view === 'live') list = list.filter(m => statusOf(m) === 'live');
    else if (state.view === 'upcoming') list = list.filter(m => statusOf(m) === 'upcoming');
    else if (state.view === 'finished') list = list.filter(m => statusOf(m) === 'finished');
    else if (state.view === 'favorites') list = list.filter(m => state.favorites.has(matchId(m)) || state.favorites.has(String(m.homeTeam?.id)) || state.favorites.has(String(m.awayTeam?.id)));
    if (state.tab !== 'all') list = list.filter(m => statusOf(m) === state.tab);
    if (state.league !== 'all') list = list.filter(m => String(m.competition?.id ?? m.competition?.name ?? '') === state.league);
    if (state.query.trim()) { const q = state.query.trim().toLocaleLowerCase(); list = list.filter(m => [teamName(m.homeTeam), teamName(m.awayTeam), m.competition?.name, m.competition?.area?.name].some(x => String(x || '').toLocaleLowerCase().includes(q))); }
    list.sort((a,b) => state.sort === 'league' ? String(a.competition?.name || '').localeCompare(String(b.competition?.name || '')) : new Date(a.utcDate || a.date || 0) - new Date(b.utcDate || b.date || 0));
    return list;
  }
  function renderList() {
    if (state.loading) { els.matchList.innerHTML = '<div class="loading-state"><span class="loader"></span><strong>كنوجدو ليك المباريات...</strong><small>لحظات ونجيبو آخر البيانات المتاحة.</small></div>'; els.loadMore.hidden = true; return; }
    if (state.error && !state.matches.length) { els.matchList.innerHTML = `<div class="error-state"><div class="empty-icon">!</div><strong>ما قدرناش نجيبو المباريات دابا</strong><p>${esc(state.error)}</p><button class="retry-btn" id="retryBtn">عاود المحاولة</button></div>`; $('#retryBtn')?.addEventListener('click', loadMatches); els.resultCount.textContent = 'تعذر تحميل البيانات'; els.loadMore.hidden = true; return; }
    const list = visibleMatches();
    if (!list.length) {
      const msg = state.view === 'favorites' ? 'مازال ما ضفتي حتى مباراة للمفضلة.' : state.query ? 'ما لقيناش مباريات كتوافق البحث ديالك.' : 'ما كايناش مباريات مطابقة لهاد الاختيارات.';
      els.matchList.innerHTML = `<div class="empty-state"><div class="empty-icon">⚽</div><strong>${state.query ? 'ما لقيناش النتيجة' : 'ما كايناش مباريات هنا'}</strong><p>${esc(msg)}</p>${state.error ? `<p>${esc(state.error)}</p>` : ''}<button class="retry-btn" id="emptyResetBtn">عرض جميع المباريات</button></div>`;
      $('#emptyResetBtn')?.addEventListener('click', () => { state.query = ''; state.tab = 'all'; state.league = 'all'; els.search.value = ''; els.leagueSelect.value = 'all'; setTab('all'); renderList(); });
      els.resultCount.textContent = '0 مباراة'; els.loadMore.hidden = true; return;
    }
    const shown = list.slice(0, state.limit);
    els.matchList.innerHTML = shown.map(renderMatch).join('');
    attachCrestFallbacks();
    els.resultCount.textContent = `عرض ${shown.length} من ${list.length} مباراة`;
    els.loadMore.hidden = list.length <= state.limit;
    els.matchList.querySelectorAll('[data-favorite]').forEach(btn => btn.addEventListener('click', () => toggleFavorite(btn.dataset.favorite)));
  }
  function updateStats() {
    const live = state.matches.filter(m => statusOf(m) === 'live').length;
    const finished = state.matches.filter(m => statusOf(m) === 'finished').length;
    $('#statLive').textContent = live; $('#statTotal').textContent = state.matches.length; $('#statFinished').textContent = finished; $('#statFav').textContent = state.favorites.size;
    $('#liveNavCount').textContent = live; $('#tabAllCount').textContent = state.matches.length; $('#tabLiveCount').textContent = live;
    $('#tabUpcomingCount').textContent = state.matches.filter(m => statusOf(m) === 'upcoming').length; $('#tabFinishedCount').textContent = finished;
    $('#heroLiveText').textContent = live ? `${live} مباراة مباشرة دابا` : 'آخر نتائج المباريات المتاحة عندك';
    $('#apiStatusTitle').textContent = state.error ? 'تعذر الاتصال' : 'حالة الاتصال'; $('#apiStatusText').textContent = state.loading ? 'كنحدّثو البيانات...' : state.error ? 'راجع إعدادات API' : `آخر تحديث: ${state.lastUpdated ? timeLabel(state.lastUpdated) : '—'}`;
    $('#apiLight').className = `status-light ${state.error ? 'bad' : state.loading ? '' : 'ok'}`;
    $('#year').textContent = new Date().getFullYear();
  }
  function updateHeading() {
    const title = viewLabels[state.view] || viewLabels.today; els.sectionTitle.childNodes[0].textContent = `${title} `; els.crumb.textContent = title;
    els.headingDate.textContent = dateLabel(els.date.value); els.sectionSubtitle.textContent = state.view === 'favorites' ? 'المباريات والفرق اللي حفظتي.' : 'كل المواجهات المهمة فبلاصة وحدة.';
    els.navButtons.forEach(b => b.classList.toggle('active', b.dataset.view === state.view));
  }
  function populateLeagues() {
    const current = state.league;
    const leagues = new Map(); state.matches.forEach(m => { const id = String(m.competition?.id ?? m.competition?.name ?? ''); if (id) leagues.set(id, m.competition?.name || m.competitionName || 'بطولة'); });
    els.leagueSelect.innerHTML = '<option value="all">جميع البطولات</option>' + [...leagues.entries()].sort((a,b) => a[1].localeCompare(b[1])).map(([id,name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join('');
    els.leagueSelect.value = [...els.leagueSelect.options].some(o => o.value === current) ? current : 'all'; state.league = els.leagueSelect.value;
  }
  function setTab(tab) { state.tab = tab; els.tabButtons.forEach(b => b.classList.toggle('active', b.dataset.status === tab)); state.limit = 12; renderList(); }
  function toggleFavorite(id) {
    if (state.favorites.has(id)) { state.favorites.delete(id); toast('تحيدات من المفضلة.'); } else { state.favorites.add(id); toast('تزادت للمفضلة.'); }
    saveFavorites(); updateStats(); renderList();
  }
  async function loadMatches() {
    if (state.loading) return;
    state.loading = true; state.error = ''; updateStats(); renderList(); els.refresh.disabled = true;
    const selected = els.date.value || todayISO();
    try {
      const res = await fetch(`/.netlify/functions/matches?date=${encodeURIComponent(selected)}`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
      let data = {}; try { data = await res.json(); } catch { throw new Error('الاستجابة من الخادم ما كانتش مفهومة.'); }
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) throw new Error('مفتاح API ناقص أو غير صالح، أو الباقة ما كتسمحش بهاد البيانات.');
        if (res.status === 429) throw new Error('وصلنا للحد ديال الطلبات. تسنّى شوية وعاود.');
        throw new Error(data.error || `وقع مشكل فالخادم (${res.status}).`);
      }
      if (!Array.isArray(data.matches)) throw new Error('البيانات اللي وصلات ما فيهاش لائحة المباريات.');
      state.matches = data.matches; state.lastUpdated = new Date().toISOString();
      if (data.warning) state.error = data.warning;
      populateLeagues();
    } catch (err) {
      state.error = err instanceof TypeError ? 'ما قدرناش نتاصلو بالخادم. تأكد من الإنترنت وأن الموقع منشور على Netlify.' : (err.message || 'وقع خطأ غير متوقع.');
    } finally {
      state.loading = false; els.refresh.disabled = false; updateStats(); updateHeading(); renderList();
    }
  }
  els.navButtons.forEach(btn => btn.addEventListener('click', () => { state.view = btn.dataset.view; state.tab = 'all'; setTab('all'); updateHeading(); renderList(); }));
  els.tabButtons.forEach(btn => btn.addEventListener('click', () => setTab(btn.dataset.status)));
  els.search.addEventListener('input', e => { state.query = e.target.value; state.limit = 12; renderList(); });
  els.date.value = todayISO(); $('#todayLabel').textContent = dateLabel(todayISO());
  els.date.addEventListener('change', () => { state.view = 'today'; state.tab = 'all'; state.limit = 12; updateHeading(); setTab('all'); loadMatches(); });
  els.refresh.addEventListener('click', () => { loadMatches(); toast('كنحدّثو النتائج...'); });
  els.filterBtn.addEventListener('click', () => { els.filterPanel.hidden = !els.filterPanel.hidden; });
  els.leagueSelect.addEventListener('change', e => { state.league = e.target.value; state.limit = 12; renderList(); });
  els.clearFilters.addEventListener('click', () => { state.league = 'all'; els.leagueSelect.value = 'all'; state.query = ''; els.search.value = ''; renderList(); });
  els.sort.addEventListener('change', e => { state.sort = e.target.value; renderList(); });
  els.loadMore.addEventListener('click', () => { state.limit += 12; renderList(); });
  updateHeading(); updateStats(); loadMatches();
  // Refresh scores periodically, but never keep requests running concurrently.
  setInterval(() => { if (document.visibilityState === 'visible') loadMatches(); }, 90000);
})();
