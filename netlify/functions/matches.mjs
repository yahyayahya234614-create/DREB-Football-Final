
const API_BASE = 'https://api.football-data.org/v4';

const LIVE = new Set([
  'IN_PLAY', 'PAUSED', 'LIVE', '1H', '2H', 'ET', 'P', 'HT',
  'BREAK', 'EXTRA_TIME'
]);

const DONE = new Set(['FINISHED', 'AET', 'PEN']);

const UPCOMING = new Set([
  'SCHEDULED', 'TIMED', 'NS'
]);

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      ...extraHeaders
    }
  });
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function addDays(dateString, amount) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function normalize(match) {
  const score = match.score || {};
  const full = score.fullTime || {};
  const half = score.halfTime || {};

  return {
    id: match.id,
    utcDate: match.utcDate,
    status: match.status,
    minute: match.minute ?? null,

    competition: match.competition
      ? {
          id: match.competition.id,
          name: match.competition.name,
          code: match.competition.code,
          emblem: match.competition.emblem,
          area: match.competition.area
            ? { name: match.competition.area.name }
            : null
        }
      : null,

    homeTeam: match.homeTeam
      ? {
          id: match.homeTeam.id,
          name: match.homeTeam.name,
          shortName: match.homeTeam.shortName,
          tla: match.homeTeam.tla,
          crest: match.homeTeam.crest
        }
      : null,

    awayTeam: match.awayTeam
      ? {
          id: match.awayTeam.id,
          name: match.awayTeam.name,
          shortName: match.awayTeam.shortName,
          tla: match.awayTeam.tla,
          crest: match.awayTeam.crest
        }
      : null,

    homeScore: full.home ?? null,
    awayScore: full.away ?? null,

    score: {
      fullTime: {
        home: full.home ?? null,
        away: full.away ?? null
      },
      halfTime: {
        home: half.home ?? null,
        away: half.away ?? null
      }
    },

    matchday: match.matchday ?? null,
    stage: match.stage ?? null,
    group: match.group ?? null,
    lastUpdated: match.lastUpdated ?? null
  };
}

export default async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  }

  if (request.method !== 'GET') {
    return json(
      { error: 'Method not allowed', matches: [] },
      405,
      { Allow: 'GET, OPTIONS', 'Cache-Control': 'no-store' }
    );
  }

  const token =
    process.env.FOOTBALL_DATA_API_KEY ||
    process.env.FOOTBALL_DATA_TOKEN;

  if (!token) {
    return json(
      {
        error: 'API key missing. Configure FOOTBALL_DATA_API_KEY in Netlify.',
        matches: []
      },
      503,
      { 'Cache-Control': 'no-store' }
    );
  }

  const url = new URL(request.url);

  // date=YYYY-MM-DD (optional)
  // days=1 to 14 (optional; default 1)
  const today = new Date().toISOString().slice(0, 10);
  const date = url.searchParams.get('date') || today;
  const requestedDays = Number(url.searchParams.get('days') || 1);

  if (!validDate(date)) {
    return json(
      { error: 'Invalid date. Use YYYY-MM-DD.', matches: [] },
      400,
      { 'Cache-Control': 'no-store' }
    );
  }

  if (
    !Number.isInteger(requestedDays) ||
    requestedDays < 1 ||
    requestedDays > 14
  ) {
    return json(
      { error: 'days must be an integer between 1 and 14.', matches: [] },
      400,
      { 'Cache-Control': 'no-store' }
    );
  }

  // The end boundary is exclusive in our own filtering.
  // Request the following date as well so provider boundary
  // behavior does not accidentally omit the selected day.
  const endDate = addDays(date, requestedDays);

  const params = new URLSearchParams({
    dateFrom: date,
    dateTo: endDate
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const upstream = await fetch(
      `${API_BASE}/matches?${params.toString()}`,
      {
        method: 'GET',
        headers: {
          'X-Auth-Token': token,
          Accept: 'application/json'
        },
        signal: controller.signal
      }
    );

    const rawText = await upstream.text();

    let payload = {};

    try {
      payload = rawText ? JSON.parse(rawText) : {};
    } catch {
      payload = {};
    }

    if (!upstream.ok) {
      const status =
        upstream.status === 401 || upstream.status === 403
          ? upstream.status
          : upstream.status === 429
            ? 429
            : upstream.status >= 500
              ? 502
              : upstream.status;

      let message = payload.message ||
        `Football data provider returned ${upstream.status}.`;

      if (upstream.status === 401) {
        message = 'The football data API key is invalid.';
      } else if (upstream.status === 403) {
        message = 'Your API plan does not allow this request.';
      } else if (upstream.status === 429) {
        message = 'API rate limit reached. Please try again later.';
      }

      return json(
        { error: message, matches: [] },
        status,
        { 'Cache-Control': 'no-store' }
      );
    }

    const rawMatches = Array.isArray(payload.matches)
      ? payload.matches
      : [];

    // Keep only the requested UTC date range.
    // This avoids accidentally including the extra boundary day.
    const matches = rawMatches
      .filter((match) => {
        if (!match.utcDate) return false;

        const matchDate = match.utcDate.slice(0, 10);

        return matchDate >= date && matchDate < endDate;
      })
      .map(normalize)
      .sort((a, b) =>
        new Date(a.utcDate) - new Date(b.utcDate)
      );

    const counts = {
      total: matches.length,
      live: matches.filter((m) => LIVE.has(m.status)).length,
      finished: matches.filter((m) => DONE.has(m.status)).length,
      upcoming: matches.filter((m) => UPCOMING.has(m.status)).length
    };

    return json({
      date,
      dateTo: addDays(endDate, -1),
      days: requestedDays,
      count: matches.length,
      counts,
      matches,
      source: 'football-data.org',
      fetchedAt: new Date().toISOString()
    });
  } catch (error) {
    const aborted = error?.name === 'AbortError';

    return json(
      {
        error: aborted
          ? 'The football data provider timed out. Please retry.'
          : 'Unable to reach the football data provider.',
        matches: []
      },
      502,
      { 'Cache-Control': 'no-store' }
    );
  } finally {
    clearTimeout(timeout);
  }
};
