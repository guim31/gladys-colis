// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, simulated 17TRACK and DHL APIs
// (fixtures by tracking number), a manual clock, a temporary /data, and the
// integration wired on top through registerHandlers. Nothing touches the
// network.
// -----------------------------------------------------------------------------

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';

process.env.LOG_LEVEL ??= 'silent';
// Dates of the widget and of the states are formatted in the time zone of Gladys.
process.env.TZ = 'Europe/Paris';

export const KEY_17 = 'a'.repeat(32);
export const KEY_DHL = 'D'.repeat(32);

/** A fixture of test/fixtures/<source>, parsed. */
export const fixture = (source, name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/${source}/${name}.json`, import.meta.url), 'utf8'));

/** Tracking numbers of the fixtures. */
export const NUMBERS = {
  // 17TRACK
  inTransit: 'RR123456785CN',
  outForDelivery: '1Z999AA10123456784',
  delivered: '9400111899223197428490',
  awaitingPickup: 'LP00123456789012',
  problem: 'YT2312345678901234',
  notFound: 'TBA123456789000',
  dhlCarried: 'JD014600006281230701',
  // DHL
  dhlPreTransit: '00340434292135100186',
  dhlTransit: '00340434000000000011',
  dhlOutForDelivery: '00340434000000000012',
  dhlPickup: '00340434000000000013',
  dhlDelivered: '00340434000000000014',
  dhlFailure: '00340434000000000015',
};

const SEVENTEEN_ANSWERS = {
  [NUMBERS.inTransit]: 'in-transit',
  [NUMBERS.outForDelivery]: 'out-for-delivery',
  [NUMBERS.delivered]: 'delivered',
  [NUMBERS.awaitingPickup]: 'awaiting-pickup',
  [NUMBERS.problem]: 'problem',
  [NUMBERS.dhlCarried]: 'dhl-carried',
};

const DHL_ANSWERS = {
  [NUMBERS.dhlPreTransit]: 'pre-transit',
  [NUMBERS.dhlTransit]: 'transit',
  [NUMBERS.dhlOutForDelivery]: 'out-for-delivery',
  [NUMBERS.dhlPickup]: 'awaiting-pickup',
  [NUMBERS.dhlDelivered]: 'delivered',
  [NUMBERS.dhlFailure]: 'failure',
  [NUMBERS.dhlCarried]: 'transit',
};

const reply = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers(headers),
  json: async () => {
    if (body === undefined) {
      throw new SyntaxError('Unexpected end of JSON input');
    }
    return structuredClone(body);
  },
});

/** A 17TRACK gettrackinfo entry for `number`, from a fixture name. */
function trackEntry(name, number) {
  const entry = fixture('17track', name).data.accepted[0];
  return { ...entry, number };
}

/**
 * Simulated APIs.
 * - `seventeen.answers[number]`: fixture name of 17TRACK (default: not found);
 *   `seventeen.undetected`: numbers whose carrier 17TRACK cannot detect;
 *   `seventeen.quotaLeft`: registrations left; `seventeen.failAll`: a reply.
 * - `dhl.answers[number]`: fixture name of DHL (default: 404);
 *   `dhl.failAll`: a reply.
 * - `throwAll`: fetch rejects with this error.
 */
export function createApi({ key17 = KEY_17, keyDhl = KEY_DHL } = {}) {
  const api = {
    requests: [],
    throwAll: null,
    seventeen: {
      answers: { ...SEVENTEEN_ANSWERS },
      registered: new Set(),
      undetected: new Set(),
      quotaLeft: 100,
      failAll: null,
    },
    dhl: { answers: { ...DHL_ANSWERS }, failAll: null },
    async fetch(url, options = {}) {
      const parsed = new URL(url);
      if (api.throwAll) {
        api.requests.push({ host: parsed.host, url });
        throw api.throwAll;
      }
      if (parsed.host === 'api.17track.net') {
        return api.answerSeventeen(parsed, options);
      }
      if (parsed.host === 'api-eu.dhl.com') {
        return api.answerDhl(parsed, options);
      }
      throw new Error(`unexpected host ${parsed.host}`);
    },
    answerSeventeen(parsed, options) {
      const endpoint = parsed.pathname.split('/').pop();
      const body = JSON.parse(options.body ?? 'null');
      const numbers = Array.isArray(body) ? body.map((entry) => entry.number) : [];
      api.requests.push({ host: 'api.17track.net', endpoint, numbers, headers: options.headers });
      const s = api.seventeen;
      if (s.failAll) {
        return reply(s.failAll.status, s.failAll.body, s.failAll.headers);
      }
      if (options.headers?.['17token'] !== key17) {
        return reply(401, fixture('17track', 'error-401'));
      }
      const accepted = [];
      const rejected = [];
      const reject = (number, code, message = 'refused') =>
        rejected.push({ number, error: { code, message } });
      if (endpoint === 'register') {
        for (const number of numbers) {
          if (s.registered.has(number)) {
            reject(number, -18019901);
          } else if (s.undetected.has(number)) {
            reject(number, -18019903);
          } else if (s.quotaLeft <= 0) {
            reject(number, -18019908);
          } else {
            s.quotaLeft -= 1;
            s.registered.add(number);
            accepted.push({ origin: 1, number, carrier: 3011 });
          }
        }
      } else if (endpoint === 'gettrackinfo') {
        for (const number of numbers) {
          if (!s.registered.has(number)) {
            reject(number, -18019902);
          } else {
            accepted.push(trackEntry(s.answers[number] ?? 'not-found', number));
          }
        }
      } else if (endpoint === 'deletetrack') {
        for (const number of numbers) {
          s.registered.delete(number);
          accepted.push({ number, carrier: 3011 });
        }
      } else if (endpoint === 'getquota') {
        const quota = fixture('17track', 'getquota');
        quota.data.quota_remain = s.quotaLeft;
        return reply(200, quota);
      }
      return reply(200, { code: 0, data: { accepted, rejected } });
    },
    answerDhl(parsed, options) {
      const number = parsed.searchParams.get('trackingNumber');
      api.requests.push({
        host: 'api-eu.dhl.com',
        number,
        language: parsed.searchParams.get('language'),
        headers: options.headers,
      });
      if (api.dhl.failAll) {
        const { status, body, headers } = api.dhl.failAll;
        return reply(status, body, headers);
      }
      if (options.headers?.['DHL-API-Key'] !== keyDhl) {
        return reply(401, fixture('dhl', 'error-401'));
      }
      const name = api.dhl.answers[number];
      if (!name) {
        return reply(404, fixture('dhl', 'error-404'));
      }
      const body = fixture('dhl', name);
      body.shipments[0].id = number;
      return reply(200, body);
    },
    /** Requests to DHL for a number, or all of them. */
    dhlReads: (number) =>
      api.requests.filter((r) => r.host === 'api-eu.dhl.com' && (!number || r.number === number))
        .length,
    /** 17TRACK requests of an endpoint (for a number, when given). */
    seventeenCalls: (endpoint, number) =>
      api.requests.filter(
        (r) =>
          r.host === 'api.17track.net' &&
          r.endpoint === endpoint &&
          (!number || r.numbers.includes(number)),
      ).length,
  };
  return api;
}

/** A manual clock; `sleep` moves it forward instead of waiting. */
export function createClock(start = Date.parse('2026-10-14T08:00:00Z')) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
    async sleep(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/**
 * @param {object} [options]
 * @param {object} [options.config] raw integration config (both keys by default)
 * @param {object} [options.api] from createApi
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {object} [options.saved] content of /data/parcels.json before the start
 * @param {boolean} [options.connect]
 */
export async function createWorld({
  config = {},
  api = createApi(),
  devices = [],
  saved,
  connect = true,
  timers = false,
  clock = createClock(),
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-colis-')),
} = {}) {
  const gladys = createFakeGladys({
    config: { seventeentrack_key: KEY_17, dhl_key: KEY_DHL, ...config },
    devices,
  });
  const store = new Store(dataDir);
  if (saved) {
    await store.save(saved);
    await store.flush();
  }
  const app = registerHandlers(gladys, {
    store,
    fetch: api.fetch,
    timers,
    now: clock.now,
    sleep: clock.sleep,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
    await app.tracker.running;
  }
  return { gladys, fake: gladys.fake, app, tracker: app.tracker, api, clock, store, dataDir };
}

/** Run the "Track a parcel" action; resolves with the ack. */
export const track = (world, number, name) =>
  world.fake.action('track_parcel', name === undefined ? { number } : { number, name });

/** The discovered device of a parcel. */
export const discovered = (world, number) =>
  world.fake.discoveredDevices.find((device) => device.external_id.endsWith(`:${number}`));

/** Create a parcel's device in Gladys, as the user would from the Discover tab. */
export async function createDevice(world, number) {
  const device = discovered(world, number);
  await world.fake.deviceCreated(device);
  return device;
}

/** External id of one feature of a device. */
export const featureId = (device, key) =>
  device.features.find((feature) => feature.external_id.endsWith(`:${key}`)).external_id;

/** One cycle after `ms` of time. */
export async function after(world, ms) {
  world.clock.advance(ms);
  return world.tracker.runCycle();
}

/**
 * Capture the integration's log lines at `level` and above (LOG_LEVEL is read
 * at every call). Returns the lines as `{ level, text }`.
 */
export function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const lines = [];
  const record = (...args) => {
    const text = args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' ');
    const match = /^\[[^\]]+\] \[(\w+)\]/.exec(text);
    lines.push({ level: match ? match[1].toLowerCase() : 'raw', text });
  };
  t.mock.method(console, 'log', record);
  t.mock.method(console, 'error', record);
  t.mock.method(console, 'warn', record);
  t.mock.method(console, 'info', record);
  t.mock.method(console, 'debug', record);
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  return lines;
}
