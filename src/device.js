// -----------------------------------------------------------------------------
// One Gladys device per tracked parcel, named after the parcel.
//
// External id: `gladys.externalIds('parcel', <tracking number>)`: the number is
// the parcel's own identifier at the carriers, it never changes. The device
// stays in Gladys after the parcel is archived (the SDK cannot delete a
// device): the user deletes it, the docs say so. An archived parcel leaves the
// Discover tab.
//
// Features, all text/text, read only (couples checked against the Gladys
// front, v5.2.1): status (normalized, in the configured language), last event
// (the carrier's own text), its place and date, carrier, expected delivery.
// A text state is never empty: '—' when the carrier says nothing.
// Published with should_poll: false: the container reads the sources on its own
// timer (src/tracker.js), at a pace that follows the status.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
import { NAMES, pick } from './texts.js';

export const DEVICE_TYPE = 'parcel';
export const FEATURES = ['status', 'event', 'location', 'event_date', 'carrier', 'eta'];
export const EMPTY = '—';

// Tracked parcels at most (and devices in the Discover tab).
export const MAX_PARCELS = 40;

/** External ids of the device of one parcel and of its features. */
export function deviceIds(gladys, number) {
  const ids = gladys.externalIds(DEVICE_TYPE, number);
  return {
    device: ids.device,
    ...Object.fromEntries(FEATURES.map((key) => [key, ids.feature(key)])),
  };
}

/** The discovery payload of a parcel's device, feature names in `language`. */
export function buildDevice(gladys, parcel, language = 'fr') {
  const ids = deviceIds(gladys, parcel.number);
  const names = pick(NAMES, language);
  return {
    name: parcel.name === parcel.number ? parcel.number : `${parcel.name} (${parcel.number})`,
    external_id: ids.device,
    ...(parcel.carrier ? { model: parcel.carrier } : {}),
    should_poll: false,
    features: FEATURES.map((key) => ({
      name: names[key],
      external_id: ids[key],
      category: DEVICE_FEATURE_CATEGORIES.TEXT,
      type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
      read_only: true,
      has_feedback: false,
      keep_history: key === 'status' || key === 'event',
      min: 0,
      max: 0,
    })),
  };
}
