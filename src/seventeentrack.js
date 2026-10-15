// -----------------------------------------------------------------------------
// Client of the 17TRACK tracking API v2.2 (api.17track.net), header `17token`.
// Every endpoint is a POST of a JSON list of at most 40 numbers.
//
//   /register      starts tracking a number; 17TRACK detects the carrier.
//                  THE ONLY CALL THAT SPENDS QUOTA (one per number, once).
//   /gettrackinfo  the tracking of registered numbers, free: 17TRACK reads
//                  the carriers on its side and keeps the result.
//   /deletetrack   forgets a number (free).
//   /getquota      the quota left.
//
// Answer: { code, data: { accepted: [...], rejected: [{ number, error: { code,
// message } }] } }; a request refused as a whole has a non-zero `code` and
// `data.errors`. Frequency limit: 3 requests per second (HTTP 429 beyond).
// -----------------------------------------------------------------------------

import { cleanText, ERROR_KINDS, isoDate, retryAfter, SourceError } from './errors.js';
import { fromSeventeenTrack } from './status.js';

export const SOURCE = '17TRACK';
export const API_URL = 'https://api.17track.net/track/v2.2/';
export const TRACKING_PAGE = 'https://t.17track.net/en#nums=';
export const TIMEOUT_MS = 20_000;
export const MAX_BATCH = 40;

// Error codes of the API used by the tracker.
export const CODES = {
  IP_NOT_ALLOWED: -18010001,
  INVALID_KEY: -18010002,
  ACCOUNT_DISABLED: -18010004,
  UNAUTHORIZED: -18010005,
  ALREADY_REGISTERED: -18019901,
  NOT_REGISTERED: -18019902,
  CARRIER_NOT_DETECTED: -18019903,
  DAILY_LIMIT: -18019907,
  QUOTA_RAN_OUT: -18019908,
  NO_TRACKING_INFO: -18019909,
};
const KEY_CODES = new Set([
  CODES.IP_NOT_ALLOWED,
  CODES.INVALID_KEY,
  CODES.ACCOUNT_DISABLED,
  CODES.UNAUTHORIZED,
]);
export const QUOTA_CODES = new Set([CODES.DAILY_LIMIT, CODES.QUOTA_RAN_OUT]);

const locationOf = (event) => {
  const where = cleanText(event?.location, 120);
  if (where) {
    return where;
  }
  const address = event?.address ?? {};
  return [address.city, address.state, address.country]
    .map((part) => cleanText(part, 60))
    .filter(Boolean)
    .join(', ');
};

/** One accepted entry of /gettrackinfo, reduced to what the integration uses. */
export function parseTrackInfo(entry) {
  const info = entry?.track_info ?? {};
  const providers = Array.isArray(info.tracking?.providers) ? info.tracking.providers : [];
  const events = providers
    .flatMap((provider) => (Array.isArray(provider?.events) ? provider.events : []))
    .map((event) => ({
      date: isoDate(event?.time_utc) ?? isoDate(event?.time_iso),
      text: cleanText(event?.description),
      location: locationOf(event),
    }))
    .filter((event) => event.text)
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  const latest = info.latest_event
    ? {
        date: isoDate(info.latest_event.time_utc) ?? isoDate(info.latest_event.time_iso),
        text: cleanText(info.latest_event.description),
        location: locationOf(info.latest_event),
      }
    : null;
  const lastEvent = latest?.text ? latest : (events[0] ?? null);
  const estimate = info.time_metrics?.estimated_delivery_date ?? {};
  const carrier = cleanText(providers[0]?.provider?.name, 60);
  const mainStatus = info.latest_status?.status;
  const number = cleanText(entry?.number, 40);
  return {
    source: SOURCE,
    status: lastEvent || mainStatus ? fromSeventeenTrack(mainStatus) : 'not_found',
    detail: cleanText(info.latest_status?.sub_status, 60),
    carrier: carrier || null,
    carrierCode: Number.isInteger(entry?.carrier) ? entry.carrier : null,
    events,
    lastEvent,
    estimatedDate: isoDate(estimate.from) ?? isoDate(estimate.to),
    url: `${TRACKING_PAGE}${encodeURIComponent(number)}`,
  };
}

/**
 * Sends one request; resolves `data`, throws a SourceError when the request
 * is refused as a whole.
 */
export async function call(
  endpoint,
  body,
  { apiKey, fetch = globalThis.fetch, timeoutMs = TIMEOUT_MS },
) {
  let response;
  try {
    response = await fetch(`${API_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        '17token': apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new SourceError(SOURCE, ERROR_KINDS.UNAVAILABLE, {
      detail: err.cause?.code ?? err.name,
    });
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // An HTML error page of a proxy, or an empty body: the status decides.
  }
  const { status } = response;
  const error = payload?.data?.errors?.[0];
  const code = Number(error?.code ?? payload?.code);
  const detail = cleanText(error?.message ?? '', 200);
  if (status === 401 || status === 403 || KEY_CODES.has(code)) {
    throw new SourceError(SOURCE, ERROR_KINDS.INVALID_KEY, {
      status,
      detail: code === CODES.IP_NOT_ALLOWED ? 'IP address not in the whitelist' : detail,
    });
  }
  if (status === 429) {
    throw new SourceError(SOURCE, ERROR_KINDS.QUOTA, {
      status,
      detail: detail || 'too many requests',
      retryAfterMs: retryAfter(response) ?? 60_000,
    });
  }
  if (QUOTA_CODES.has(code)) {
    throw new SourceError(SOURCE, ERROR_KINDS.QUOTA, { status, detail });
  }
  if (!response.ok || !payload || payload.code !== 0 || typeof payload.data !== 'object') {
    throw new SourceError(SOURCE, ERROR_KINDS.UNAVAILABLE, {
      status,
      detail: detail || (Number.isFinite(code) ? `code ${code}` : ''),
    });
  }
  return payload.data;
}

const rejectedOf = (data) =>
  new Map(
    (Array.isArray(data?.rejected) ? data.rejected : [])
      .filter((entry) => typeof entry?.number === 'string')
      .map((entry) => [entry.number.toUpperCase(), Number(entry.error?.code)]),
  );

/**
 * Registers numbers (spends one quota unit per number accepted).
 * @returns {Promise<{ accepted: Map<string, number|null>, rejected: Map<string, number> }>}
 */
export async function register(numbers, options) {
  const data = await call(
    'register',
    numbers.map((number) => ({ number })),
    options,
  );
  const accepted = new Map(
    (Array.isArray(data?.accepted) ? data.accepted : [])
      .filter((entry) => typeof entry?.number === 'string')
      .map((entry) => [
        entry.number.toUpperCase(),
        Number.isInteger(entry.carrier) ? entry.carrier : null,
      ]),
  );
  return { accepted, rejected: rejectedOf(data) };
}

/**
 * The tracking of registered numbers (free).
 * @returns {Promise<{ accepted: Map<string, object>, rejected: Map<string, number> }>}
 */
export async function getTrackInfo(numbers, options) {
  const data = await call(
    'gettrackinfo',
    numbers.map((number) => ({ number })),
    options,
  );
  const accepted = new Map(
    (Array.isArray(data?.accepted) ? data.accepted : [])
      .filter((entry) => typeof entry?.number === 'string')
      .map((entry) => [entry.number.toUpperCase(), parseTrackInfo(entry)]),
  );
  return { accepted, rejected: rejectedOf(data) };
}

/** Forgets numbers on the 17TRACK account (free). */
export async function deleteTrack(numbers, options) {
  await call(
    'deletetrack',
    numbers.map((number) => ({ number })),
    options,
  );
}

/** The quota of the account: { total, used, remaining, todayUsed, maxDaily }. */
export async function getQuota(options) {
  const data = await call('getquota', {}, options);
  const number = (value) => (Number.isFinite(value) ? value : null);
  return {
    total: number(data.quota_total),
    used: number(data.quota_used),
    remaining: number(data.quota_remain),
    todayUsed: number(data.today_used),
    maxDaily: number(data.max_track_daily),
  };
}
