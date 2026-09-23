const db = require('../db');
const { find: findTimeZones } = require('geo-tz');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Resolve a restaurant's IANA timezone from its stored latitude/longitude.
 * Falls back to UTC (with `usedFallback: true`) when coordinates are missing.
 */
function resolveRestaurantTimeZone(restaurant) {
  const lat = restaurant?.latitude != null ? Number(restaurant.latitude) : null;
  const lng = restaurant?.longitude != null ? Number(restaurant.longitude) : null;
  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) {
    return { timeZone: 'UTC', usedFallback: true };
  }
  try {
    const zones = findTimeZones(lat, lng);
    if (zones && zones[0]) {
      return { timeZone: zones[0], usedFallback: false };
    }
  } catch (_) { /* fall through to UTC */ }
  return { timeZone: 'UTC', usedFallback: true };
}

/**
 * UTC offset (minutes) of `date` in `timeZone`, e.g. -300 for America/Chicago
 * standard time. Uses Intl's longOffset, resolved per-instant so DST is
 * correctly reflected.
 */
function offsetMinutesAt(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' });
  const part = dtf.formatToParts(date).find((p) => p.type === 'timeZoneName');
  const raw = part ? part.value : 'GMT+00:00';
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(raw);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[1 + 1]) * 60 + Number(m[3]));
}

/**
 * The UTC instant corresponding to local midnight of `dateStr` (YYYY-MM-DD)
 * in `timeZone`. One offset lookup is sufficient for a day-boundary; it can
 * only be off during the specific hour of a DST transition at midnight,
 * which is an acceptable approximation for date-range export filtering.
 */
function localMidnightToUtc(dateStr, timeZone) {
  const naiveUtc = new Date(`${dateStr}T00:00:00Z`);
  const offsetMin = offsetMinutesAt(naiveUtc, timeZone);
  return new Date(naiveUtc.getTime() - offsetMin * 60000);
}

/** ISO-8601 local timestamp with numeric offset, e.g. 2026-09-22T08:05:50-05:00 */
function formatLocalIso(date, timeZone) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset'
  });
  const parts = {};
  for (const p of dtf.formatToParts(d)) parts[p.type] = p.value;
  const offsetRaw = (parts.timeZoneName || 'GMT+00:00').replace('GMT', '') || '+00:00';
  const offset = offsetRaw === '' ? '+00:00' : offsetRaw;
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

/** Calendar date only (YYYY-MM-DD), restaurant local. */
function formatLocalDate(date, timeZone) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const dtf = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return dtf.format(d);
}

function isValidDateStr(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

/**
 * Resolve the [startAt, endAt) UTC instant bounds for an inclusive
 * start_date..end_date (YYYY-MM-DD) range in the restaurant's local
 * timezone. endAt is exclusive (local midnight of the day AFTER end_date).
 */
function resolveDateRangeUtc(startDateStr, endDateStr, timeZone) {
  const startAt = localMidnightToUtc(startDateStr, timeZone);
  const endDatePlusOne = new Date(new Date(`${endDateStr}T00:00:00Z`).getTime() + MS_PER_DAY);
  const endDatePlusOneStr = endDatePlusOne.toISOString().slice(0, 10);
  const endAt = localMidnightToUtc(endDatePlusOneStr, timeZone);
  return { startAt, endAt };
}

/** RFC-4180 + Excel-compatible CSV field escaping. */
function escapeCsvField(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') value = String(value);
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCsvLine(columns) {
  return columns.map(escapeCsvField).join(',') + '\r\n';
}

function buildCsv(headers, rows) {
  let out = toCsvLine(headers);
  for (const row of rows) {
    out += toCsvLine(headers.map((h) => row[h]));
  }
  return out;
}

/** deck: light/deep, mapped from the Exploring/Established/Mature context. */
function contextToDeck(context) {
  return String(context || '').trim().toLowerCase() === 'exploring' ? 'light' : 'deep';
}

function modeToPublic(mode) {
  return String(mode || '').trim().toLowerCase() === 'dual-phone' ? 'dual' : 'single';
}

function questionFormat(questionType) {
  return String(questionType || '').trim().toLowerCase() === 'multiple-choice' ? 'multiple_choice' : 'open_ended';
}

/** Matches frontend QuestionCard.jsx's normalizeQuestionOption/cleanOptionLabel exactly. */
function cleanOptionLabel(value) {
  return String(value ?? '').replace(/^[A-Z]\s*[:.)-]\s*/i, '').trim();
}

function normalizeQuestionOptions(rawOptions) {
  if (!rawOptions) return [];
  const source = Array.isArray(rawOptions)
    ? rawOptions
    : Array.isArray(rawOptions?.options)
      ? rawOptions.options
      : typeof rawOptions === 'string'
        ? rawOptions.split('|').map((s) => s.trim()).filter(Boolean)
        : [];
  return source
    .map((option, index) => {
      if (option == null) return null;
      if (typeof option === 'object' && !Array.isArray(option)) {
        const rawText = option.text ?? option.label ?? option.value ?? '';
        const text = cleanOptionLabel(rawText);
        if (!text) return null;
        return { id: String(option.id ?? option.value ?? `option-${index + 1}`), text };
      }
      const text = cleanOptionLabel(option);
      if (!text) return null;
      return { id: `option-${index + 1}`, text };
    })
    .filter(Boolean);
}

/**
 * Resolve the requesting user's export access for a restaurant.
 * SUPER_ADMIN may export any restaurant. RESTAURANT_ADMIN may export only
 * their own restaurant, and only when can_export_analytics is enabled.
 */
async function checkExportAccess(user, restaurantId) {
  if (!user) return { allowed: false, reason: 'Not authenticated' };
  if (user.role === 'SUPER_ADMIN') return { allowed: true };
  if (user.role === 'RESTAURANT_ADMIN') {
    if (String(user.restaurant_id) !== String(restaurantId)) {
      return { allowed: false, reason: 'Not authorized for this restaurant' };
    }
    const r = await db.query('SELECT can_export_analytics FROM restaurants WHERE id = $1', [restaurantId]);
    if (!r.rows[0]) return { allowed: false, reason: 'Restaurant not found' };
    if (!r.rows[0].can_export_analytics) {
      return { allowed: false, reason: 'Analytics export is not enabled for this restaurant' };
    }
    return { allowed: true };
  }
  return { allowed: false, reason: 'Role not permitted' };
}

/**
 * Every frontend-emitted per-question/hint event (question_shown,
 * question_dwell_complete, hint_revealed) fires once per PHONE, so a
 * dual-phone session generates two rows for one logical showing. Both
 * phones are kept in lockstep on the same question by design, so we
 * de-duplicate by only counting the session's role='A' participant's
 * stream — this yields "how many times the TABLE saw this question",
 * not "how many phones rendered it".
 *
 * mcq_answer_submitted is the one exception: the spec explicitly wants
 * each participant's choice counted separately, so it is never filtered
 * to role='A'.
 *
 * analytics_events.session_id is sometimes null on socket-originated rows
 * (a pre-existing data-quality gap, not introduced by this export); we
 * recover it via participant_id -> session_participants.session_id.
 */
function baseCte(paramOffset = 0) {
  const p = (n) => `$${paramOffset + n}`;
  return `
    target_sessions AS (
      SELECT session_id, mode, context, table_token, created_at, last_activity_at
      FROM sessions
      WHERE restaurant_id = ${p(1)}
        AND created_at >= ${p(2)}::timestamptz
        AND created_at <  ${p(3)}::timestamptz
    ),
    role_a_participants AS (
      SELECT sp.participant_id, sp.session_id
      FROM session_participants sp
      JOIN target_sessions ts ON ts.session_id = sp.session_id
      WHERE sp.role = 'A'
    ),
    resolved_events AS (
      SELECT
        ae.event_type,
        ae.participant_id,
        ae.event_data,
        ae."timestamp",
        COALESCE(ae.session_id, sp.session_id) AS resolved_session_id
      FROM analytics_events ae
      LEFT JOIN session_participants sp ON sp.participant_id = ae.participant_id
      WHERE COALESCE(ae.session_id, sp.session_id) IN (SELECT session_id FROM target_sessions)
    )
  `;
}

const SESSIONS_HEADERS = [
  'session_id', 'restaurant_id', 'restaurant_name', 'table_token', 'date',
  'started_at_local', 'last_activity_at_local', 'duration_seconds', 'mode',
  'deck', 'seconds_to_pair', 'questions_shown', 'hints_revealed', 'device_type'
];

const QUESTIONS_HEADERS = [
  'question_id', 'question_text', 'deck', 'question_format', 'times_shown',
  'median_seconds', 'avg_seconds', 'times_last_in_session', 'drop_off_rate',
  'hint_available', 'hint_reveal_rate'
];

const CHOICES_HEADERS = [
  'question_id', 'question_text', 'deck', 'option_id', 'option_text',
  'times_chosen', 'share_of_selections', 'times_matched'
];

function round2(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '';
  return Math.round(Number(n) * 100) / 100;
}

/**
 * File 1 — sessions.csv, one row per session.
 */
async function buildSessionsRows({ restaurantId, startAt, endAt, timeZone }) {
  const query = `
    WITH ${baseCte()},
    paired_at AS (
      SELECT session_id, MIN("timestamp") AS paired_at
      FROM analytics_events
      WHERE event_type = 'partner_connected'
        AND session_id IN (SELECT session_id FROM target_sessions)
      GROUP BY session_id
    ),
    questions_shown_count AS (
      SELECT re.resolved_session_id AS session_id, COUNT(*) AS c
      FROM resolved_events re
      JOIN role_a_participants rap ON rap.participant_id = re.participant_id
      WHERE re.event_type = 'question_shown'
      GROUP BY re.resolved_session_id
    ),
    hints_revealed_count AS (
      SELECT re.resolved_session_id AS session_id, COUNT(*) AS c
      FROM resolved_events re
      JOIN role_a_participants rap ON rap.participant_id = re.participant_id
      WHERE re.event_type = 'hint_revealed'
      GROUP BY re.resolved_session_id
    ),
    device_type_by_session AS (
      SELECT session_id, (event_data->>'device_type') AS device_type
      FROM analytics_events
      WHERE event_type = 'session_created'
        AND session_id IN (SELECT session_id FROM target_sessions)
    )
    SELECT
      ts.session_id, ts.mode, ts.context, ts.table_token, ts.created_at, ts.last_activity_at,
      pa.paired_at,
      COALESCE(qsc.c, 0) AS questions_shown,
      COALESCE(hrc.c, 0) AS hints_revealed,
      dts.device_type
    FROM target_sessions ts
    LEFT JOIN paired_at pa ON pa.session_id = ts.session_id
    LEFT JOIN questions_shown_count qsc ON qsc.session_id = ts.session_id
    LEFT JOIN hints_revealed_count hrc ON hrc.session_id = ts.session_id
    LEFT JOIN device_type_by_session dts ON dts.session_id = ts.session_id
    ORDER BY ts.created_at ASC
  `;
  const res = await db.query(query, [restaurantId, startAt.toISOString(), endAt.toISOString()]);
  return res.rows;
}

function sessionsRowsToCsv(rows, { restaurant, timeZone }) {
  const csvRows = rows.map((r) => {
    const createdAt = new Date(r.created_at);
    const lastActivity = r.last_activity_at ? new Date(r.last_activity_at) : createdAt;
    const durationSeconds = Math.max(0, Math.round((lastActivity.getTime() - createdAt.getTime()) / 1000));
    let secondsToPair = '';
    if (String(r.mode) === 'dual-phone' && r.paired_at) {
      secondsToPair = Math.max(0, Math.round((new Date(r.paired_at).getTime() - createdAt.getTime()) / 1000));
    }
    return {
      session_id: r.session_id,
      restaurant_id: restaurant.id,
      restaurant_name: restaurant.name,
      table_token: r.table_token || '',
      date: formatLocalDate(createdAt, timeZone),
      started_at_local: formatLocalIso(createdAt, timeZone),
      last_activity_at_local: formatLocalIso(lastActivity, timeZone),
      duration_seconds: durationSeconds,
      mode: modeToPublic(r.mode),
      deck: contextToDeck(r.context),
      seconds_to_pair: secondsToPair,
      questions_shown: Number(r.questions_shown) || 0,
      hints_revealed: Number(r.hints_revealed) || 0,
      device_type: r.device_type || ''
    };
  });
  return buildCsv(SESSIONS_HEADERS, csvRows);
}

/**
 * File 2 — questions.csv, aggregated across the period.
 */
async function buildQuestionsRows({ restaurantId, startAt, endAt }) {
  const query = `
    WITH ${baseCte()},
    shown_by_question AS (
      SELECT (re.event_data->>'question_id')::int AS question_id, COUNT(*) AS times_shown
      FROM resolved_events re
      JOIN role_a_participants rap ON rap.participant_id = re.participant_id
      WHERE re.event_type = 'question_shown'
      GROUP BY 1
    ),
    dwell_by_question AS (
      SELECT
        (re.event_data->>'question_id')::int AS question_id,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (re.event_data->>'dwell_ms')::numeric) / 1000.0 AS median_seconds,
        AVG((re.event_data->>'dwell_ms')::numeric) / 1000.0 AS avg_seconds
      FROM resolved_events re
      JOIN role_a_participants rap ON rap.participant_id = re.participant_id
      WHERE re.event_type = 'question_dwell_complete'
      GROUP BY 1
    ),
    hints_by_question AS (
      SELECT (re.event_data->>'question_id')::int AS question_id, COUNT(*) AS hints_revealed
      FROM resolved_events re
      JOIN role_a_participants rap ON rap.participant_id = re.participant_id
      WHERE re.event_type = 'hint_revealed'
      GROUP BY 1
    ),
    last_shown_per_session AS (
      SELECT DISTINCT ON (re.resolved_session_id)
        re.resolved_session_id AS session_id,
        (re.event_data->>'question_id')::int AS question_id
      FROM resolved_events re
      JOIN role_a_participants rap ON rap.participant_id = re.participant_id
      WHERE re.event_type = 'question_shown'
      ORDER BY re.resolved_session_id, re."timestamp" DESC
    ),
    last_in_session_count AS (
      SELECT question_id, COUNT(*) AS times_last_in_session
      FROM last_shown_per_session
      GROUP BY question_id
    )
    SELECT
      sbq.question_id, sbq.times_shown,
      dbq.median_seconds, dbq.avg_seconds,
      COALESCE(lisc.times_last_in_session, 0) AS times_last_in_session,
      COALESCE(hbq.hints_revealed, 0) AS hints_revealed,
      q.question_text, q.context, q.question_type, q.answer_text
    FROM shown_by_question sbq
    LEFT JOIN dwell_by_question dbq ON dbq.question_id = sbq.question_id
    LEFT JOIN last_in_session_count lisc ON lisc.question_id = sbq.question_id
    LEFT JOIN hints_by_question hbq ON hbq.question_id = sbq.question_id
    JOIN questions q ON q.question_id = sbq.question_id
    ORDER BY sbq.times_shown DESC, sbq.question_id ASC
  `;
  const res = await db.query(query, [restaurantId, startAt.toISOString(), endAt.toISOString()]);
  return res.rows;
}

function questionsRowsToCsv(rows) {
  const csvRows = rows.map((r) => {
    const timesShown = Number(r.times_shown) || 0;
    const timesLast = Number(r.times_last_in_session) || 0;
    const hintAvailable = String(r.question_type) !== 'multiple-choice'
      && r.answer_text != null && String(r.answer_text).trim().length > 0;
    return {
      question_id: r.question_id,
      question_text: r.question_text,
      deck: contextToDeck(r.context),
      question_format: questionFormat(r.question_type),
      times_shown: timesShown,
      median_seconds: r.median_seconds != null ? round2(r.median_seconds) : '',
      avg_seconds: r.avg_seconds != null ? round2(r.avg_seconds) : '',
      times_last_in_session: timesLast,
      drop_off_rate: timesShown > 0 ? round2(timesLast / timesShown) : '',
      hint_available: hintAvailable ? 'yes' : 'no',
      hint_reveal_rate: hintAvailable && timesShown > 0
        ? round2((Number(r.hints_revealed) || 0) / timesShown)
        : ''
    };
  });
  return buildCsv(QUESTIONS_HEADERS, csvRows);
}

/**
 * File 3 — choices.csv, aggregated across the period.
 */
async function buildChoicesRows({ restaurantId, startAt, endAt }) {
  const baseParams = [restaurantId, startAt.toISOString(), endAt.toISOString()];

  const questionsQuery = `
    WITH ${baseCte()},
    shown_by_question AS (
      SELECT (re.event_data->>'question_id')::int AS question_id, COUNT(*) AS times_shown
      FROM resolved_events re
      JOIN role_a_participants rap ON rap.participant_id = re.participant_id
      WHERE re.event_type = 'question_shown'
      GROUP BY 1
    )
    SELECT sbq.question_id, q.question_text, q.context, q.options
    FROM shown_by_question sbq
    JOIN questions q ON q.question_id = sbq.question_id AND q.question_type = 'multiple-choice'
    ORDER BY sbq.question_id ASC
  `;
  const questionsRes = await db.query(questionsQuery, baseParams);

  const aggQuery = `
    WITH ${baseCte()},
    mcq_events AS (
      SELECT re.resolved_session_id AS session_id, re.participant_id,
             (re.event_data->>'question_id')::int AS question_id,
             (re.event_data->>'option_id') AS option_id
      FROM resolved_events re
      WHERE re.event_type = 'mcq_answer_submitted'
    ),
    chosen AS (
      SELECT question_id, option_id, COUNT(*) AS times_chosen
      FROM mcq_events
      GROUP BY question_id, option_id
    ),
    matched AS (
      SELECT m1.question_id, m1.option_id, COUNT(*) AS times_matched
      FROM mcq_events m1
      JOIN mcq_events m2
        ON m1.session_id = m2.session_id
       AND m1.question_id = m2.question_id
       AND m1.participant_id < m2.participant_id
       AND m1.option_id = m2.option_id
      GROUP BY m1.question_id, m1.option_id
    )
    SELECT
      COALESCE(chosen.question_id, matched.question_id) AS question_id,
      COALESCE(chosen.option_id, matched.option_id) AS option_id,
      COALESCE(chosen.times_chosen, 0) AS times_chosen,
      COALESCE(matched.times_matched, 0) AS times_matched
    FROM chosen
    FULL OUTER JOIN matched
      ON matched.question_id = chosen.question_id AND matched.option_id = chosen.option_id
  `;
  const aggRes = await db.query(aggQuery, baseParams);

  const aggByKey = new Map();
  for (const row of aggRes.rows) {
    aggByKey.set(`${row.question_id}::${row.option_id}`, {
      timesChosen: Number(row.times_chosen) || 0,
      timesMatched: Number(row.times_matched) || 0
    });
  }

  return questionsRes.rows.map((q) => {
    const options = normalizeQuestionOptions(q.options);
    const enriched = options.map((opt) => {
      const agg = aggByKey.get(`${q.question_id}::${opt.id}`) || { timesChosen: 0, timesMatched: 0 };
      return { ...opt, ...agg };
    });
    const totalSelections = enriched.reduce((sum, o) => sum + o.timesChosen, 0);
    return {
      question_id: q.question_id,
      question_text: q.question_text,
      deck: contextToDeck(q.context),
      options: enriched.map((o) => ({
        option_id: o.id,
        option_text: o.text,
        times_chosen: o.timesChosen,
        share_of_selections: totalSelections > 0 ? round2(o.timesChosen / totalSelections) : '',
        times_matched: o.timesMatched
      }))
    };
  });
}

function choicesRowsToCsv(questionRows) {
  const csvRows = [];
  for (const q of questionRows) {
    for (const opt of q.options) {
      csvRows.push({
        question_id: q.question_id,
        question_text: q.question_text,
        deck: q.deck,
        option_id: opt.option_id,
        option_text: opt.option_text,
        times_chosen: opt.times_chosen,
        share_of_selections: opt.share_of_selections,
        times_matched: opt.times_matched
      });
    }
  }
  return buildCsv(CHOICES_HEADERS, csvRows);
}

function exportFilename(fileKind, restaurantId, startDateStr, endDateStr) {
  return `catalyst_${fileKind}_${restaurantId}_${startDateStr}_${endDateStr}.csv`;
}

module.exports = {
  resolveRestaurantTimeZone,
  resolveDateRangeUtc,
  formatLocalIso,
  formatLocalDate,
  isValidDateStr,
  escapeCsvField,
  toCsvLine,
  buildCsv,
  contextToDeck,
  modeToPublic,
  questionFormat,
  normalizeQuestionOptions,
  checkExportAccess,
  baseCte,
  buildSessionsRows,
  sessionsRowsToCsv,
  buildQuestionsRows,
  questionsRowsToCsv,
  buildChoicesRows,
  choicesRowsToCsv,
  exportFilename
};
