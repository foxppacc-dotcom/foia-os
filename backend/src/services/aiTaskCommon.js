// Shared helpers for the recurring AI tasks (scheduling, pipeline-list concept map,
// paging helper, small utilities). No HTTP, no express -- used by the runner,
// the sensors and the routes.

// ---------- scheduling ----------
function tzParts(date, tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(date).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute };
}

/** Wall-clock time in `tz` -> the matching UTC Date. */
function zonedToUtc(y, m, d, h, mi, tz) {
  const target = Date.UTC(y, m - 1, d, h, mi);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = tzParts(new Date(guess), tz);
    guess += target - Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi);
  }
  return new Date(guess);
}

/** When should `task` run next, counting from `from`? */
function computeNextRunAt(task, from = new Date()) {
  if (task.schedule_type === 'daily' && /^\d{1,2}:\d{2}$/.test(task.run_at_time || '')) {
    const tz = task.timezone || 'Africa/Cairo';
    const [hh, mm] = task.run_at_time.split(':').map(Number);
    const now = tzParts(from, tz);
    let next = zonedToUtc(now.y, now.m, now.d, hh, mm, tz);
    if (next <= from) {
      const tomorrow = new Date(Date.UTC(now.y, now.m - 1, now.d + 1));
      next = zonedToUtc(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), hh, mm, tz);
    }
    return next;
  }
  const minutes = Math.max(5, parseInt(task.interval_minutes) || 360);
  return new Date(from.getTime() + minutes * 60 * 1000);
}

// ---------- paging (PostgREST caps a single response at 1000 rows) ----------
async function fetchAll(makeQuery, pageSize = 1000, maxRows = 20000) {
  const rows = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

const daysBetween = (a, b) => Math.floor((new Date(b) - new Date(a)) / 86400000);
const todayStr = () => new Date().toISOString().slice(0, 10);

// ---------- settings ----------
async function getSetting(sup, key, fallback = {}) {
  const { data } = await sup.from('ai_task_settings').select('value').eq('key', key).maybeSingle();
  return data?.value ?? fallback;
}
async function setSetting(sup, key, value) {
  const { error } = await sup.from('ai_task_settings').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
}

// ---------- management-controlled limits ----------
// Editable from "مهام المساعد" > "الحدود والميزانية" (ai_task_settings key 'limits').
const LIMIT_DEFAULTS = { max_custom_tasks: 20, min_interval_minutes: 30, daily_llm_budget: 450, provider_daily_cap: 600 };
const LIMIT_RANGES = { max_custom_tasks: [1, 500], min_interval_minutes: [1, 1440], daily_llm_budget: [20, 20000], provider_daily_cap: [100, 50000] };
async function getLimits(sup) {
  const saved = await getSetting(sup, 'limits', {});
  const out = { ...LIMIT_DEFAULTS };
  for (const k of Object.keys(LIMIT_DEFAULTS)) {
    const n = parseInt(saved && saved[k]);
    if (Number.isFinite(n)) out[k] = Math.min(LIMIT_RANGES[k][1], Math.max(LIMIT_RANGES[k][0], n));
  }
  return out;
}

// ---------- pipeline-list concept map ----------
// The live lists were created from the admin UI (names differ per environment), so the
// concepts the sensors need are resolved by NAME with an admin override stored in
// ai_task_settings('list_map') = { payment:[ids], terminal:[ids], confirmation:[ids], awaiting:[ids] }.
const DEFAULT_NAME_MAP = {
  // payment is being asked of us -> not "no reply"
  payment: ['payment required', 'pay requier for incident report', 'payment team required', 'مطلوب دفع'],
  // a final / answered state: nothing to chase
  terminal: ['records received', 'no records available', 'denied by law', 'agency has no bodycams', 'case pending in court',
    'rejected by media team', 'sent to media team', 'recived incident report', 'partial receipt', 'payment made and pending records'],
  confirmation: ['citizenship needed'],
  awaiting: ['requested/ awating respond'],
  notStarted: ['not started'],
};

async function getListMap(sup) {
  const { data: lists } = await sup.from('pipeline_lists').select('id, name_en, name_ar').is('deleted_at', null);
  const override = await getSetting(sup, 'list_map', null);
  const byName = (names) => (lists || []).filter(l => names.includes(String(l.name_en || '').trim().toLowerCase()) || names.includes(String(l.name_ar || '').trim())).map(l => l.id);
  const map = {};
  for (const k of Object.keys(DEFAULT_NAME_MAP)) {
    map[k] = override && Array.isArray(override[k]) ? override[k].map(Number) : byName(DEFAULT_NAME_MAP[k]);
  }
  map._lists = lists || [];
  map._nameById = Object.fromEntries((lists || []).map(l => [l.id, l.name_ar || l.name_en]));
  return map;
}

// ---------- text helpers ----------
const BOUNCE_RE = /(mailer-daemon|postmaster|mail delivery|undeliver|delivery status|returned mail|failure notice|delivery failure|could not be delivered|address not found|bounce)/i;
const isBounce = (c) => BOUNCE_RE.test(`${c.sender || ''} ${c.subject || ''}`);

const clip = (s, n = 400) => (s == null ? '' : String(s).replace(/\s+/g, ' ').trim().slice(0, n));

module.exports = {
  computeNextRunAt, zonedToUtc, fetchAll, chunk, daysBetween, todayStr,
  getSetting, setSetting, getListMap, isBounce, BOUNCE_RE, clip, getLimits, LIMIT_DEFAULTS, LIMIT_RANGES,
};
