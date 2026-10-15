// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `parcels`, "My parcels",
// a small parcel app on the dashboard.
//
// A card list of the tracked parcels, what needs the user first (out for
// delivery, to pick up, problem), then the others: name, last event (the
// carrier's own text) and its date, a status badge; a tap opens the details
// (carrier, number, expected date, the unified history) with a link to the
// tracking page. Budget: one card list of 8 parcels at most, and two captions
// at most (the parcels not shown, what keeps a source from reading).
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { ERRORS, pick, STATUS_LABELS, WIDGET_TEXT, CONNECTION } from './texts.js';
import { WIDGET_KEY } from './tracker.js';

export const MAX_ITEMS = 8;
export const TTL_SECONDS = 300;
const MAX_SUBTITLE = 60;
const MAX_HISTORY = 8;

export const BADGE_COLORS = {
  pending: WIDGET_COLORS.NEUTRAL,
  not_found: WIDGET_COLORS.NEUTRAL,
  info_received: WIDGET_COLORS.NEUTRAL,
  in_transit: WIDGET_COLORS.PRIMARY,
  out_for_delivery: WIDGET_COLORS.INFO,
  awaiting_pickup: WIDGET_COLORS.WARNING,
  problem: WIDGET_COLORS.DANGER,
  delivered: WIDGET_COLORS.SUCCESS,
};

const truncate = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

/** A date in the user's language and the time zone of Gladys (TZ). */
export function formatDate(iso, language, withTime = false) {
  const date = new Date(iso ?? '');
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const options = withTime
    ? { dateStyle: 'short', timeStyle: 'short' }
    : { weekday: 'long', day: 'numeric', month: 'long' };
  return new Intl.DateTimeFormat(language, options).format(date);
}

function description(parcel, language) {
  const carrier = parcel.carrier ? `${parcel.carrier} · ` : '';
  const lines = [`${carrier}${pick(WIDGET_TEXT.number, language)} ${parcel.number}`];
  if (parcel.status === 'delivered' && parcel.lastEvent?.date) {
    lines.push(
      `${pick(WIDGET_TEXT.delivered_on, language)} ${formatDate(parcel.lastEvent.date, language)}`,
    );
  } else if (parcel.estimatedDate && parcel.status !== 'delivered') {
    lines.push(
      `${pick(WIDGET_TEXT.expected, language)} ${formatDate(parcel.estimatedDate, language)}`,
    );
  }
  const history = parcel.events.slice(0, MAX_HISTORY);
  if (history.length > 0) {
    lines.push('', pick(WIDGET_TEXT.history, language));
    for (const event of history) {
      const when = event.date ? `${formatDate(event.date, language, true)} — ` : '';
      const where = event.location ? ` (${event.location})` : '';
      lines.push(`${when}${event.text}${where}`);
    }
  }
  return truncate(lines.join('\n'), 2000);
}

/** One card of the list. */
export function cardOf(tracker, parcel, language) {
  const labels = pick(STATUS_LABELS, language);
  const item = {
    title: truncate(parcel.name, 60),
    badge: { text: labels[parcel.status] ?? labels.in_transit, color: BADGE_COLORS[parcel.status] },
    description: description(parcel, language),
    links: [{ url: tracker.urlOf(parcel), label: pick(WIDGET_TEXT.link, language) }],
  };
  if (parcel.lastEvent?.text) {
    const where = parcel.lastEvent.location ? ` — ${parcel.lastEvent.location}` : '';
    item.subtitle = truncate(`${parcel.lastEvent.text}${where}`, MAX_SUBTITLE);
  }
  if (parcel.lastEvent?.date) {
    item.date = parcel.lastEvent.date;
  }
  return item;
}

/** What keeps the parcels from being read, if anything (one caption). */
function warning(tracker, language) {
  if (!tracker.config.dhlKey && !tracker.config.seventeenTrackKey) {
    return pick(CONNECTION.noKey, language);
  }
  return tracker
    .problems()
    .map((problem) => pick(ERRORS, language)[problem.kind]({ source: problem.source }))
    .join(' ');
}

export const WIDGETS = {
  [WIDGET_KEY]: {
    async get(tracker, { language = 'en' } = {}) {
      const parcels = tracker.sortedParcels();
      const problem = warning(tracker, language);
      const caption = problem
        ? [{ type: 'text', variant: 'caption', text: truncate(problem, 160) }]
        : [];
      if (parcels.length === 0) {
        return {
          ttl_seconds: TTL_SECONDS,
          components: [
            { type: 'text', variant: 'body', text: pick(WIDGET_TEXT.empty, language) },
            ...caption,
          ],
        };
      }
      const components = [
        {
          type: 'card-list',
          display: 'list',
          items: parcels.slice(0, MAX_ITEMS).map((parcel) => cardOf(tracker, parcel, language)),
        },
      ];
      if (parcels.length > MAX_ITEMS) {
        const text = pick(WIDGET_TEXT.more, language).replace(
          '{count}',
          parcels.length - MAX_ITEMS,
        );
        components.push({ type: 'text', variant: 'caption', text });
      }
      components.push(...caption);
      return { ttl_seconds: TTL_SECONDS, components };
    },
  },
};
