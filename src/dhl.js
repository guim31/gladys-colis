// -----------------------------------------------------------------------------
// Client of DHL "Shipment Tracking - Unified" (developer.dhl.com):
// GET https://api-eu.dhl.com/track/shipments?trackingNumber=…&language=…,
// header DHL-API-Key. One number per request. Covers DHL Paket, Express,
// eCommerce, Freight, Deutsche Post and DHL Parcel (Benelux, UK, PL).
//
// Free plan: 250 requests per day, one every 5 seconds at most (the tracker
// keeps below both, see src/tracker.js). Errors are problem+json documents
// ({ status, title, detail }): 401 a refused key, 404 a number DHL does not
// know, 429 the quota.
// -----------------------------------------------------------------------------

import { cleanText, ERROR_KINDS, httpsUrl, isoDate, retryAfter, SourceError } from './errors.js';
import { fromDhl } from './status.js';

export const SOURCE = 'DHL';
export const API_URL = 'https://api-eu.dhl.com/track/shipments';
export const TRACKING_PAGE = 'https://www.dhl.com/global-en/home/tracking.html?tracking-id=';
export const TIMEOUT_MS = 20_000;

// Languages DHL may answer in; any other gets English.
const DHL_LANGS = new Set(['en', 'de', 'fr', 'es']);

/** A number DHL does not know: not an error of the source. */
export class NotFoundError extends Error {
  constructor(detail = '') {
    super(`DHL: not found${detail ? `: ${detail}` : ''}`);
    this.name = 'NotFoundError';
  }
}

const locationOf = (value) => {
  const address = value?.address ?? {};
  const locality = cleanText(address.addressLocality, 80);
  const country = cleanText(address.countryCode, 4);
  return [locality, country].filter(Boolean).join(', ');
};

const eventOf = (event) => ({
  date: isoDate(event?.timestamp),
  text: cleanText(event?.description) || cleanText(event?.status),
  location: locationOf(event?.location),
});

const CARRIERS = {
  express: 'DHL Express',
  'parcel-de': 'DHL Paket',
  'post-de': 'Deutsche Post',
  ecommerce: 'DHL eCommerce',
  'ecommerce-europe': 'DHL eCommerce',
  'ecommerce-apac': 'DHL eCommerce',
  freight: 'DHL Freight',
  dgf: 'DHL Global Forwarding',
  'parcel-nl': 'DHL Parcel',
  'parcel-pl': 'DHL Parcel',
  'parcel-uk': 'DHL Parcel',
  sameday: 'DHL',
};

/** The first shipment of an answer, reduced to what the integration uses. */
export function parseShipment(shipment, number) {
  const events = (Array.isArray(shipment?.events) ? shipment.events : [])
    .map(eventOf)
    .filter((event) => event.text)
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  const current = shipment?.status ? eventOf(shipment.status) : null;
  const lastEvent = current?.text ? current : (events[0] ?? null);
  const id = cleanText(shipment?.id, 40) || number;
  return {
    source: SOURCE,
    status: fromDhl(shipment?.status ?? (lastEvent ? { statusCode: 'transit' } : null)),
    detail: cleanText(shipment?.status?.statusCode, 30),
    carrier: CARRIERS[shipment?.service] ?? 'DHL',
    carrierCode: null,
    events,
    lastEvent,
    estimatedDate:
      isoDate(shipment?.estimatedTimeOfDelivery) ??
      isoDate(shipment?.estimatedDeliveryTimeFrame?.estimatedFrom),
    url: httpsUrl(shipment?.serviceUrl) ?? `${TRACKING_PAGE}${encodeURIComponent(id)}`,
  };
}

/**
 * Reads one number.
 * @throws {NotFoundError} DHL does not know it
 * @throws {SourceError}
 */
export async function fetchShipment(
  number,
  { apiKey, language = 'en', fetch = globalThis.fetch, timeoutMs = TIMEOUT_MS },
) {
  const query = new URLSearchParams({
    trackingNumber: number,
    language: DHL_LANGS.has(language) ? language : 'en',
  });
  let response;
  try {
    response = await fetch(`${API_URL}?${query}`, {
      headers: { Accept: 'application/json', 'DHL-API-Key': apiKey },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new SourceError(SOURCE, ERROR_KINDS.UNAVAILABLE, {
      detail: err.cause?.code ?? err.name,
    });
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    // An HTML error page of a proxy, or an empty body: the status decides.
  }
  const { status } = response;
  const detail = cleanText(body?.detail ?? body?.title ?? '', 200);
  if (response.ok && Array.isArray(body?.shipments)) {
    if (body.shipments.length === 0) {
      throw new NotFoundError();
    }
    return parseShipment(body.shipments[0], number);
  }
  if (status === 401 || status === 403) {
    throw new SourceError(SOURCE, ERROR_KINDS.INVALID_KEY, { status, detail });
  }
  if (status === 429) {
    throw new SourceError(SOURCE, ERROR_KINDS.QUOTA, {
      status,
      detail,
      retryAfterMs: retryAfter(response),
    });
  }
  if (status === 404 || status === 400) {
    // 400: a number of a shape DHL refuses, as good as unknown to DHL.
    throw new NotFoundError(detail);
  }
  throw new SourceError(SOURCE, ERROR_KINDS.UNAVAILABLE, { status, detail });
}
