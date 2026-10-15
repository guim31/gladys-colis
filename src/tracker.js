// -----------------------------------------------------------------------------
// The tracker: the list of parcels, their reading from the sources, the device
// states, the scene triggers and the answers of the actions.
//
// Sources, by order of preference:
//   1. DHL "Shipment Tracking - Unified", official and free, for the numbers
//      shaped like DHL's (and for a parcel 17TRACK says DHL carries);
//   2. 17TRACK for everything else: it detects the carrier from the number.
// Each source is used only when its key is in the configuration.
//
// Pace: the container ticks every minute and reads only the parcels due, at an
// interval that follows the status (READ_INTERVALS): every 15 minutes out for
// delivery, every hour in transit, never once delivered. DHL: 240 requests a
// day at most (the free plan allows 250), one every 5 seconds, and the
// interval stretches when many DHL parcels share that allowance. 17TRACK: the
// readings are free and batched (40 numbers per request); only the
// registration of a new number spends quota, once per parcel.
// The devices are published with should_poll: false (the 5.2 core never polls
// a device created without should_poll, GladysAssistant/Gladys#3198): this
// timer is the only scheduler, onPoll only runs a cycle.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { buildDevice, deviceIds, EMPTY, MAX_PARCELS } from './device.js';
import * as dhl from './dhl.js';
import { cleanText, ERROR_KINDS, SourceError } from './errors.js';
import { extractNumber, looksLikeDhl, normalizeNumber } from './numbers.js';
import * as seventeen from './seventeentrack.js';
import { DISPLAY_ORDER, FINAL_STATUSES, STATUSES, TRIGGERS } from './status.js';
import { CONNECTION, ERRORS, MESSAGES, PHRASES, pick, SENTENCES, STATUS_LABELS } from './texts.js';

const logger = createLogger({ name: 'colis' });

export const WIDGET_KEY = 'parcels';
export const TICK_MS = 60_000;
export const HEARTBEAT_MS = 12 * 3_600_000;
export const QUOTA_PAUSE_MS = 3_600_000;
export const UNAVAILABLE_PAUSE_MS = 10 * 60_000;
export const DHL_DAILY_BUDGET = 240;
// Requests a day the interval is stretched to fit, below the budget: the
// forced readings and the new parcels keep some room.
export const DHL_SPREAD_BUDGET = 200;
export const DHL_SPACING_MS = 5_000;
export const SEVENTEEN_SPACING_MS = 400;
// A number no source knows after this many days is archived.
export const NOT_FOUND_EXPIRY_DAYS = 30;
// A number whose carrier 17TRACK could not detect is registered again after.
export const REGISTER_RETRY_MS = 24 * 3_600_000;
export const MAX_NAME = 60;
export const MAX_EVENTS = 15;
export const MAX_ARCHIVE = 50;
export const MAX_SUMMARY = 250;
// Read by the "Read the parcels now" action when no parcel is on the way, to
// tell a valid DHL key (404 on this number) from a refused one (401).
export const DHL_CHECK_NUMBER = '0000000000';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// Minutes between two readings of a parcel, by status (null: never again).
export const READ_INTERVALS = {
  pending: 0,
  not_found: 2 * HOUR,
  info_received: 3 * HOUR,
  in_transit: HOUR,
  out_for_delivery: 15 * MIN,
  awaiting_pickup: 2 * HOUR,
  problem: HOUR,
  delivered: null,
};
// Right after a 17TRACK registration the carrier is being read: look sooner.
const JUST_REGISTERED_MS = 2 * HOUR;
const JUST_REGISTERED_INTERVAL = 15 * MIN;

export const SOURCES = { DHL: 'dhl', SEVENTEEN: '17track' };
const SOURCE_NAMES = { dhl: dhl.SOURCE, '17track': seventeen.SOURCE };
const LANGS = ['en', 'fr', 'de', 'es'];
const DHL_CARRIER = /\bDHL\b|Deutsche Post/i;

/** The same message in the four languages, each rendered in its own. */
export const inAllLanguages = (render) => Object.fromEntries(LANGS.map((l) => [l, render(l)]));

/** A mistake of the user: answered in the action, not thrown as a failure. */
export class UserError extends Error {
  constructor(messages) {
    super(messages.en);
    this.name = 'UserError';
    this.messages = messages;
  }
}

const cleanName = (value) => cleanText(value, MAX_NAME);
const isDate = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value));
const finite = (value) => (Number.isFinite(value) ? value : null);
const utcDay = (time) => new Date(time).toISOString().slice(0, 10);

const restoreEvent = (event) =>
  event && typeof event.text === 'string' && event.text
    ? {
        date: isDate(event.date) ? event.date : null,
        text: cleanText(event.text),
        location: cleanText(event.location, 120),
      }
    : null;

/** A parcel read back from /data, with only the fields we know. */
export function restore(saved, number, now = Date.now()) {
  const events = (Array.isArray(saved.events) ? saved.events : [])
    .map(restoreEvent)
    .filter(Boolean);
  return {
    number,
    name: cleanName(saved.name) || number,
    addedAt: finite(saved.addedAt) ?? now,
    status: STATUSES.includes(saved.status) ? saved.status : 'pending',
    source: Object.values(SOURCES).includes(saved.source) ? saved.source : null,
    carrier: cleanText(saved.carrier, 60) || null,
    detail: cleanText(saved.detail, 60),
    registered: saved.registered === true,
    registeredAt: finite(saved.registeredAt),
    registerFailedAt: finite(saved.registerFailedAt),
    dhlTried: saved.dhlTried === true,
    checkedAt: finite(saved.checkedAt),
    deliveredAt: finite(saved.deliveredAt),
    events: events.slice(0, MAX_EVENTS),
    lastEvent: restoreEvent(saved.lastEvent) ?? events[0] ?? null,
    estimatedDate: isDate(saved.estimatedDate) ? saved.estimatedDate : null,
    url: typeof saved.url === 'string' && saved.url.startsWith('https://') ? saved.url : null,
  };
}

const newSourceState = () => ({ keyRejected: false, pauseUntil: 0, problem: null });

export class Tracker {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake)
   * @param {object} options.store see src/store.js
   * @param {Function} [options.fetch] test seam for the HTTP clients
   * @param {Function} [options.now]
   * @param {Function} [options.sleep]
   * @param {boolean} [options.timers] false: the tests run the cycles
   */
  constructor({
    gladys,
    store,
    fetch = globalThis.fetch,
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    timers = true,
  }) {
    Object.assign(this, { gladys, store, fetch, now, sleep, timers });
    this.config = normalizeConfig();
    this.parcels = new Map();
    this.archive = [];
    this.dhlUsage = { day: '', count: 0 };
    this.lastCall = { dhl: 0, '17track': 0 };
    this.sources = { dhl: newSourceState(), '17track': newSourceState() };
    this.timer = null;
    this.cycle = null;
    this.running = Promise.resolve();
    // Failures logged once, then once at recovery.
    this.cycleFailed = false;
    this.publishFailed = false;
    this.connection = null;
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    this.config = config;
    const saved = await this.store.load();
    const now = this.now();
    for (const entry of Array.isArray(saved.parcels) ? saved.parcels : []) {
      const number = normalizeNumber(entry?.number);
      if (number && !this.parcels.has(number) && this.parcels.size < MAX_PARCELS) {
        this.parcels.set(number, restore(entry, number, now));
      }
    }
    this.archive = (Array.isArray(saved.archive) ? saved.archive : [])
      .filter((entry) => normalizeNumber(entry?.number))
      .slice(0, MAX_ARCHIVE);
    if (saved.dhlUsage && typeof saved.dhlUsage.day === 'string') {
      this.dhlUsage = { day: saved.dhlUsage.day, count: finite(saved.dhlUsage.count) ?? 0 };
    }
    logger.info(`Started, ${this.parcels.size} parcel(s) tracked`);
    await this.publishDevices();
    await this.updateConnection();
    if (this.timers) {
      this.timer = setInterval(() => this.runCycle(), TICK_MS);
    }
    this.running = this.runCycle();
  }

  /** Gladys restarted: publish everything again. */
  async resync(config) {
    this.config = config;
    this.connection = null;
    await this.publishDevices();
    this.gladys.forgetPublishedStates();
    await this.updateConnection();
    await this.publishStates();
    this.refreshWidget();
  }

  async reconfigure(config) {
    // A cycle in flight reads with the old keys: let it end, its answers about
    // the old keys are dropped (see `keyOf`), then read with the new ones.
    await this.cycle?.catch(() => {});
    const before = this.config;
    this.config = config;
    for (const [source, field] of [
      [SOURCES.DHL, 'dhlKey'],
      [SOURCES.SEVENTEEN, 'seventeenTrackKey'],
    ]) {
      if (before[field] !== config[field]) {
        this.sources[source] = newSourceState();
        this.connection = null;
        const name = SOURCE_NAMES[source];
        logger.info(config[field] ? `${name} key changed` : `${name} key removed`);
      }
    }
    if (before.language !== config.language) {
      await this.publishDevices();
      this.gladys.forgetPublishedStates();
    }
    this.refreshWidget();
    await this.updateConnection();
    await this.runCycle();
  }

  async stop() {
    clearInterval(this.timer);
    this.timer = null;
    await this.cycle?.catch(() => {});
    await this.store.flush();
  }

  // --- Sources -----------------------------------------------------------------

  keyOf(source) {
    return source === SOURCES.DHL ? this.config.dhlKey : this.config.seventeenTrackKey;
  }

  usable(source, now = this.now()) {
    const state = this.sources[source];
    return Boolean(this.keyOf(source)) && !state.keyRejected && now >= state.pauseUntil;
  }

  dhlUsedToday(now = this.now()) {
    return this.dhlUsage.day === utcDay(now) ? this.dhlUsage.count : 0;
  }

  dhlBudgetLeft(now = this.now()) {
    return this.dhlUsedToday(now) < DHL_DAILY_BUDGET;
  }

  /** Waits for the spacing a source asks, counts DHL's daily requests. */
  async pace(source) {
    const spacing = source === SOURCES.DHL ? DHL_SPACING_MS : SEVENTEEN_SPACING_MS;
    const wait = this.lastCall[source] + spacing - this.now();
    if (wait > 0) {
      await this.sleep(wait);
    }
    const now = this.now();
    this.lastCall[source] = now;
    if (source === SOURCES.DHL) {
      this.dhlUsage = { day: utcDay(now), count: this.dhlUsedToday(now) + 1 };
    }
  }

  async sourceAnswered(source) {
    const state = this.sources[source];
    if (state.problem) {
      logger.info(`${SOURCE_NAMES[source]} answers again`);
      state.problem = null;
      this.refreshWidget();
    }
    await this.setConnection(true);
  }

  async sourceFailed(source, err) {
    const state = this.sources[source];
    const now = this.now();
    if (err.kind === ERROR_KINDS.INVALID_KEY) {
      state.keyRejected = true;
      state.problem = 'invalid_key';
      this.refreshWidget();
      logger.warn(`${err.message}: no ${SOURCE_NAMES[source]} reading until the key changes`);
      await this.updateConnection();
      return;
    }
    const quota = err.kind === ERROR_KINDS.QUOTA;
    state.pauseUntil = now + (quota ? (err.retryAfterMs ?? QUOTA_PAUSE_MS) : UNAVAILABLE_PAUSE_MS);
    const kind = quota ? 'quota' : 'unavailable';
    if (state.problem === kind) {
      logger.debug(`${err.message}, readings paused again`);
      return;
    }
    state.problem = kind;
    this.refreshWidget();
    const minutes = Math.round((state.pauseUntil - now) / MIN);
    logger.warn(`${err.message}: readings paused for ${minutes} min`);
  }

  /** The DHL allowance of the day is spent: logged once a day. */
  dhlBudgetReached() {
    const state = this.sources.dhl;
    if (state.problem !== 'budget') {
      state.problem = 'budget';
      this.refreshWidget();
      logger.warn(`DHL: ${DHL_DAILY_BUDGET} requests used today, DHL readings resume tomorrow`);
    }
  }

  // --- Reading ---------------------------------------------------------------

  isDone(parcel) {
    return FINAL_STATUSES.has(parcel.status);
  }

  /** Time between two readings of a parcel; null when it is never read again. */
  intervalOf(parcel, now = this.now()) {
    let interval = READ_INTERVALS[parcel.status] ?? HOUR;
    if (interval === null) {
      return null;
    }
    if (
      parcel.source === SOURCES.SEVENTEEN &&
      parcel.status === 'not_found' &&
      parcel.registeredAt !== null &&
      now - parcel.registeredAt < JUST_REGISTERED_MS
    ) {
      interval = JUST_REGISTERED_INTERVAL;
    }
    if (parcel.source === SOURCES.DHL && interval > 0) {
      const dhlParcels = this.activeParcels().filter((p) => p.source === SOURCES.DHL).length;
      interval = Math.max(interval, Math.ceil((DAY * dhlParcels) / DHL_SPREAD_BUDGET));
    }
    return interval;
  }

  isDue(parcel, now, force) {
    if (this.isDone(parcel)) {
      return false;
    }
    if (force || parcel.checkedAt === null) {
      return true;
    }
    const interval = this.intervalOf(parcel, now);
    // Half a tick of slack: the timer never fires exactly on time.
    return interval !== null && now - parcel.checkedAt >= interval - TICK_MS / 2;
  }

  /** One cycle; a cycle already running is shared, never doubled. */
  runCycle(options = {}) {
    if (!this.cycle) {
      this.cycle = this.cycleBody(options).finally(() => {
        this.cycle = null;
      });
    }
    return this.cycle;
  }

  /** Waits for the cycle in flight, then runs one with these options. */
  async runCycleNow(options) {
    await this.cycle?.catch(() => {});
    return this.runCycle(options);
  }

  async cycleBody({ force = false, only = null } = {}) {
    try {
      const now = this.now();
      let changed = this.prune(now);
      const due = [...this.parcels.values()].filter(
        (parcel) => (only === null || only.has(parcel.number)) && this.isDue(parcel, now, force),
      );
      const outcome = { read: 0, changed: false };
      if (due.length > 0) {
        await this.readParcels(due, outcome);
      }
      changed = changed || outcome.changed;
      logger.debug(`Reading cycle: ${outcome.read} parcel(s) read, ${this.parcels.size} tracked`);
      this.save();
      if (changed) {
        this.refreshWidget();
      }
      await this.publishStates();
      if (this.cycleFailed) {
        this.cycleFailed = false;
        logger.info('Reading cycles work again');
      }
      return outcome.read;
    } catch (err) {
      if (this.cycleFailed) {
        logger.debug(`Reading cycle failed again: ${err.message}`);
      } else {
        this.cycleFailed = true;
        logger.error('Reading cycle failed', err);
      }
      return 0;
    }
  }

  async readParcels(due, outcome) {
    const forSeventeen = [];
    for (const parcel of due) {
      if (this.parcels.get(parcel.number) !== parcel) {
        continue; // removed meanwhile
      }
      const wantsDhl =
        parcel.source === SOURCES.DHL ||
        (parcel.source === null && !parcel.dhlTried && looksLikeDhl(parcel.number));
      if (wantsDhl && this.usable(SOURCES.DHL)) {
        if (!this.dhlBudgetLeft()) {
          this.dhlBudgetReached();
        } else if ((await this.readDhl(parcel, outcome)) !== false) {
          continue; // read by DHL, or DHL failed: the parcel waits
        }
      }
      if (parcel.source === SOURCES.DHL && this.keyOf(SOURCES.DHL)) {
        continue; // a DHL parcel waits for DHL (allowance, pause, refused key)
      }
      forSeventeen.push(parcel);
    }
    if (forSeventeen.length > 0) {
      await this.readSeventeen(forSeventeen, outcome);
    }
  }

  /**
   * Reads one parcel from DHL. Resolves true when DHL knows it, false when DHL
   * does not (17TRACK may), null when DHL could not answer.
   */
  async readDhl(parcel, outcome) {
    const apiKey = this.config.dhlKey;
    await this.pace(SOURCES.DHL);
    try {
      const shipment = await dhl.fetchShipment(parcel.number, {
        apiKey,
        language: this.config.language,
        fetch: this.fetch,
      });
      if (apiKey !== this.config.dhlKey || this.parcels.get(parcel.number) !== parcel) {
        return null;
      }
      await this.sourceAnswered(SOURCES.DHL);
      parcel.source = SOURCES.DHL;
      parcel.dhlTried = true;
      outcome.read += 1;
      outcome.changed = (await this.apply(parcel, shipment)) || outcome.changed;
      return true;
    } catch (err) {
      if (apiKey !== this.config.dhlKey) {
        return null;
      }
      if (err instanceof dhl.NotFoundError) {
        await this.sourceAnswered(SOURCES.DHL);
        parcel.dhlTried = true;
        if (parcel.source === SOURCES.DHL) {
          // A DHL parcel DHL no longer finds: 17TRACK takes over, if any.
          parcel.source = null;
        }
        logger.debug(`${parcel.name}: unknown to DHL`);
        return false;
      }
      if (!(err instanceof SourceError)) {
        throw err;
      }
      await this.sourceFailed(SOURCES.DHL, err);
      return null;
    }
  }

  /** Registers the new numbers on 17TRACK, then reads them all in batches. */
  async readSeventeen(parcels, outcome) {
    if (!this.usable(SOURCES.SEVENTEEN)) {
      return;
    }
    const apiKey = this.config.seventeenTrackKey;
    const options = { apiKey, fetch: this.fetch };
    const now = this.now();
    try {
      const toRegister = parcels.filter(
        (parcel) =>
          !parcel.registered &&
          (parcel.registerFailedAt === null || now - parcel.registerFailedAt >= REGISTER_RETRY_MS),
      );
      for (let i = 0; i < toRegister.length; i += seventeen.MAX_BATCH) {
        const batch = toRegister.slice(i, i + seventeen.MAX_BATCH);
        await this.pace(SOURCES.SEVENTEEN);
        const { accepted, rejected } = await seventeen.register(
          batch.map((parcel) => parcel.number),
          options,
        );
        if (apiKey !== this.config.seventeenTrackKey) {
          return;
        }
        for (const parcel of batch) {
          const code = rejected.get(parcel.number);
          if (accepted.has(parcel.number) || code === seventeen.CODES.ALREADY_REGISTERED) {
            Object.assign(parcel, {
              registered: true,
              registeredAt: this.now(),
              registerFailedAt: null,
              source: SOURCES.SEVENTEEN,
            });
            if (accepted.has(parcel.number)) {
              logger.debug(`${parcel.name}: registered on 17TRACK`);
            }
          } else if (seventeen.QUOTA_CODES.has(code)) {
            throw new SourceError(seventeen.SOURCE, ERROR_KINDS.QUOTA, {
              detail: `registration refused (code ${code})`,
            });
          } else if (code !== undefined) {
            // Carrier not detected, or a number 17TRACK refuses: try again later.
            parcel.registerFailedAt = this.now();
            parcel.checkedAt = this.now();
            outcome.changed = this.setStatus(parcel, 'not_found') || outcome.changed;
            logger.debug(`${parcel.name}: 17TRACK registration refused (code ${code})`);
          }
        }
      }
      const registered = parcels.filter(
        (parcel) => parcel.registered && this.parcels.get(parcel.number) === parcel,
      );
      for (let i = 0; i < registered.length; i += seventeen.MAX_BATCH) {
        const batch = registered.slice(i, i + seventeen.MAX_BATCH);
        await this.pace(SOURCES.SEVENTEEN);
        const { accepted, rejected } = await seventeen.getTrackInfo(
          batch.map((parcel) => parcel.number),
          options,
        );
        if (apiKey !== this.config.seventeenTrackKey) {
          return;
        }
        await this.sourceAnswered(SOURCES.SEVENTEEN);
        for (const parcel of batch) {
          if (this.parcels.get(parcel.number) !== parcel) {
            continue; // removed while 17TRACK was answering
          }
          parcel.checkedAt = this.now();
          const shipment = accepted.get(parcel.number);
          if (shipment) {
            outcome.read += 1;
            outcome.changed = (await this.apply(parcel, shipment)) || outcome.changed;
            await this.preferDhl(parcel, outcome);
          } else if (rejected.get(parcel.number) === seventeen.CODES.NOT_REGISTERED) {
            parcel.registered = false; // registered again at its next reading
          } else {
            outcome.changed = this.setStatus(parcel, 'not_found') || outcome.changed;
          }
        }
      }
    } catch (err) {
      if (!(err instanceof SourceError)) {
        throw err;
      }
      if (apiKey === this.config.seventeenTrackKey) {
        await this.sourceFailed(SOURCES.SEVENTEEN, err);
      }
    }
  }

  /** A parcel 17TRACK says DHL carries is read from DHL's own API, once tried. */
  async preferDhl(parcel, outcome) {
    if (
      parcel.dhlTried ||
      !parcel.carrier ||
      !DHL_CARRIER.test(parcel.carrier) ||
      this.isDone(parcel) ||
      !this.usable(SOURCES.DHL)
    ) {
      return;
    }
    const found = await this.readDhl(parcel, outcome);
    if (found) {
      logger.debug(`${parcel.name}: read from DHL from now on`);
    }
  }

  /** Changes the status alone (no news from the carrier); true when it did. */
  setStatus(parcel, status) {
    if (parcel.status === status || (status === 'not_found' && parcel.lastEvent)) {
      return false;
    }
    parcel.status = status;
    return true;
  }

  /** Applies a shipment read from a source; true when the parcel changed. */
  async apply(parcel, shipment) {
    const now = this.now();
    const before = parcel.status;
    // A source that lost the events of a parcel it knew does not erase them.
    const status =
      shipment.status === 'not_found' && parcel.lastEvent ? parcel.status : shipment.status;
    const lastEvent = shipment.lastEvent ?? parcel.lastEvent;
    const carrierChanged = Boolean(shipment.carrier) && shipment.carrier !== parcel.carrier;
    const changed =
      status !== before ||
      lastEvent?.text !== parcel.lastEvent?.text ||
      lastEvent?.date !== parcel.lastEvent?.date ||
      shipment.estimatedDate !== parcel.estimatedDate ||
      carrierChanged;
    Object.assign(parcel, {
      status,
      checkedAt: now,
      detail: shipment.detail || parcel.detail,
      carrier: shipment.carrier ?? parcel.carrier,
      events: shipment.events.length > 0 ? shipment.events.slice(0, MAX_EVENTS) : parcel.events,
      lastEvent,
      estimatedDate: shipment.estimatedDate ?? (status === before ? parcel.estimatedDate : null),
      url: shipment.url ?? parcel.url,
    });
    if (FINAL_STATUSES.has(status) && parcel.deliveredAt === null) {
      // The days kept count from the delivery itself, when the carrier dates it.
      const delivered = Date.parse(lastEvent?.date ?? '');
      parcel.deliveredAt = Number.isFinite(delivered) ? Math.min(delivered, now) : now;
    }
    if (carrierChanged) {
      // The carrier is the model of the device in the Discover tab.
      await this.publishDevices();
    }
    if (changed) {
      logger.debug(`${parcel.name}: ${before} -> ${status} (${shipment.source})`);
    }
    const trigger = TRIGGERS[status];
    const previous = TRIGGERS[before];
    // A parcel first seen delivered (never seen on the way) is not news.
    const addedDelivered =
      (before === 'pending' || before === 'not_found') && FINAL_STATUSES.has(status);
    if (
      trigger &&
      !addedDelivered &&
      (trigger.key !== previous?.key || trigger.reason !== previous?.reason)
    ) {
      await this.fire(trigger, parcel);
    }
    return changed;
  }

  async fire(trigger, parcel) {
    const language = this.config.language;
    const data = {
      parcel: deviceIds(this.gladys, parcel.number).device,
      name: parcel.name,
      number: parcel.number,
      carrier: parcel.carrier ?? '',
      status: pick(STATUS_LABELS, language)[parcel.status],
      event: parcel.lastEvent?.text ?? '',
      location: parcel.lastEvent?.location ?? '',
      url: this.urlOf(parcel),
    };
    if (trigger.reason) {
      data.reason = trigger.reason;
    }
    try {
      await this.gladys.publishSceneEvent(trigger.key, data);
      logger.debug(`Scene trigger ${trigger.key} fired for ${parcel.name}`);
    } catch (err) {
      logger.warn(`Scene trigger ${trigger.key} refused: ${err.message}`);
    }
  }

  urlOf(parcel) {
    return parcel.url ?? `${seventeen.TRACKING_PAGE}${encodeURIComponent(parcel.number)}`;
  }

  /** Archives the parcels delivered long enough ago, and the numbers never found. */
  prune(now) {
    let changed = false;
    for (const parcel of [...this.parcels.values()]) {
      const keptDays = parcel.deliveredAt === null ? null : (now - parcel.deliveredAt) / DAY;
      const unknownDays =
        (parcel.status === 'not_found' || parcel.status === 'pending') && !parcel.lastEvent
          ? (now - parcel.addedAt) / DAY
          : null;
      if (keptDays !== null && keptDays >= this.config.keepDeliveredDays) {
        logger.info(`${parcel.name} archived: delivered ${Math.floor(keptDays)} days ago`);
      } else if (unknownDays !== null && unknownDays >= NOT_FOUND_EXPIRY_DAYS) {
        logger.info(`${parcel.name} archived: still unknown after ${NOT_FOUND_EXPIRY_DAYS} days`);
      } else {
        continue;
      }
      this.toArchive(parcel, now);
      changed = true;
    }
    if (changed) {
      // Fire and forget: the archived parcels leave the Discover tab.
      this.publishDevices();
    }
    return changed;
  }

  toArchive(parcel, now) {
    this.parcels.delete(parcel.number);
    this.archive = [
      { ...parcel, archivedAt: now },
      ...this.archive.filter((entry) => entry.number !== parcel.number),
    ].slice(0, MAX_ARCHIVE);
  }

  // --- Gladys ----------------------------------------------------------------

  async publishDevices() {
    const devices = this.sortedParcels().map((parcel) =>
      buildDevice(this.gladys, parcel, this.config.language),
    );
    try {
      await this.gladys.publishDiscoveredDevices(devices);
    } catch (err) {
      logger.warn(`Publishing the devices failed: ${err.message}`);
    }
  }

  createdDevices() {
    return new Set((this.gladys.devices ?? []).map((device) => device.external_id));
  }

  formatDate(iso, withTime) {
    const date = new Date(iso ?? '');
    if (Number.isNaN(date.getTime())) {
      return EMPTY;
    }
    const options = withTime
      ? { dateStyle: 'medium', timeStyle: 'short' }
      : { weekday: 'long', day: 'numeric', month: 'long' };
    return new Intl.DateTimeFormat(this.config.language, options).format(date);
  }

  /** The six states of a parcel's device. */
  statesOf(parcel) {
    const ids = deviceIds(this.gladys, parcel.number);
    const values = {
      status: pick(STATUS_LABELS, this.config.language)[parcel.status],
      event: parcel.lastEvent?.text || EMPTY,
      location: parcel.lastEvent?.location || EMPTY,
      event_date: this.formatDate(parcel.lastEvent?.date, true),
      carrier: parcel.carrier || EMPTY,
      eta: this.isDone(parcel) ? EMPTY : this.formatDate(parcel.estimatedDate, false),
    };
    return Object.entries(values).map(([key, text]) => ({
      device_feature_external_id: ids[key],
      text: text.slice(0, 250),
    }));
  }

  async publishStates() {
    const created = this.createdDevices();
    const states = [...this.parcels.values()]
      .filter((parcel) => created.has(deviceIds(this.gladys, parcel.number).device))
      .flatMap((parcel) => this.statesOf(parcel));
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
      if (this.publishFailed) {
        this.publishFailed = false;
        logger.info('Publishing the states works again');
      }
    } catch (err) {
      if (this.publishFailed) {
        logger.debug(`Publishing the states failed again: ${err.message}`);
      } else {
        this.publishFailed = true;
        logger.warn(`Publishing the states failed: ${err.message}`);
      }
    }
  }

  async onDeviceCreated(device) {
    const parcel = [...this.parcels.values()].find(
      (entry) => deviceIds(this.gladys, entry.number).device === device?.external_id,
    );
    if (!parcel) {
      return;
    }
    // Gladys dropped the states sent before the device existed: all again.
    this.gladys.forgetPublishedStates(device.external_id);
    await this.publishStates();
    this.refreshWidget();
  }

  refreshWidget() {
    Promise.resolve()
      .then(() => this.gladys.requestWidgetRefresh(WIDGET_KEY))
      .catch(() => {});
  }

  /** Connection badge of the Configuration screen, sent only when it changes. */
  async setConnection(connected, message) {
    const signature = `${connected}:${message?.en ?? ''}`;
    if (this.connection === signature) {
      return;
    }
    this.connection = signature;
    try {
      await this.gladys.setConnectionStatus(connected, message);
    } catch (err) {
      this.connection = null;
      logger.debug(`Connection status refused: ${err.message}`);
    }
  }

  async updateConnection() {
    const configured = Object.values(SOURCES).filter((source) => this.keyOf(source));
    if (configured.length === 0) {
      await this.setConnection(false, CONNECTION.noKey);
    } else if (configured.every((source) => this.sources[source].keyRejected)) {
      await this.setConnection(false, CONNECTION.keysRefused);
    } else if (this.connection?.startsWith('false')) {
      // A refused key was replaced: wait for an answer before saying "connected".
      this.connection = null;
    }
  }

  save() {
    return this.store.save({
      parcels: [...this.parcels.values()].map((parcel) => ({ ...parcel })),
      archive: this.archive,
      dhlUsage: this.dhlUsage,
    });
  }

  /** What keeps each source from reading, for the widget and the actions. */
  problems() {
    return Object.values(SOURCES)
      .filter((source) => this.keyOf(source) && this.sources[source].problem)
      .map((source) => ({ source: SOURCE_NAMES[source], kind: this.sources[source].problem }));
  }

  // --- Views -------------------------------------------------------------------

  /** Parcels in display order: what needs the user first, then the most recent. */
  sortedParcels() {
    const rank = (parcel) => {
      const index = DISPLAY_ORDER.indexOf(parcel.status);
      return index === -1 ? DISPLAY_ORDER.length : index;
    };
    return [...this.parcels.values()].sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (b.lastEvent?.date ?? '').localeCompare(a.lastEvent?.date ?? '') ||
        b.addedAt - a.addedAt,
    );
  }

  activeParcels() {
    return this.sortedParcels().filter((parcel) => !this.isDone(parcel));
  }

  counts() {
    const active = this.activeParcels();
    return {
      in_progress: active.length,
      out_for_delivery: active.filter((p) => p.status === 'out_for_delivery').length,
      awaiting_pickup: active.filter((p) => p.status === 'awaiting_pickup').length,
      problems: active.filter((p) => p.status === 'problem').length,
    };
  }

  /** "You have 2 parcels on the way: Shoes, out for delivery today; Book, in transit." */
  sentence(language = this.config.language) {
    const texts = pick(SENTENCES, language);
    const phrases = pick(PHRASES, language);
    const active = this.activeParcels();
    if (active.length === 0) {
      return texts.none;
    }
    const items = active.map((parcel) =>
      texts.item({ name: parcel.name, phrase: phrases[parcel.status] ?? phrases.in_transit }),
    );
    const text = `${texts.intro({ count: active.length })}${items.join(texts.separator)}${texts.end}`;
    return text.length <= MAX_SUMMARY * 4 ? text : `${text.slice(0, MAX_SUMMARY * 4 - 1)}…`;
  }

  // --- Actions -----------------------------------------------------------------

  /**
   * Adds a parcel, or renames the one with this number, then reads it once.
   * @returns {Promise<{ parcel: object, isNew: boolean }>}
   * @throws {UserError}
   */
  async track(rawNumber, rawName, { extract = false } = {}) {
    const number = extract ? extractNumber(rawNumber) : normalizeNumber(rawNumber);
    if (!number) {
      const value = cleanText(String(rawNumber ?? ''), 40);
      throw new UserError(inAllLanguages((l) => MESSAGES[l].invalidNumber({ value })));
    }
    const name = cleanName(rawName);
    const existing = this.parcels.get(number);
    if (existing) {
      if (name && name !== existing.name) {
        existing.name = name;
        logger.info(`Parcel ${number} renamed ${name}`);
        await this.afterChange();
      }
      return { parcel: existing, isNew: false };
    }
    if (this.parcels.size >= MAX_PARCELS) {
      throw new UserError(inAllLanguages((l) => MESSAGES[l].tooMany({ max: MAX_PARCELS })));
    }
    const now = this.now();
    const archived = this.archive.find((entry) => entry.number === number);
    // An archived parcel comes back with what the sources told about it (its
    // 17TRACK registration above all: no quota spent again).
    const parcel = restore(
      archived
        ? {
            ...archived,
            name: name || archived.name,
            addedAt: now,
            checkedAt: null,
            deliveredAt: archived.deliveredAt === null ? null : now,
          }
        : { name: name || number, addedAt: now },
      number,
      now,
    );
    this.archive = this.archive.filter((entry) => entry.number !== number);
    this.parcels.set(number, parcel);
    logger.info(`Parcel ${parcel.name} added`);
    await this.publishDevices();
    await this.runCycleNow({ only: new Set([number]) });
    await this.afterChange();
    return { parcel, isNew: true };
  }

  /**
   * Stops tracking a parcel, by number or by name.
   * @returns {Promise<object|null>} the parcel removed, null if none matched
   */
  async untrack(query) {
    const text = typeof query === 'string' ? query.trim() : '';
    if (!text) {
      return null;
    }
    const number = normalizeNumber(text);
    const parcel =
      (number && this.parcels.get(number)) ||
      [...this.parcels.values()].find((p) => p.name.toLowerCase() === text.toLowerCase());
    if (!parcel) {
      return null;
    }
    await this.cycle?.catch(() => {});
    this.parcels.delete(parcel.number);
    logger.info(`Parcel ${parcel.name} removed`);
    if (parcel.registered && this.usable(SOURCES.SEVENTEEN)) {
      // Leaves the 17TRACK account too (free). Best effort.
      try {
        await this.pace(SOURCES.SEVENTEEN);
        await seventeen.deleteTrack([parcel.number], {
          apiKey: this.config.seventeenTrackKey,
          fetch: this.fetch,
        });
      } catch (err) {
        logger.debug(`17TRACK kept ${parcel.name}: ${err.message}`);
      }
    }
    await this.publishDevices();
    await this.afterChange();
    return parcel;
  }

  async afterChange() {
    this.save();
    this.refreshWidget();
    await this.publishStates();
  }

  /** Configuration action "Track a parcel". */
  async trackAction(fields = {}) {
    const { parcel, isNew } = await this.track(fields.number, fields.name);
    if (!isNew) {
      if (cleanName(fields.name)) {
        return inAllLanguages((l) => MESSAGES[l].renamed({ name: parcel.name }));
      }
      return inAllLanguages((l) =>
        MESSAGES[l].added({ name: parcel.name, status: STATUS_LABELS[l][parcel.status] }),
      );
    }
    const hasKey = this.keyOf(SOURCES.DHL) || this.keyOf(SOURCES.SEVENTEEN);
    const noSource =
      hasKey && !this.keyOf(SOURCES.SEVENTEEN) && parcel.source === null && parcel.dhlTried;
    return inAllLanguages((l) => {
      const parts = [
        MESSAGES[l].added({ name: parcel.name, status: STATUS_LABELS[l][parcel.status] }),
      ];
      if (!hasKey) {
        parts.push(MESSAGES[l].noKey);
      } else if (noSource) {
        parts.push(MESSAGES[l].noSource);
      }
      parts.push(MESSAGES[l].addedCreate);
      return parts.join(' ');
    });
  }

  /** Configuration action "Stop tracking a parcel". */
  async untrackAction(fields = {}) {
    const parcel = await this.untrack(fields.parcel);
    if (!parcel) {
      const value = cleanText(String(fields.parcel ?? ''), 40);
      throw new UserError(inAllLanguages((l) => MESSAGES[l].notTracked({ value })));
    }
    return inAllLanguages((l) => MESSAGES[l].removed({ name: parcel.name }));
  }

  /** Configuration action "Read the parcels now": ignores the intervals, once. */
  async refreshNow() {
    if (!this.keyOf(SOURCES.DHL) && !this.keyOf(SOURCES.SEVENTEEN)) {
      throw new UserError(CONNECTION.noKey);
    }
    // The user asks: one more try, even after a refusal or a pause.
    await this.cycle?.catch(() => {});
    for (const source of Object.values(SOURCES)) {
      const state = this.sources[source];
      state.keyRejected = false;
      state.pauseUntil = 0;
    }
    const active = this.activeParcels().length;
    const count = active > 0 ? await this.runCycle({ force: true }) : 0;
    if (active === 0) {
      await this.checkDhlKey();
    }
    const quota = await this.seventeenQuota();
    const lines = (l) => {
      const parts = [
        active > 0
          ? MESSAGES[l].refreshed({ count })
          : this.problems().length > 0
            ? SENTENCES[l].none
            : MESSAGES[l].nothingToRefresh,
      ];
      for (const problem of this.problems()) {
        parts.push(ERRORS[l][problem.kind]({ source: problem.source }));
      }
      if (quota) {
        parts.push(MESSAGES[l].quota(quota));
      }
      if (this.keyOf(SOURCES.DHL)) {
        parts.push(MESSAGES[l].dhlUsage({ used: this.dhlUsedToday(), max: DHL_DAILY_BUDGET }));
      }
      return parts.join(' ');
    };
    if (count === 0 && this.problems().some((p) => p.kind === 'invalid_key')) {
      throw new UserError(inAllLanguages(lines));
    }
    return inAllLanguages(lines);
  }

  /** Reads a number nobody tracks, only to learn whether the DHL key works. */
  async checkDhlKey() {
    if (!this.usable(SOURCES.DHL) || !this.dhlBudgetLeft()) {
      return;
    }
    const apiKey = this.config.dhlKey;
    try {
      await this.pace(SOURCES.DHL);
      await dhl.fetchShipment(DHL_CHECK_NUMBER, { apiKey, fetch: this.fetch });
      await this.sourceAnswered(SOURCES.DHL);
    } catch (err) {
      if (apiKey !== this.config.dhlKey) {
        return;
      }
      if (err instanceof dhl.NotFoundError) {
        await this.sourceAnswered(SOURCES.DHL);
      } else if (err instanceof SourceError) {
        await this.sourceFailed(SOURCES.DHL, err);
      } else {
        throw err;
      }
    }
  }

  /** The 17TRACK quota (also checks the key when no parcel is on the way). */
  async seventeenQuota() {
    if (!this.usable(SOURCES.SEVENTEEN)) {
      return null;
    }
    const apiKey = this.config.seventeenTrackKey;
    try {
      await this.pace(SOURCES.SEVENTEEN);
      const quota = await seventeen.getQuota({ apiKey, fetch: this.fetch });
      if (apiKey === this.config.seventeenTrackKey) {
        await this.sourceAnswered(SOURCES.SEVENTEEN);
      }
      return quota.remaining === null || quota.total === null
        ? null
        : { remaining: quota.remaining, total: quota.total };
    } catch (err) {
      if (!(err instanceof SourceError)) {
        throw err;
      }
      if (apiKey === this.config.seventeenTrackKey) {
        await this.sourceFailed(SOURCES.SEVENTEEN, err);
      }
      return null;
    }
  }
}
