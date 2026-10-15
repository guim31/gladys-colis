// -----------------------------------------------------------------------------
// One status vocabulary for every source, like the unified timeline of the
// parcel apps. The text of the carrier is kept as it is (often English or
// German) in the event; only the status is normalized.
//
//   pending          added, not read yet (ours)
//   not_found        no carrier knows the number yet (a label printed but not
//                    handed over, or a carrier 17TRACK cannot detect)
//   info_received    the sender announced the parcel ("registered")
//   in_transit       on the way
//   out_for_delivery with the courier for today's round
//   awaiting_pickup  waiting at a pickup point, a locker or a post office
//   problem          delivery failure, customs, delay, lost, returning...
//   delivered        delivered (final: never read again)
// -----------------------------------------------------------------------------

export const STATUSES = [
  'pending',
  'not_found',
  'info_received',
  'in_transit',
  'out_for_delivery',
  'awaiting_pickup',
  'problem',
  'delivered',
];

export const FINAL_STATUSES = new Set(['delivered']);

// Display order: what needs the user first.
export const DISPLAY_ORDER = [
  'out_for_delivery',
  'awaiting_pickup',
  'problem',
  'in_transit',
  'info_received',
  'not_found',
  'pending',
  'delivered',
];

// Scene trigger fired when a parcel enters a status, and the reason it carries.
export const TRIGGERS = {
  out_for_delivery: { key: 'parcel_out_for_delivery' },
  delivered: { key: 'parcel_delivered' },
  awaiting_pickup: { key: 'parcel_needs_attention', reason: 'awaiting_pickup' },
  problem: { key: 'parcel_needs_attention', reason: 'problem' },
};
export const ATTENTION_REASONS = ['awaiting_pickup', 'problem'];

// --- 17TRACK -----------------------------------------------------------------
// Main statuses of the API (v2.2 `track_info.latest_status.status`).
const SEVENTEEN_TRACK = {
  NotFound: 'not_found',
  InfoReceived: 'info_received',
  InTransit: 'in_transit',
  OutForDelivery: 'out_for_delivery',
  AvailableForPickup: 'awaiting_pickup',
  DeliveryFailure: 'problem',
  Exception: 'problem',
  // No news for a long time: 17TRACK stops tracking it, the user should look.
  Expired: 'problem',
  Delivered: 'delivered',
};

/** Normalized status of a 17TRACK main status. */
export const fromSeventeenTrack = (status) => SEVENTEEN_TRACK[status] ?? 'in_transit';

// --- DHL Shipment Tracking - Unified -----------------------------------------
// `statusCode` is one of pre-transit, transit, delivered, failure, unknown:
// "out for delivery" and "ready for pickup" are only in the text, in the
// language asked (English or German, mostly). Patterns of the wordings seen
// on DHL Paket, Express and Deutsche Post.
const OUT_FOR_DELIVERY =
  /out for delivery|on (its|the) way to the recipient|loaded onto the delivery vehicle|with (a |the )?(delivery )?courier for delivery|in Zustellung|Zustellfahrzeug|Zusteller|wird (heute )?zugestellt|en cours de livraison|en reparto/i;
const AWAITING_PICKUP =
  /ready for (pick-?up|collection)|available for (pick-?up|collection)|can be (picked up|collected)|abholbereit|zur Abholung|liegt .*(Filiale|Packstation|Paketshop).*bereit|bereit zur Abholung|disponible (en|au) |à retirer|listo para (recoger|retirar)/i;

/** Normalized status of a DHL status object (`shipments[0].status`). */
export function fromDhl(status) {
  const code = typeof status?.statusCode === 'string' ? status.statusCode.toLowerCase() : '';
  const text = `${status?.status ?? ''} ${status?.description ?? ''}`;
  if (code === 'delivered') {
    return 'delivered';
  }
  if (code === 'pre-transit') {
    return 'info_received';
  }
  if (code === 'transit' || code === 'failure' || code === 'unknown' || code === '') {
    if (AWAITING_PICKUP.test(text)) {
      return 'awaiting_pickup';
    }
    if (code === 'failure') {
      return 'problem';
    }
    if (OUT_FOR_DELIVERY.test(text)) {
      return 'out_for_delivery';
    }
    return code === 'transit' ? 'in_transit' : text.trim() ? 'in_transit' : 'not_found';
  }
  return 'in_transit';
}
