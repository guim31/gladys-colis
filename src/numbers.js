// -----------------------------------------------------------------------------
// Tracking numbers, from every carrier: UPS 1Z…, USPS and FedEx long digit
// strings, DHL Express 10 digits, DHL Paket 12 or 20 digits and JJD…, Royal
// Mail and the posts XX123456789CC, Amazon TBA…, Asian marketplaces
// (YT…, LP…). Spaces, dots and dashes typed or copied from a mail are dropped.
// 8 to 40 letters and digits, 5 digits at least: a word is never a number.
// -----------------------------------------------------------------------------

const SHAPE = /^[A-Z0-9]{8,40}$/;

const isNumber = (value) => SHAPE.test(value) && (value.match(/\d/g) ?? []).length >= 5;

/** The tracking number typed by the user, normalized; null if invalid. */
export function normalizeNumber(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    return null;
  }
  const value = String(raw)
    .toUpperCase()
    .replace(/[\s.\-/]/g, '');
  return isNumber(value) ? value : null;
}

/**
 * The first tracking number found in a text (the subject of a mail passed by a
 * scene, for example); null if there is none. A word of the text that is a
 * number wins; otherwise the whole text may be one number typed with spaces.
 */
export function extractNumber(text) {
  if (typeof text !== 'string') {
    return normalizeNumber(text);
  }
  const word = text
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .find(isNumber);
  return word ?? normalizeNumber(text);
}

// Shapes of the numbers DHL issues (Express, Paket, Deutsche Post, eCommerce,
// Parcel Benelux). A match only means "ask DHL first": a 12-digit number may as
// well be FedEx, and DHL's 404 then hands it to 17TRACK.
const DHL_SHAPES = [
  /^\d{10}$/, // DHL Express waybill
  /^\d{12}$/, // DHL Paket
  /^\d{20}$/, // DHL Paket (SSCC, 00340…)
  /^JJD\d{10,22}$/, // DHL Express / Paket piece
  /^JVGL\d{10,20}$/, // DHL Global Forwarding piece
  /^GM\d{16,22}$/, // DHL eCommerce
  /^LX\d{9}DE$/, // Deutsche Post international, tracked
  /^[A-Z]{2}\d{9}DE$/, // Deutsche Post (registered, international)
  /^3S[A-Z0-9]{8,20}$/, // DHL Parcel Benelux
];

/** True when the number looks like one DHL issues. */
export const looksLikeDhl = (number) => DHL_SHAPES.some((shape) => shape.test(number));
