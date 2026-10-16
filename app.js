
(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);

  const els = {
    matchList: $('#matchList'),
    search: $('#searchInput'),
    date: $('#datePicker'),
    refresh: $('#refreshBtn'),
    sectionTitle: $('#sectionTitle'),
    sectionSubtitle: $('#sectionSubtitle'),
    crumb: $('#crumbTitle'),
    headingDate: $('#headingDate'),
    tabButtons: [...document.querySelectorAll('.match-tab')],
    navButtons: [...document.querySelectorAll('.nav-item')],
    filterBtn: $('#leagueFilterBtn'),
    filterPanel: $('#filterPanel'),
    leagueSelect: $('#leagueSelect'),
    clearFilters: $('#clearFilters'),
    sort: $('#sortSelect'),
    loadMore: $('#loadMoreBtn'),
    resultCount: $('#resultCount'),
    toast: $('#toast')
  };

  // Stop early if the HTML structure doesn't match this script.
  const required = [
    'matchList', 'search', 'date', 'refresh', 'sectionTitle',
    'sectionSubtitle', 'crumb', 'headingDate', 'filterBtn',
    'filterPanel', 'leagueSelect', 'clearFilters', 'sort',
    'loadMore', 'resultCount', 'toast'
  ];

  for (const key of required) {
    if (!els[key]) {
      console.error(`DREB Football: missing HTML element "${key}".`);
      return;
    }
  }

  const state = {
    matches: [],
    view: 'today',
    tab: 'all',
    query: '',
    league: 'all',
    sort: 'time',
    loading: false,
    error: '',
    limit: 12,
    favorites: readFavorites(),
    lastUpdated: null,
    toastTimer: null,
    requestController: null
  };

  const viewLabels = {
    today: 'مباريات اليوم',
    live: 'مباشر الآن',
    upcoming: 'المباريات القادمة',
    finished: 'المباريات المنتهية',
    favorites: 'المفضلة'
  };

  const liveStatuses = new Set([
    'IN_PLAY', 'PAUSED', 'LIVE', '1H', '2H',
    'ET', 'P', 'HT', 'BREAK', 'EXTRA_TIME'
  ]);

  const doneStatuses = new Set([
    'FINISHED', 'FT', 'AET', 'PEN', 'AWARDED'
  ]);

  const upcomingStatuses = new Set([
    'SCHEDULED', 'TIMED', 'NS'
  ]);

  const esc = (value) =>
    String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[char]);

  function readFavorites() {
    try {
      const value = JSON.parse(
        localStorage.getItem('dreb-favorites-v2') || '[]'
      );
      return new Set(value.map(String));
    } catch {
      return new Set();
    }
  }

  function saveFavorites() {
    try {
      localStorage.setItem(
        'dreb-favorites-v2',
        JSON.stringify([...state.favorites])
      );
    } catch {
      toast('تعذر حفظ المفضلة على هذا الجهاز.');
    }
  }

  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');

    clearTimeout(state.toastTimer);

    state.toastTimer = setTimeout(() => {
      els.toast.classList.remove('show');
    }, 2600);
  }

  function todayISO() {
    const date = new Date();

    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function dateLabel(value) {
    if (!value) return '';

    const date = new Date(`${value}T12:00:00`);

    return new Intl.DateTimeFormat('ar-MA', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    }).format(date);
  }

  function timeLabel(value) {
    if (!value) return '—';

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return '—';

    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(date);
  }

  function matchDate(match) {
    if (!match.utcDate && !match.date) return '';
    const date = new Date(match.utcDate || match.date);

    if (Number.isNaN(date.getTime())) return '';

    // Use the viewer's local date for the displayed match day.
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function statusOf(match) {
    const status = String(match.status || '').toUpperCase();

    if (liveStatuses.has(status)) return 'live';
    if (doneStatuses.has(status)) return 'finished';
    if (upcomingStatuses.has(status)) return 'upcoming';

    return 'other';
  }

  function statusText(match) {
    const status = String(match.status || '').toUpperCase();

    if (status === 'PAUSED' || status === 'HT') {
      return 'استراحة';
    }

    if (liveStatuses.has(status)) {
      return match.minute != null ? `${match.minute}′` : 'مباشر';
    }

    if (doneStatuses.has(status)) return 'نهاية المباراة';
    if (status === 'POSTPONED') return 'مؤجلة';
    if (status === 'CANCELLED') return 'أُلغيت';
    if (status === 'SUSPENDED') return 'متوقفة';
    if (status === 'PENDING') return 'بانتظار التأكيد';

    if (upcomingStatuses.has(status)) {
      return timeLabel(match.utcDate || match.date);
    }

    return 'الحالة غير متاحة';
  }

  function score(match) {
    const home =
      match.homeScore ??
      match.score?.fullTime?.home ??
      match.score?.regularTime?.home;

    const away =
      match.awayScore ??
      match.score?.fullTime?.away ??
      match.score?.regularTime?.away;

    if (home == null || away == null) return '– : –';

    return `${home} : ${away}`;
  }

  function teamName(team) {
    return team?.name || team?.shortName || 'فريق غير معروف';
  }

  function teamAbbr(team) {
    const name = teamName(team).trim();

    return (
      team?.tla ||
      name.split(/\s+/).slice(0, 2).map(part => part[0]).join('')
    ).slice(0, 3).toUpperCase() || 'FC';
  }

  function matchId(match) {
    return String(
      match.id ??
      `${match.homeTeam?.id || teamName(match.homeTeam)}-${match.utcDate || match.date}-${match.awayTeam?.id || teamName(match.awayTeam)}`
    );
  }

  function renderTeam(team, side) {
    const name = teamName(team);
    const crest = team?.crest;

    const crestHtml =
      crest && /^https:\/\//i.test(crest)
        ? `<span class="team-crest"><img src="${esc(crest)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-fallback="${esc(teamAbbr(team))}"></span>`
        : `<span class="team-crest">${esc(teamAbbr(team))}</span>`;

    return `
      <div class="team ${side}">
        ${crestHtml}
        <span class="team-name" title="${esc(name)}">${esc(name)}</span>
      </div>
    `;
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

  function renderMatch(match) {
    const status = statusOf(match);
    const id = matchId(match);
    const saved = state.favorites.has(id);
    const competition =
      match.competition?.name || match.competitionName || 'مباراة';
    const area =
      match.competition?.area?.name ||
      match.area ||
      match.stage ||
      'كرة القدم';

    const time =
      status === 'live'
        ? statusText(match)
        : status === 'finished'
          ? 'انتهت'
          : status === 'upcoming'
            ? timeLabel(match.utcDate || match.date)
            : statusText(match);

    const scoreText =
      status === 'upcoming'
        ? timeLabel(match.utcDate || match.date)
        : score(match);

    let pill = '<span class="status-pill">الحالة غير متاحة</span>';

    if (status === 'live') {
      pill = '<span class="status-pill live">مباشر</span>';
    } else if (status === 'upcoming') {
      pill = '<span class="status-pill soon">قادمة</span>';
    } else if (status === 'finished') {
      pill = '<span class="status-pill">منتهية</span>';
    }

    return `
      <article class="match-card" data-match-id="${esc(id)}">
        <div class="league-info">
          <span class="league-emblem">
            ${esc((match.competition?.code || competition.slice(0, 2)).slice(0, 3).toUpperCase())}
          </span>
          <div class="league-text">
            <strong title="${esc(competition)}">${esc(competition)}</strong>
            <small>
              ${esc(area)}
              ${match.matchday ? ` · الجولة ${esc(match.matchday)}` : ''}
            </small>
          </div>
        </div>

        <div class="teams-wrap">
          ${renderTeam(match.homeTeam, 'home')}
          <div class="score-box">
            <div class="score-number">${esc(scoreText)}</div>
            <div class="score-time ${status === 'live' ? 'is-live' : ''}">
              ${esc(time)}
            </div>
          </div>
          ${renderTeam(match.awayTeam, 'away')}
        </div>

        <div class="match-end">
          ${pill}
          <button
            class="favorite-btn ${saved ? 'saved' : ''}"
            data-favorite="${esc(id)}"
            aria-label="${saved ? 'حذف من المفضلة' : 'إضافة للمفضلة'}"
            aria-pressed="${saved}"
          >${saved ? '★' : '☆'}</button>
        </div>
      </article>
    `;
  }

  function matchesForCurrentView() {
    const selectedDate = els.date.value || todayISO();
    let list = [...state.matches];

    if (state.view === 'today') {
      list = list.filter(match => matchDate(match) === selectedDate);
    } else if (state.view === 'live') {
      list = list.filter(match => statusOf(match) === 'live');
    } else if (state.view === 'upcoming') {
      list = list.filter(match => {
        return (
          statusOf(match) === 'upcoming' &&
          matchDate(match) >= selectedDate
        );
      });
    } else if (state.view === 'finished') {
      list = list.filter(match => statusOf(match) === 'finished');
    } else if (state.view === 'favorites') {
      list = list.filter(match =>
        state.favorites.has(matchId(match)) ||
        state.favorites.has(String(match.homeTeam?.id)) ||
        state.favorites.has(String(match.awayTeam?.id))
      );
    }

    return list;
  }

  function visibleMatches() {
    let list = matchesForCurrentView();

    if (state.tab !== 'all') {
      list = list.filter(match => statusOf(match) === state.tab);
    }

    if (state.league !== 'all') {
      list = list.filter(match =>
        String(match.competition?.id ?? match.competition?.name ?? '') ===
        state.league
      );
    }

    if (state.query.trim()) {
      const query = state.query.trim().toLocaleLowerCase();

      list = list.filter(match => [
        teamName(match.homeTeam),
        teamName(match.awayTeam),
        match.competition?.name,
        match.competition?.area?.name
      ].some(value =>
        String(value || '').toLocaleLowerCase().includes(query)
      ));
    }

    list.sort((a, b) => {
      if (state.sort === 'league') {
        return String(a.competition?.name || '').localeCompare(
          String(b.competition?.name || '')
        );
      }

      return new Date(a.utcDate || a.date || 0) -
        new Date(b.utcDate || b.date || 0);
    });

    return list;
  }

  function renderList() {
    if (state.loading && !state.matches.length) {
      els.matchList.innerHTML = `
        <div class="loading-state">
          <span class="loader"></span>
          <strong>كنوجدو ليك المباريات...</strong>
          <small>لحظات ونجيبو آخر البيانات المتاحة.</small>
        </div>
      `;
      els.loadMore.hidden = true;
      return;
    }

    if (state.error && !state.matches.length) {
      els.matchList.innerHTML = `
        <div class="error-state">
          <div class="empty-icon">!</div>
          <strong>ما قدرناش نجيبو المباريات دابا</strong>
          <p>${esc(state.error)}</p>
          <button class="retry-btn" id="retryBtn">عاود المحاولة</button>
        </div>
      `;

      $('#retryBtn')?.addEventListener('click', loadMatches);
      els.resultCount.textContent = 'تعذر تحميل البيانات';
      els.loadMore.hidden = true;
      return;
    }

    const list = visibleMatches();

    if (!list.length) {
      const message =
        state.view === 'favorites'
          ? 'مازال ما ضفتي حتى مباراة للمفضلة.'
          : state.query
            ? 'ما لقيناش مباريات كتوافق البحث ديالك.'
            : state.view === 'today'
              ? 'ما لقاينا حتى مباراة فالتاريخ المختار ضمن البيانات المتاحة.'
              : state.view === 'upcoming'
                ? 'ما كايناش مباريات قادمة متاحة فالفترة المحمّلة.'
                : 'ما كايناش مباريات مطابقة لهاد الاختيارات.';

      els.matchList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⚽</div>
          <strong>${state.query ? 'ما لقيناش النتيجة' : 'ما كايناش مباريات هنا'}</strong>
          <p>${esc(message)}</p>
          ${state.error ? `<p>${esc(state.error)}</p>` : ''}
          <button class="retry-btn" id="emptyResetBtn">عرض جميع المباريات</button>
        </div>
      `;

      $('#emptyResetBtn')?.addEventListener('click', () => {
        state.query = '';
        state.tab = 'all';
        state.league = 'all';
        state.limit = 12;

        els.search.value = '';
        els.leagueSelect.value = 'all';

        setTab('all');
        renderList();
      });

      els.resultCount.textContent = '0 مباراة';
      els.loadMore.hidden = true;
      return;
    }

    const shown = list.slice(0, state.limit);

    els.matchList.innerHTML = shown.map(renderMatch).join('');

    attachCrestFallbacks();

    els.resultCount.textContent = `عرض ${shown.length} من ${list.length} مباراة`;
    els.loadMore.hidden = list.length <= state.limit;

    els.matchList.querySelectorAll('[data-favorite]').forEach(button => {
      button.addEventListener('click', () => {
        toggleFavorite(button.dataset.favorite);
      });
    });
  }

  function updateStats() {
    const todayMatches = state.matches.filter(
      match => matchDate(match) === (els.date.value || todayISO())
    );

    const live = state.matches.filter(
      match => statusOf(match) === 'live'
    ).length;

    const finished = state.matches.filter(
      match => statusOf(match) === 'finished'
    ).length;

    const upcoming = state.matches.filter(
      match => statusOf(match) === 'upcoming'
    ).length;

    const setText = (selector, value) => {
      const element = $(selector);
      if (element) element.textContent = String(value);
    };

    setText('#statLive', live);
    setText('#statTotal', todayMatches.length);
    setText('#statFinished', finished);
    setText('#statFav', state.favorites.size);
    setText('#liveNavCount', live);

    const scoped = matchesForCurrentView();

    setText('#tabAllCount', scoped.length);
    setText(
      '#tabLiveCount',
      scoped.filter(match => statusOf(match) === 'live').length
    );
    setText(
      '#tabUpcomingCount',
      scoped.filter(match => statusOf(match) === 'upcoming').length
    );
    setText(
      '#tabFinishedCount',
      scoped.filter(match => statusOf(match) === 'finished').length
    );

    setText(
      '#heroLiveText',
      live ? `${live} مباراة مباشرة دابا` : 'آخر نتائج المباريات المتاحة عندك'
    );

    setText('#apiStatusTitle', state.error ? 'تعذر الاتصال' : 'حالة الاتصال');

    setText(
      '#apiStatusText',
      state.loading
        ? 'كنحدّثو البيانات...'
        : state.error
          ? 'راجع حالة الاتصال'
          : `آخر تحديث: ${state.lastUpdated ? timeLabel(state.lastUpdated) : '—'}`
    );

    const light = $('#apiLight');

    if (light) {
      light.className = `status-light ${
        state.error ? 'bad' : state.loading ? '' : 'ok'
      }`;
    }

    setText('#year', new Date().getFullYear());
  }

  function updateHeading() {
    const title = viewLabels[state.view] || viewLabels.today;

    if (els.sectionTitle.firstChild) {
      els.sectionTitle.firstChild.textContent = `${title} `;
    } else {
      els.sectionTitle.textContent = title;
    }

    els.crumb.textContent = title;

    els.headingDate.textContent =
      state.view === 'upcoming'
        ? '7 أيام جاية'
        : dateLabel(els.date.value);

    const subtitles = {
      today: 'مباريات التاريخ اللي اخترتي، حسب البيانات المتاحة.',
      live: 'المباريات اللي كتتلعب دابا ضمن البرنامج المتاح.',
      upcoming: 'برنامج المباريات القادمة خلال الأيام السبعة الجاية.',
      finished: 'النتائج النهائية المتاحة ضمن الفترة المحمّلة.',
      favorites: 'المباريات اللي حفظتي فالمفضلة.'
    };

    els.sectionSubtitle.textContent =
      subtitles[state.view] || subtitles.today;

    els.navButtons.forEach(button => {
      button.classList.toggle(
        'active',
        button.dataset.view === state.view
      );
    });
  }

  function populateLeagues() {
    const current = state.league;
    const leagues = new Map();

    state.matches.forEach(match => {
      const id = String(
        match.competition?.id ?? match.competition?.name ?? ''
      );

      if (id) {
        leagues.set(
          id,
          match.competition?.name || match.competitionName || 'بطولة'
        );
      }
    });

    els.leagueSelect.innerHTML =
      '<option value="all">جميع البطولات</option>' +
      [...leagues.entries()]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([id, name]) =>
          `<option value="${esc(id)}">${esc(name)}</option>`
        )
        .join('');

    els.leagueSelect.value = [...els.leagueSelect.options].some(
      option => option.value === current
    ) ? current : 'all';

    state.league = els.leagueSelect.value;
  }

  function setTab(tab) {
    state.tab = tab;

    els.tabButtons.forEach(button => {
      button.classList.toggle(
        'active',
        button.dataset.status === tab
      );
    });

    state.limit = 12;
    renderList();
    updateStats();
  }

  function toggleFavorite(id) {
    if (state.favorites.has(id)) {
      state.favorites.delete(id);
      toast('تحيدات من المفضلة.');
    } else {
      state.favorites.add(id);
      toast('تزادت للمفضلة.');
    }

    saveFavorites();
    updateStats();
    renderList();
  }

  async function loadMatches() {
    if (state.loading) return;

    state.loading = true;
    state.error = '';

    updateStats();
    renderList();

    els.refresh.disabled = true;

    const selected = els.date.value || todayISO();

    if (state.requestController) {
      state.requestController.abort();
    }

    const controller = new AbortController();
    state.requestController = controller;

    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      // Load a seven-day window, not just a single day.
      const endpoint =
        `/.netlify/functions/matches?date=${encodeURIComponent(selected)}&days=7`;

      const response = await fetch(endpoint, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal
      });

      let data = {};

      try {
        data = await response.json();
      } catch {
        throw new Error('الاستجابة من الخادم ما كانتش مفهومة.');
      }

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error(
            'مفتاح API غير صالح أو الباقة ما كتسمحش بهاد الطلب.'
          );
        }

        if (response.status === 429) {
          throw new Error(
            'وصلنا للحد ديال الطلبات. تسنّى شوية وعاود.'
          );
        }

        throw new Error(
          data.error || `وقع مشكل فالخادم (${response.status}).`
        );
      }

      if (!Array.isArray(data.matches)) {
        throw new Error('البيانات اللي وصلات ما فيهاش لائحة المباريات.');
      }

      state.matches = data.matches;
      state.lastUpdated = new Date().toISOString();
      state.error = data.warning || '';

      populateLeagues();
    } catch (error) {
      if (error.name === 'AbortError') {
        state.error = 'الطلب توقف بسبب انتهاء المهلة أو تحديث جديد.';
      } else if (error instanceof TypeError) {
        state.error =
          'ما قدرناش نتاصلو بالخادم. تأكد من الإنترنت ونشر Netlify.';
      } else {
        state.error = error.message || 'وقع خطأ غير متوقع.';
      }
    } finally {
      clearTimeout(timeoutId);

      if (state.requestController === controller) {
        state.requestController = null;
      }

      state.loading = false;
      els.refresh.disabled = false;

      updateHeading();
      updateStats();
      renderList();
    }
  }

  // Main navigation
  els.navButtons.forEach(button => {
    button.addEventListener('click', () => {
      state.view = button.dataset.view || 'today';
      state.tab = 'all';
      state.limit = 12;

      updateHeading();
      setTab('all');
      updateStats();
      renderList();
    });
  });

  // Status filters
  els.tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      setTab(button.dataset.status || 'all');
    });
  });

  // Search
  els.search.addEventListener('input', event => {
    state.query = event.target.value;
    state.limit = 12;
    renderList();
  });

  // Date selection
  els.date.value = todayISO();

  const todayLabel = $('#todayLabel');
  if (todayLabel) {
    todayLabel.textContent = dateLabel(els.date.value);
  }

  els.date.addEventListener('change', () => {
    state.view = 'today';
    state.tab = 'all';
    state.limit = 12;

    if (todayLabel) {
      todayLabel.textContent = dateLabel(els.date.value);
    }

    updateHeading();
    setTab('all');
    loadMatches();
  });

  // Manual refresh
  els.refresh.addEventListener('click', () => {
    loadMatches();
    toast('كنحدّثو النتائج...');
  });

  // Competition filter panel
  els.filterBtn.addEventListener('click', () => {
    els.filterPanel.hidden = !els.filterPanel.hidden;
  });

  els.leagueSelect.addEventListener('change', event => {
    state.league = event.target.value;
    state.limit = 12;
    renderList();
    updateStats();
  });

  els.clearFilters.addEventListener('click', () => {
    state.league = 'all';
    state.query = '';
    state.tab = 'all';
    state.limit = 12;

    els.leagueSelect.value = 'all';
    els.search.value = '';

    setTab('all');
    renderList();
    updateStats();
  });

  // Sorting
  els.sort.addEventListener('change', event => {
    state.sort = event.target.value;
    renderList();
  });

  // Pagination
  els.loadMore.addEventListener('click', () => {
    state.limit += 12;
    renderList();
  });

  // Initial page
  updateHeading();
  updateStats();
  loadMatches();

  // Refresh periodically while the page is visible.
  // The request guard prevents concurrent refreshes.
  setInterval(() => {
    if (document.visibilityState === 'visible') {
      loadMatches();
    }
  }, 90000);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      loadMatches();
    }
  });
})();
(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);

  const els = {
    matchList: $('#matchList'),
    search: $('#searchInput'),
    date: $('#datePicker'),
    refresh: $('#refreshBtn'),
    sectionTitle: $('#sectionTitle'),
    sectionSubtitle: $('#sectionSubtitle'),
    crumb: $('#crumbTitle'),
    headingDate: $('#headingDate'),
    tabButtons: [...document.querySelectorAll('.match-tab')],
    navButtons: [...document.querySelectorAll('.nav-item')],
    filterBtn: $('#leagueFilterBtn'),
    filterPanel: $('#filterPanel'),
    leagueSelect: $('#leagueSelect'),
    clearFilters: $('#clearFilters'),
    sort: $('#sortSelect'),
    loadMore: $('#loadMoreBtn'),
    resultCount: $('#resultCount'),
    toast: $('#toast')
  };

  // Stop early if the HTML structure doesn't match this script.
  const required = [
    'matchList', 'search', 'date', 'refresh', 'sectionTitle',
    'sectionSubtitle', 'crumb', 'headingDate', 'filterBtn',
    'filterPanel', 'leagueSelect', 'clearFilters', 'sort',
    'loadMore', 'resultCount', 'toast'
  ];

  for (const key of required) {
    if (!els[key]) {
      console.error(`DREB Football: missing HTML element "${key}".`);
      return;
    }
  }

  const state = {
    matches: [],
    view: 'today',
    tab: 'all',
    query: '',
    league: 'all',
    sort: 'time',
    loading: false,
    error: '',
    limit: 12,
    favorites: readFavorites(),
    lastUpdated: null,
    toastTimer: null,
    requestController: null
  };

  const viewLabels = {
    today: 'مباريات اليوم',
    live: 'مباشر الآن',
    upcoming: 'المباريات القادمة',
    finished: 'المباريات المنتهية',
    favorites: 'المفضلة'
  };

  const liveStatuses = new Set([
    'IN_PLAY', 'PAUSED', 'LIVE', '1H', '2H',
    'ET', 'P', 'HT', 'BREAK', 'EXTRA_TIME'
  ]);

  const doneStatuses = new Set([
    'FINISHED', 'FT', 'AET', 'PEN', 'AWARDED'
  ]);

  const upcomingStatuses = new Set([
    'SCHEDULED', 'TIMED', 'NS'
  ]);

  const esc = (value) =>
    String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[char]);

  function readFavorites() {
    try {
      const value = JSON.parse(
        localStorage.getItem('dreb-favorites-v2') || '[]'
      );
      return new Set(value.map(String));
    } catch {
      return new Set();
    }
  }

  function saveFavorites() {
    try {
      localStorage.setItem(
        'dreb-favorites-v2',
        JSON.stringify([...state.favorites])
      );
    } catch {
      toast('تعذر حفظ المفضلة على هذا الجهاز.');
    }
  }

  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');

    clearTimeout(state.toastTimer);

    state.toastTimer = setTimeout(() => {
      els.toast.classList.remove('show');
    }, 2600);
  }

  function todayISO() {
    const date = new Date();

    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function dateLabel(value) {
    if (!value) return '';

    const date = new Date(`${value}T12:00:00`);

    return new Intl.DateTimeFormat('ar-MA', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    }).format(date);
  }

  function timeLabel(value) {
    if (!value) return '—';

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return '—';

    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(date);
  }

  function matchDate(match) {
    if (!match.utcDate && !match.date) return '';
    const date = new Date(match.utcDate || match.date);

    if (Number.isNaN(date.getTime())) return '';

    // Use the viewer's local date for the displayed match day.
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function statusOf(match) {
    const status = String(match.status || '').toUpperCase();

    if (liveStatuses.has(status)) return 'live';
    if (doneStatuses.has(status)) return 'finished';
    if (upcomingStatuses.has(status)) return 'upcoming';

    return 'other';
  }

  function statusText(match) {
    const status = String(match.status || '').toUpperCase();

    if (status === 'PAUSED' || status === 'HT') {
      return 'استراحة';
    }

    if (liveStatuses.has(status)) {
      return match.minute != null ? `${match.minute}′` : 'مباشر';
    }

    if (doneStatuses.has(status)) return 'نهاية المباراة';
    if (status === 'POSTPONED') return 'مؤجلة';
    if (status === 'CANCELLED') return 'أُلغيت';
    if (status === 'SUSPENDED') return 'متوقفة';
    if (status === 'PENDING') return 'بانتظار التأكيد';

    if (upcomingStatuses.has(status)) {
      return timeLabel(match.utcDate || match.date);
    }

    return 'الحالة غير متاحة';
  }

  function score(match) {
    const home =
      match.homeScore ??
      match.score?.fullTime?.home ??
      match.score?.regularTime?.home;

    const away =
      match.awayScore ??
      match.score?.fullTime?.away ??
      match.score?.regularTime?.away;

    if (home == null || away == null) return '– : –';

    return `${home} : ${away}`;
  }

  function teamName(team) {
    return team?.name || team?.shortName || 'فريق غير معروف';
  }

  function teamAbbr(team) {
    const name = teamName(team).trim();

    return (
      team?.tla ||
      name.split(/\s+/).slice(0, 2).map(part => part[0]).join('')
    ).slice(0, 3).toUpperCase() || 'FC';
  }

  function matchId(match) {
    return String(
      match.id ??
      `${match.homeTeam?.id || teamName(match.homeTeam)}-${match.utcDate || match.date}-${match.awayTeam?.id || teamName(match.awayTeam)}`
    );
  }

  function renderTeam(team, side) {
    const name = teamName(team);
    const crest = team?.crest;

    const crestHtml =
      crest && /^https:\/\//i.test(crest)
        ? `<span class="team-crest"><img src="${esc(crest)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-fallback="${esc(teamAbbr(team))}"></span>`
        : `<span class="team-crest">${esc(teamAbbr(team))}</span>`;

    return `
      <div class="team ${side}">
        ${crestHtml}
        <span class="team-name" title="${esc(name)}">${esc(name)}</span>
      </div>
    `;
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

  function renderMatch(match) {
    const status = statusOf(match);
    const id = matchId(match);
    const saved = state.favorites.has(id);
    const competition =
      match.competition?.name || match.competitionName || 'مباراة';
    const area =
      match.competition?.area?.name ||
      match.area ||
      match.stage ||
      'كرة القدم';

    const time =
      status === 'live'
        ? statusText(match)
        : status === 'finished'
          ? 'انتهت'
          : status === 'upcoming'
            ? timeLabel(match.utcDate || match.date)
            : statusText(match);

    const scoreText =
      status === 'upcoming'
        ? timeLabel(match.utcDate || match.date)
        : score(match);

    let pill = '<span class="status-pill">الحالة غير متاحة</span>';

    if (status === 'live') {
      pill = '<span class="status-pill live">مباشر</span>';
    } else if (status === 'upcoming') {
      pill = '<span class="status-pill soon">قادمة</span>';
    } else if (status === 'finished') {
      pill = '<span class="status-pill">منتهية</span>';
    }

    return `
      <article class="match-card" data-match-id="${esc(id)}">
        <div class="league-info">
          <span class="league-emblem">
            ${esc((match.competition?.code || competition.slice(0, 2)).slice(0, 3).toUpperCase())}
          </span>
          <div class="league-text">
            <strong title="${esc(competition)}">${esc(competition)}</strong>
            <small>
              ${esc(area)}
              ${match.matchday ? ` · الجولة ${esc(match.matchday)}` : ''}
            </small>
          </div>
        </div>

        <div class="teams-wrap">
          ${renderTeam(match.homeTeam, 'home')}
          <div class="score-box">
            <div class="score-number">${esc(scoreText)}</div>
            <div class="score-time ${status === 'live' ? 'is-live' : ''}">
              ${esc(time)}
            </div>
          </div>
          ${renderTeam(match.awayTeam, 'away')}
        </div>

        <div class="match-end">
          ${pill}
          <button
            class="favorite-btn ${saved ? 'saved' : ''}"
            data-favorite="${esc(id)}"
            aria-label="${saved ? 'حذف من المفضلة' : 'إضافة للمفضلة'}"
            aria-pressed="${saved}"
          >${saved ? '★' : '☆'}</button>
        </div>
      </article>
    `;
  }

  function matchesForCurrentView() {
    const selectedDate = els.date.value || todayISO();
    let list = [...state.matches];

    if (state.view === 'today') {
      list = list.filter(match => matchDate(match) === selectedDate);
    } else if (state.view === 'live') {
      list = list.filter(match => statusOf(match) === 'live');
    } else if (state.view === 'upcoming') {
      list = list.filter(match => {
        return (
          statusOf(match) === 'upcoming' &&
          matchDate(match) >= selectedDate
        );
      });
    } else if (state.view === 'finished') {
      list = list.filter(match => statusOf(match) === 'finished');
    } else if (state.view === 'favorites') {
      list = list.filter(match =>
        state.favorites.has(matchId(match)) ||
        state.favorites.has(String(match.homeTeam?.id)) ||
        state.favorites.has(String(match.awayTeam?.id))
      );
    }

    return list;
  }

  function visibleMatches() {
    let list = matchesForCurrentView();

    if (state.tab !== 'all') {
      list = list.filter(match => statusOf(match) === state.tab);
    }

    if (state.league !== 'all') {
      list = list.filter(match =>
        String(match.competition?.id ?? match.competition?.name ?? '') ===
        state.league
      );
    }

    if (state.query.trim()) {
      const query = state.query.trim().toLocaleLowerCase();

      list = list.filter(match => [
        teamName(match.homeTeam),
        teamName(match.awayTeam),
        match.competition?.name,
        match.competition?.area?.name
      ].some(value =>
        String(value || '').toLocaleLowerCase().includes(query)
      ));
    }

    list.sort((a, b) => {
      if (state.sort === 'league') {
        return String(a.competition?.name || '').localeCompare(
          String(b.competition?.name || '')
        );
      }

      return new Date(a.utcDate || a.date || 0) -
        new Date(b.utcDate || b.date || 0);
    });

    return list;
  }

  function renderList() {
    if (state.loading && !state.matches.length) {
      els.matchList.innerHTML = `
        <div class="loading-state">
          <span class="loader"></span>
          <strong>كنوجدو ليك المباريات...</strong>
          <small>لحظات ونجيبو آخر البيانات المتاحة.</small>
        </div>
      `;
      els.loadMore.hidden = true;
      return;
    }

    if (state.error && !state.matches.length) {
      els.matchList.innerHTML = `
        <div class="error-state">
          <div class="empty-icon">!</div>
          <strong>ما قدرناش نجيبو المباريات دابا</strong>
          <p>${esc(state.error)}</p>
          <button class="retry-btn" id="retryBtn">عاود المحاولة</button>
        </div>
      `;

      $('#retryBtn')?.addEventListener('click', loadMatches);
      els.resultCount.textContent = 'تعذر تحميل البيانات';
      els.loadMore.hidden = true;
      return;
    }

    const list = visibleMatches();

    if (!list.length) {
      const message =
        state.view === 'favorites'
          ? 'مازال ما ضفتي حتى مباراة للمفضلة.'
          : state.query
            ? 'ما لقيناش مباريات كتوافق البحث ديالك.'
            : state.view === 'today'
              ? 'ما لقاينا حتى مباراة فالتاريخ المختار ضمن البيانات المتاحة.'
              : state.view === 'upcoming'
                ? 'ما كايناش مباريات قادمة متاحة فالفترة المحمّلة.'
                : 'ما كايناش مباريات مطابقة لهاد الاختيارات.';

      els.matchList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⚽</div>
          <strong>${state.query ? 'ما لقيناش النتيجة' : 'ما كايناش مباريات هنا'}</strong>
          <p>${esc(message)}</p>
          ${state.error ? `<p>${esc(state.error)}</p>` : ''}
          <button class="retry-btn" id="emptyResetBtn">عرض جميع المباريات</button>
        </div>
      `;

      $('#emptyResetBtn')?.addEventListener('click', () => {
        state.query = '';
        state.tab = 'all';
        state.league = 'all';
        state.limit = 12;

        els.search.value = '';
        els.leagueSelect.value = 'all';

        setTab('all');
        renderList();
      });

      els.resultCount.textContent = '0 مباراة';
      els.loadMore.hidden = true;
      return;
    }

    const shown = list.slice(0, state.limit);

    els.matchList.innerHTML = shown.map(renderMatch).join('');

    attachCrestFallbacks();

    els.resultCount.textContent = `عرض ${shown.length} من ${list.length} مباراة`;
    els.loadMore.hidden = list.length <= state.limit;

    els.matchList.querySelectorAll('[data-favorite]').forEach(button => {
      button.addEventListener('click', () => {
        toggleFavorite(button.dataset.favorite);
      });
    });
  }

  function updateStats() {
    const todayMatches = state.matches.filter(
      match => matchDate(match) === (els.date.value || todayISO())
    );

    const live = state.matches.filter(
      match => statusOf(match) === 'live'
    ).length;

    const finished = state.matches.filter(
      match => statusOf(match) === 'finished'
    ).length;

    const upcoming = state.matches.filter(
      match => statusOf(match) === 'upcoming'
    ).length;

    const setText = (selector, value) => {
      const element = $(selector);
      if (element) element.textContent = String(value);
    };

    setText('#statLive', live);
    setText('#statTotal', todayMatches.length);
    setText('#statFinished', finished);
    setText('#statFav', state.favorites.size);
    setText('#liveNavCount', live);

    const scoped = matchesForCurrentView();

    setText('#tabAllCount', scoped.length);
    setText(
      '#tabLiveCount',
      scoped.filter(match => statusOf(match) === 'live').length
    );
    setText(
      '#tabUpcomingCount',
      scoped.filter(match => statusOf(match) === 'upcoming').length
    );
    setText(
      '#tabFinishedCount',
      scoped.filter(match => statusOf(match) === 'finished').length
    );

    setText(
      '#heroLiveText',
      live ? `${live} مباراة مباشرة دابا` : 'آخر نتائج المباريات المتاحة عندك'
    );

    setText('#apiStatusTitle', state.error ? 'تعذر الاتصال' : 'حالة الاتصال');

    setText(
      '#apiStatusText',
      state.loading
        ? 'كنحدّثو البيانات...'
        : state.error
          ? 'راجع حالة الاتصال'
          : `آخر تحديث: ${state.lastUpdated ? timeLabel(state.lastUpdated) : '—'}`
    );

    const light = $('#apiLight');

    if (light) {
      light.className = `status-light ${
        state.error ? 'bad' : state.loading ? '' : 'ok'
      }`;
    }

    setText('#year', new Date().getFullYear());
  }

  function updateHeading() {
    const title = viewLabels[state.view] || viewLabels.today;

    if (els.sectionTitle.firstChild) {
      els.sectionTitle.firstChild.textContent = `${title} `;
    } else {
      els.sectionTitle.textContent = title;
    }

    els.crumb.textContent = title;

    els.headingDate.textContent =
      state.view === 'upcoming'
        ? '7 أيام جاية'
        : dateLabel(els.date.value);

    const subtitles = {
      today: 'مباريات التاريخ اللي اخترتي، حسب البيانات المتاحة.',
      live: 'المباريات اللي كتتلعب دابا ضمن البرنامج المتاح.',
      upcoming: 'برنامج المباريات القادمة خلال الأيام السبعة الجاية.',
      finished: 'النتائج النهائية المتاحة ضمن الفترة المحمّلة.',
      favorites: 'المباريات اللي حفظتي فالمفضلة.'
    };

    els.sectionSubtitle.textContent =
      subtitles[state.view] || subtitles.today;

    els.navButtons.forEach(button => {
      button.classList.toggle(
        'active',
        button.dataset.view === state.view
      );
    });
  }

  function populateLeagues() {
    const current = state.league;
    const leagues = new Map();

    state.matches.forEach(match => {
      const id = String(
        match.competition?.id ?? match.competition?.name ?? ''
      );

      if (id) {
        leagues.set(
          id,
          match.competition?.name || match.competitionName || 'بطولة'
        );
      }
    });

    els.leagueSelect.innerHTML =
      '<option value="all">جميع البطولات</option>' +
      [...leagues.entries()]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([id, name]) =>
          `<option value="${esc(id)}">${esc(name)}</option>`
        )
        .join('');

    els.leagueSelect.value = [...els.leagueSelect.options].some(
      option => option.value === current
    ) ? current : 'all';

    state.league = els.leagueSelect.value;
  }

  function setTab(tab) {
    state.tab = tab;

    els.tabButtons.forEach(button => {
      button.classList.toggle(
        'active',
        button.dataset.status === tab
      );
    });

    state.limit = 12;
    renderList();
    updateStats();
  }

  function toggleFavorite(id) {
    if (state.favorites.has(id)) {
      state.favorites.delete(id);
      toast('تحيدات من المفضلة.');
    } else {
      state.favorites.add(id);
      toast('تزادت للمفضلة.');
    }

    saveFavorites();
    updateStats();
    renderList();
  }

  async function loadMatches() {
    if (state.loading) return;

    state.loading = true;
    state.error = '';

    updateStats();
    renderList();

    els.refresh.disabled = true;

    const selected = els.date.value || todayISO();

    if (state.requestController) {
      state.requestController.abort();
    }

    const controller = new AbortController();
    state.requestController = controller;

    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      // Load a seven-day window, not just a single day.
      const endpoint =
        `/.netlify/functions/matches?date=${encodeURIComponent(selected)}&days=7`;

      const response = await fetch(endpoint, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal
      });

      let data = {};

      try {
        data = await response.json();
      } catch {
        throw new Error('الاستجابة من الخادم ما كانتش مفهومة.');
      }

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error(
            'مفتاح API غير صالح أو الباقة ما كتسمحش بهاد الطلب.'
          );
        }

        if (response.status === 429) {
          throw new Error(
            'وصلنا للحد ديال الطلبات. تسنّى شوية وعاود.'
          );
        }

        throw new Error(
          data.error || `وقع مشكل فالخادم (${response.status}).`
        );
      }

      if (!Array.isArray(data.matches)) {
        throw new Error('البيانات اللي وصلات ما فيهاش لائحة المباريات.');
      }

      state.matches = data.matches;
      state.lastUpdated = new Date().toISOString();
      state.error = data.warning || '';

      populateLeagues();
    } catch (error) {
      if (error.name === 'AbortError') {
        state.error = 'الطلب توقف بسبب انتهاء المهلة أو تحديث جديد.';
      } else if (error instanceof TypeError) {
        state.error =
          'ما قدرناش نتاصلو بالخادم. تأكد من الإنترنت ونشر Netlify.';
      } else {
        state.error = error.message || 'وقع خطأ غير متوقع.';
      }
    } finally {
      clearTimeout(timeoutId);

      if (state.requestController === controller) {
        state.requestController = null;
      }

      state.loading = false;
      els.refresh.disabled = false;

      updateHeading();
      updateStats();
      renderList();
    }
  }

  // Main navigation
  els.navButtons.forEach(button => {
    button.addEventListener('click', () => {
      state.view = button.dataset.view || 'today';
      state.tab = 'all';
      state.limit = 12;

      updateHeading();
      setTab('all');
      updateStats();
      renderList();
    });
  });

  // Status filters
  els.tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      setTab(button.dataset.status || 'all');
    });
  });

  // Search
  els.search.addEventListener('input', event => {
    state.query = event.target.value;
    state.limit = 12;
    renderList();
  });

  // Date selection
  els.date.value = todayISO();

  const todayLabel = $('#todayLabel');
  if (todayLabel) {
    todayLabel.textContent = dateLabel(els.date.value);
  }

  els.date.addEventListener('change', () => {
    state.view = 'today';
    state.tab = 'all';
    state.limit = 12;

    if (todayLabel) {
      todayLabel.textContent = dateLabel(els.date.value);
    }

    updateHeading();
    setTab('all');
    loadMatches();
  });

  // Manual refresh
  els.refresh.addEventListener('click', () => {
    loadMatches();
    toast('كنحدّثو النتائج...');
  });

  // Competition filter panel
  els.filterBtn.addEventListener('click', () => {
    els.filterPanel.hidden = !els.filterPanel.hidden;
  });

  els.leagueSelect.addEventListener('change', event => {
    state.league = event.target.value;
    state.limit = 12;
    renderList();
    updateStats();
  });

  els.clearFilters.addEventListener('click', () => {
    state.league = 'all';
    state.query = '';
    state.tab = 'all';
    state.limit = 12;

    els.leagueSelect.value = 'all';
    els.search.value = '';

    setTab('all');
    renderList();
    updateStats();
  });

  // Sorting
  els.sort.addEventListener('change', event => {
    state.sort = event.target.value;
    renderList();
  });

  // Pagination
  els.loadMore.addEventListener('click', () => {
    state.limit += 12;
    renderList();
  });

  // Initial page
  updateHeading();
  updateStats();
  loadMatches();

  // Refresh periodically while the page is visible.
  // The request guard prevents concurrent refreshes.
  setInterval(() => {
    if (document.visibilityState === 'visible') {
      loadMatches();
    }
  }, 90000);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      loadMatches();
    }
  });
})();
