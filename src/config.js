// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Days a delivered parcel stays in the list (and in the widget) before it is
// archived.
export const KEEP_DELIVERED_DAYS = ['1', '3', '7', '14', '30'];

export const DEFAULT_CONFIG = {
  seventeentrack_key: '',
  dhl_key: '',
  keep_delivered: '7',
  language: 'fr',
};

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const keep = String(source.keep_delivered);
  return {
    seventeenTrackKey: text(source.seventeentrack_key),
    dhlKey: text(source.dhl_key),
    keepDeliveredDays: Number(
      KEEP_DELIVERED_DAYS.includes(keep) ? keep : DEFAULT_CONFIG.keep_delivered,
    ),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
