const API_BASE = 'https://api.football-data.org/v4';
const LIVE = new Set(['IN_PLAY', 'PAUSED', 'LIVE', '1H', '2H', 'ET', 'P', 'HT']);
const DONE = new Set(['FINISHED', 'AET', 'PEN']);
const UPCOMING = new Set(['SCHEDULED', 'TIMED', 'NS']);

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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
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
    competition: match.competition ? {
      id: match.competition.id,
      name: match.competition.name,
      code: match.competition.code,
      emblem: match.competition.emblem,
      area: match.competition.area ? { name: match.competition.area.name } : null
    } : null,
    homeTeam: match.homeTeam ? { id: match.homeTeam.id, name: match.homeTeam.name, shortName: match.homeTeam.shortName, tla: match.homeTeam.tla, crest: match.homeTeam.crest } : null,
    awayTeam: match.awayTeam ? { id: match.awayTeam.id, name: match.awayTeam.name, shortName: match.awayTeam.shortName, tla: match.awayTeam.tla, crest: match.awayTeam.crest } : null,
    homeScore: full.home ?? null,
    awayScore: full.away ?? null,
    score: { fullTime: { home: full.home ?? null, away: full.away ?? null }, halfTime: { home: half.home ?? null, away: half.away ?? null } },
    matchday: match.matchday ?? null,
    stage: match.stage ?? null,
    group: match.group ?? null,
    lastUpdated: match.lastUpdated ?? null
  };
}
export default async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  if (request.method !== 'GET') return json({ error: 'Method not allowed', matches: [] }, 405, { Allow: 'GET, OPTIONS' });
  const token = process.env.FOOTBALL_DATA_API_KEY || process.env.FOOTBALL_DATA_TOKEN;
  if (!token) return json({ error: 'Football data is not configured. Set FOOTBALL_DATA_API_KEY in Netlify environment variables.', matches: [] }, 503, { 'Cache-Control': 'no-store' });

  const url = new URL(request.url);
  const today = new Date().toISOString().slice(0, 10);
  const date = url.searchParams.get('date') || today;
  if (!validDate(date)) return json({ error: 'Invalid date. Use YYYY-MM-DD.', matches: [] }, 400, { 'Cache-Control': 'no-store' });

  const from = new Date(`${date}T00:00:00.000Z`);
  const to = new Date(from.getTime() + 86400000 - 1);
  const params = new URLSearchParams({ dateFrom: from.toISOString().slice(0, 10), dateTo: to.toISOString().slice(0, 10) });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const upstream = await fetch(`${API_BASE}/matches?${params}`, {
      method: 'GET', headers: { 'X-Auth-Token': token, Accept: 'application/json' }, signal: controller.signal
    });
    const rawText = await upstream.text();
    let payload;
    try { payload = rawText ? JSON.parse(rawText) : {}; } catch { payload = {}; }
    if (!upstream.ok) {
      const status = upstream.status === 401 || upstream.status === 403 ? upstream.status : upstream.status === 429 ? 429 : upstream.status >= 500 ? 502 : upstream.status;
      const message = upstream.status === 401 ? 'The football data API key is invalid.'
        : upstream.status === 403 ? 'The API plan does not allow this request.'
        : upstream.status === 429 ? 'The football data API rate limit was reached.'
        : (payload.message || `Football data provider returned ${upstream.status}.`);
      return json({ error: message, matches: [] }, status, { 'Cache-Control': 'no-store' });
    }
    const matches = Array.isArray(payload.matches) ? payload.matches.map(normalize) : [];
    matches.sort((a, b) => new Date(a.utcDate || 0) - new Date(b.utcDate || 0));
    const counts = {
      total: matches.length,
      live: matches.filter(m => LIVE.has(m.status)).length,
      finished: matches.filter(m => DONE.has(m.status)).length,
      upcoming: matches.filter(m => UPCOMING.has(m.status)).length
    };
    return json({ date, count: matches.length, counts, matches, source: 'football-data.org', fetchedAt: new Date().toISOString() });
  } catch (error) {
    const aborted = error?.name === 'AbortError';
    return json({ error: aborted ? 'The football data provider timed out. Please retry.' : 'Unable to reach the football data provider.', matches: [] }, 502, { 'Cache-Control': 'no-store' });
  } finally {
    clearTimeout(timeout);
  }
};
