// -----------------------------------------------------------------------------
// Errors of the tracking sources, sorted into the few kinds the tracker acts
// on. The API keys never leave the clients, and never appear in a message.
// -----------------------------------------------------------------------------

export const ERROR_KINDS = {
  INVALID_KEY: 'invalid_key',
  QUOTA: 'quota',
  UNAVAILABLE: 'unavailable',
};

export class SourceError extends Error {
  constructor(source, kind, { status = null, detail = '', retryAfterMs = null } = {}) {
    super(`${source}: ${kind}${status ? ` (HTTP ${status})` : ''}${detail ? `: ${detail}` : ''}`);
    this.name = 'SourceError';
    this.source = source;
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Retry-After in milliseconds, when the server sends one in seconds. */
export function retryAfter(response) {
  const seconds = Number(response.headers?.get?.('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

/** An ISO date, or null. */
export function isoDate(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  // DHL sends some times without zone ("2022-06-27T19:30:00"): local time of
  // the place, read here as the time zone of Gladys (TZ), close enough to show.
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** An https URL, or null. */
export function httpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** A short single-line text, or ''. */
export const cleanText = (value, max = 300) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
