// -----------------------------------------------------------------------------
// The tracker against the simulated APIs: choice of the source, pace of the
// readings by status, DHL daily allowance, 17TRACK quota spent once per
// parcel, archiving, scene triggers on transitions only, refused keys and
// outages, persistence across a restart, device states, and the container's
// own timer (the 5.2 core never polls a device created without should_poll).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PARCELS } from '../src/device.js';
import { CONNECTION } from '../src/texts.js';
import { DHL_DAILY_BUDGET, HEARTBEAT_MS, TICK_MS } from '../src/tracker.js';
import {
  after,
  createApi,
  createClock,
  createDevice,
  createWorld,
  featureId,
  KEY_17,
  KEY_DHL,
  NUMBERS,
  track,
} from './helpers/world.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const parcel = (w, number) => w.tracker.parcels.get(number);

test('a DHL-shaped number is read from DHL, any other from 17TRACK', async (t) => {
  const w = await world(t);
  await track(w, NUMBERS.dhlTransit);
  await track(w, NUMBERS.inTransit);
  assert.equal(parcel(w, NUMBERS.dhlTransit).source, 'dhl');
  assert.equal(parcel(w, NUMBERS.dhlTransit).carrier, 'DHL Paket');
  assert.equal(w.api.seventeenCalls('register', NUMBERS.dhlTransit), 0);
  assert.equal(parcel(w, NUMBERS.inTransit).source, '17track');
  assert.equal(parcel(w, NUMBERS.inTransit).carrier, 'La Poste');
  assert.equal(w.api.dhlReads(NUMBERS.inTransit), 0);
});

test('a DHL-shaped number DHL does not know goes to 17TRACK', async (t) => {
  const w = await world(t);
  const number = '123456789012'; // 12 digits: DHL Paket, or FedEx
  w.api.seventeen.answers[number] = 'in-transit';
  await track(w, number);
  assert.equal(w.api.dhlReads(number), 1);
  assert.equal(parcel(w, number).source, '17track');
  assert.equal(parcel(w, number).status, 'in_transit');
  await after(w, 3 * HOUR);
  assert.equal(w.api.dhlReads(number), 1, 'DHL is not asked again');
});

test('a parcel 17TRACK says DHL carries moves to the DHL API', async (t) => {
  const w = await world(t);
  await track(w, NUMBERS.dhlCarried);
  const p = parcel(w, NUMBERS.dhlCarried);
  assert.equal(p.source, 'dhl');
  assert.equal(w.api.dhlReads(NUMBERS.dhlCarried), 1);
  await after(w, HOUR);
  assert.equal(w.api.seventeenCalls('gettrackinfo', NUMBERS.dhlCarried), 1, 'read by DHL now');
});

test('without a DHL key, every number goes to 17TRACK', async (t) => {
  const w = await world(t, { config: { dhl_key: '' } });
  w.api.seventeen.answers[NUMBERS.dhlTransit] = 'in-transit';
  await track(w, NUMBERS.dhlTransit);
  assert.equal(w.api.dhlReads(), 0);
  assert.equal(parcel(w, NUMBERS.dhlTransit).source, '17track');
});

test('17TRACK quota: one registration per parcel, the readings are batched', async (t) => {
  const w = await world(t, { config: { dhl_key: '' } });
  await track(w, NUMBERS.inTransit);
  await track(w, NUMBERS.problem);
  await track(w, NUMBERS.awaitingPickup);
  assert.equal(w.api.seventeenCalls('register'), 3);
  const before = w.api.seventeenCalls('gettrackinfo');
  for (let i = 0; i < 4; i += 1) {
    await after(w, HOUR);
  }
  assert.equal(w.api.seventeenCalls('register'), 3, 'never registered again');
  const reads = w.api.requests.filter((r) => r.endpoint === 'gettrackinfo').slice(-1)[0];
  assert.ok(reads.numbers.length >= 2, 'several numbers in one request');
  assert.ok(w.api.seventeenCalls('gettrackinfo') - before <= 4, 'one request per cycle at most');
});

test('the pace follows the status: 15 min out for delivery, 1 h in transit', async (t) => {
  const w = await world(t, { config: { dhl_key: '' } });
  await track(w, NUMBERS.outForDelivery);
  await track(w, NUMBERS.inTransit);
  const count = (number) => w.api.seventeenCalls('gettrackinfo', number);
  for (let minute = 0; minute < 60; minute += 1) {
    await after(w, MIN);
  }
  assert.equal(count(NUMBERS.outForDelivery), 1 + 4, 'every 15 minutes');
  assert.equal(count(NUMBERS.inTransit), 1 + 1, 'every hour');
});

test('a delivered parcel is never read again, then archived after the days kept', async (t) => {
  const w = await world(t, { config: { keep_delivered: '3' } });
  w.api.dhl.answers[NUMBERS.dhlTransit] = 'out-for-delivery';
  await track(w, NUMBERS.dhlTransit, 'Shoes');
  w.api.dhl.answers[NUMBERS.dhlTransit] = 'delivered';
  await after(w, HOUR);
  assert.equal(parcel(w, NUMBERS.dhlTransit).status, 'delivered');
  const reads = w.api.dhlReads(NUMBERS.dhlTransit);
  await after(w, 2 * DAY);
  assert.equal(w.api.dhlReads(NUMBERS.dhlTransit), reads, 'never read again');
  assert.ok(parcel(w, NUMBERS.dhlTransit));
  await after(w, DAY);
  assert.equal(parcel(w, NUMBERS.dhlTransit), undefined, 'archived after 3 days');
  assert.equal(w.tracker.archive[0].number, NUMBERS.dhlTransit);
  assert.ok(
    !w.fake.discoveredDevices.some((d) => d.external_id.endsWith(NUMBERS.dhlTransit)),
    'its device leaves the Discover tab',
  );
});

test('an archived parcel tracked again comes back without a new 17TRACK registration', async (t) => {
  const w = await world(t, { config: { keep_delivered: '1', dhl_key: '' } });
  await track(w, NUMBERS.inTransit, 'Lamp');
  w.api.seventeen.answers[NUMBERS.inTransit] = 'delivered';
  await after(w, HOUR);
  await after(w, 2 * DAY);
  assert.equal(parcel(w, NUMBERS.inTransit), undefined);
  await track(w, NUMBERS.inTransit);
  assert.equal(parcel(w, NUMBERS.inTransit).name, 'Lamp');
  assert.equal(w.api.seventeenCalls('register', NUMBERS.inTransit), 1);
  await after(w, HOUR);
  assert.ok(parcel(w, NUMBERS.inTransit), 'kept the days chosen again');
});

test('a number nobody knows is kept, then archived after 30 days', async (t) => {
  const w = await world(t);
  await track(w, NUMBERS.notFound);
  assert.equal(parcel(w, NUMBERS.notFound).status, 'not_found');
  // Right after the registration, 17TRACK is asked again soon.
  const reads = w.api.seventeenCalls('gettrackinfo', NUMBERS.notFound);
  await after(w, 15 * MIN);
  assert.equal(w.api.seventeenCalls('gettrackinfo', NUMBERS.notFound), reads + 1);
  for (let day = 0; day < 29; day += 1) {
    await after(w, DAY);
  }
  assert.ok(parcel(w, NUMBERS.notFound));
  await after(w, DAY);
  assert.equal(parcel(w, NUMBERS.notFound), undefined);
});

test('a carrier 17TRACK cannot detect is registered again a day later, not before', async (t) => {
  const api = createApi();
  const number = 'AB12345678';
  api.seventeen.undetected.add(number);
  const w = await world(t, { api });
  await track(w, number);
  assert.equal(parcel(w, number).status, 'not_found');
  for (let i = 0; i < 6; i += 1) {
    await after(w, 2 * HOUR);
  }
  assert.equal(api.seventeenCalls('register', number), 1);
  await after(w, 12 * HOUR);
  assert.equal(api.seventeenCalls('register', number), 2);
});

test('DHL: one request every 5 seconds, 240 a day at most', async (t) => {
  const w = await world(t);
  for (const n of ['11', '12', '13', '14', '15']) {
    await track(w, `003404340000000000${n}`);
  }
  const start = w.clock.now();
  await w.fake.action('refresh', {});
  assert.ok(w.clock.now() - start >= 4 * 5000, 'requests spaced by 5 seconds');
  for (let i = 0; i < 4 * 24 * 3; i += 1) {
    await after(w, 15 * MIN);
  }
  assert.ok(w.tracker.dhlUsedToday() <= DHL_DAILY_BUDGET);
});

test('DHL: the allowance spent pauses DHL until the next day, with one warning', async (t) => {
  const w = await world(t);
  await track(w, NUMBERS.dhlTransit);
  w.tracker.dhlUsage = { day: '2026-10-14', count: DHL_DAILY_BUDGET };
  const reads = w.api.dhlReads();
  await after(w, 2 * HOUR);
  await after(w, 2 * HOUR);
  assert.equal(w.api.dhlReads(), reads, 'no request past the allowance');
  assert.deepEqual(w.tracker.problems(), [{ source: 'DHL', kind: 'budget' }]);
  await after(w, 14 * HOUR); // 2026-10-15 in UTC
  assert.equal(w.api.dhlReads(), reads + 1);
  assert.deepEqual(w.tracker.problems(), []);
});

test('DHL: many parcels stretch the interval to fit the daily allowance', async (t) => {
  const w = await world(t);
  const numbers = Array.from(
    { length: 20 },
    (_, i) => `00340434${String(100000000000 + i).padStart(12, '0')}`,
  );
  for (const number of numbers) {
    w.api.dhl.answers[number] = 'transit';
    await track(w, number);
  }
  const before = w.api.dhlReads();
  for (let i = 0; i < 24 * 4; i += 1) {
    await after(w, 15 * MIN);
  }
  const perDay = w.api.dhlReads() - before;
  assert.ok(perDay <= 210, `${perDay} DHL requests in a day for 20 parcels`);
  assert.ok(perDay >= 150, `${perDay}: still read several times a day`);
});

test('scene triggers fire on a transition only, never for a parcel added delivered', async (t) => {
  const w = await world(t, { config: { dhl_key: '' } });
  await track(w, NUMBERS.delivered);
  await track(w, NUMBERS.inTransit, 'Lamp');
  assert.deepEqual(w.fake.sceneEvents, []);
  w.api.seventeen.answers[NUMBERS.inTransit] = 'out-for-delivery';
  await after(w, HOUR);
  await after(w, 15 * MIN);
  w.api.seventeen.answers[NUMBERS.inTransit] = 'delivered';
  await after(w, 15 * MIN);
  assert.deepEqual(
    w.fake.sceneEvents.map((event) => [event.key, event.data.name]),
    [
      ['parcel_out_for_delivery', 'Lamp'],
      ['parcel_delivered', 'Lamp'],
    ],
  );
});

test('the attention trigger carries its reason, and fires again when it changes', async (t) => {
  const w = await world(t);
  await track(w, NUMBERS.dhlFailure);
  w.api.dhl.answers[NUMBERS.dhlFailure] = 'awaiting-pickup';
  await after(w, 2 * HOUR);
  await after(w, 2 * HOUR);
  assert.deepEqual(
    w.fake.sceneEvents.map((event) => [event.key, event.data.reason]),
    [
      ['parcel_needs_attention', 'problem'],
      ['parcel_needs_attention', 'awaiting_pickup'],
    ],
  );
});

test('a restart neither forgets the parcels nor fires their triggers again', async (t) => {
  const api = createApi();
  const clock = createClock();
  const first = await createWorld({ api, clock });
  await track(first, NUMBERS.dhlOutForDelivery, 'Shoes');
  await first.app.stop();
  assert.equal(first.fake.sceneEvents.length, 1);
  const second = await world(t, { api, clock, dataDir: first.dataDir });
  assert.equal(second.tracker.parcels.get(NUMBERS.dhlOutForDelivery).name, 'Shoes');
  await after(second, 15 * MIN);
  assert.deepEqual(second.fake.sceneEvents, []);
  assert.equal(second.tracker.dhlUsedToday(), first.tracker.dhlUsedToday() + 1);
});

test('the states refresh on the container timer, without onPoll', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const w = await world(t, { timers: true, config: { dhl_key: '' } });
  const onPoll = t.mock.method(w.gladys.handlers, 'poll');
  await track(w, NUMBERS.inTransit);
  const device = await createDevice(w, NUMBERS.inTransit);
  const status = featureId(device, 'status');
  assert.equal(w.fake.lastState(status), 'En transit');
  w.api.seventeen.answers[NUMBERS.inTransit] = 'out-for-delivery';
  for (let minute = 0; minute < 60; minute += 1) {
    w.clock.advance(TICK_MS);
    t.mock.timers.tick(TICK_MS);
    await w.tracker.cycle;
  }
  assert.equal(w.fake.lastState(status), 'En livraison');
  assert.equal(onPoll.mock.callCount(), 0, 'Gladys never polled');
});

test('a created device gets all its states at once, then only the changes', async (t) => {
  const w = await world(t, { config: { language: 'en' } });
  await track(w, NUMBERS.dhlTransit, 'Book');
  const device = await createDevice(w, NUMBERS.dhlTransit);
  const states = () => w.fake.states.filter((s) => s.device_feature_external_id.includes(':0034'));
  assert.equal(states().length, 6);
  assert.equal(w.fake.lastState(featureId(device, 'status')), 'In transit');
  assert.equal(w.fake.lastState(featureId(device, 'carrier')), 'DHL Paket');
  assert.equal(w.fake.lastState(featureId(device, 'location')), 'Germany');
  assert.equal(w.fake.lastState(featureId(device, 'eta')), 'Thursday, October 15');
  assert.match(w.fake.lastState(featureId(device, 'event')), /parcel center/);
  await after(w, HOUR);
  assert.equal(states().length, 6, 'nothing changed, nothing sent');
  w.api.dhl.answers[NUMBERS.dhlTransit] = 'out-for-delivery';
  await after(w, HOUR);
  const sent = states().slice(6);
  assert.ok(sent.length >= 3 && sent.length < 6, 'only the changed features');
  assert.ok(sent.some((s) => s.text === 'Out for delivery'));
});

test('an unchanged state is published again after 12 hours (heartbeat)', async (t) => {
  // The SDK dates the published values with Date.now(): move both clocks.
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-14T08:00:00Z') });
  const w = await world(t, { config: { dhl_key: '' } });
  await track(w, NUMBERS.awaitingPickup);
  const device = await createDevice(w, NUMBERS.awaitingPickup);
  const status = featureId(device, 'status');
  const count = () => w.fake.states.filter((s) => s.device_feature_external_id === status).length;
  assert.equal(count(), 1);
  for (let elapsed = 0; elapsed < HEARTBEAT_MS; elapsed += 2 * HOUR) {
    t.mock.timers.tick(2 * HOUR);
    await after(w, 2 * HOUR);
  }
  assert.equal(count(), 2);
});

test('states are not sent for a parcel whose device is not created', async (t) => {
  const w = await world(t);
  await track(w, NUMBERS.dhlTransit);
  assert.deepEqual(w.fake.states, []);
});

test('a refused key stops that source only, until the key changes', async (t) => {
  const w = await world(t, { config: { dhl_key: 'wrong-key-123' } });
  await track(w, NUMBERS.dhlTransit);
  await track(w, NUMBERS.inTransit);
  assert.equal(parcel(w, NUMBERS.inTransit).status, 'in_transit', '17TRACK still reads');
  assert.deepEqual(w.tracker.problems(), [{ source: 'DHL', kind: 'invalid_key' }]);
  const reads = w.api.dhlReads();
  await after(w, 3 * HOUR);
  assert.equal(w.api.dhlReads(), reads, 'DHL is not asked again');
  // Meanwhile 17TRACK, which knows every carrier, takes the DHL number.
  assert.equal(parcel(w, NUMBERS.dhlTransit).source, '17track');
  await w.fake.configUpdated({ seventeentrack_key: KEY_17, dhl_key: KEY_DHL });
  assert.deepEqual(w.tracker.problems(), []);
});

test('both keys refused: the connection badge says so', async (t) => {
  const w = await world(t, { config: { dhl_key: 'nope-1', seventeentrack_key: 'nope-2' } });
  await track(w, NUMBERS.inTransit);
  await track(w, NUMBERS.dhlTransit);
  assert.deepEqual(w.fake.connectionStatus, {
    connected: false,
    message: CONNECTION.keysRefused,
  });
});

test('no key: nothing is read, the badge asks for one', async (t) => {
  const w = await world(t, { config: { dhl_key: '', seventeentrack_key: '' } });
  const ack = await track(w, NUMBERS.inTransit);
  assert.match(ack.data.message.en, /No API key yet/);
  assert.equal(w.api.requests.length, 0);
  assert.deepEqual(w.fake.connectionStatus, { connected: false, message: CONNECTION.noKey });
});

test('17TRACK quota spent: readings paused for an hour, one warning', async (t) => {
  const api = createApi();
  api.seventeen.quotaLeft = 0;
  const w = await world(t, { api, config: { dhl_key: '' } });
  await track(w, NUMBERS.inTransit);
  assert.deepEqual(w.tracker.problems(), [{ source: '17TRACK', kind: 'quota' }]);
  const calls = api.requests.length;
  await after(w, 30 * MIN);
  assert.equal(api.requests.length, calls, 'paused');
  api.seventeen.quotaLeft = 10;
  await after(w, 31 * MIN);
  assert.equal(parcel(w, NUMBERS.inTransit).status, 'in_transit');
  assert.deepEqual(w.tracker.problems(), []);
});

test('an outage pauses the source for 10 minutes', async (t) => {
  const w = await world(t, { config: { dhl_key: '' } });
  await track(w, NUMBERS.inTransit);
  w.api.seventeen.failAll = { status: 503, body: undefined };
  await after(w, HOUR);
  assert.deepEqual(w.tracker.problems(), [{ source: '17TRACK', kind: 'unavailable' }]);
  w.api.seventeen.failAll = null;
  await after(w, 5 * MIN);
  assert.equal(w.tracker.problems().length, 1, 'still paused');
  await after(w, 6 * MIN);
  assert.deepEqual(w.tracker.problems(), []);
});

test('a network failure is an outage, not a crash', async (t) => {
  const w = await world(t);
  w.api.throwAll = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
  const ack = await track(w, NUMBERS.dhlTransit);
  assert.equal(ack.success, true);
  assert.deepEqual(w.tracker.problems(), [{ source: 'DHL', kind: 'unavailable' }]);
});

test('track renames a parcel already tracked, untrack removes it from 17TRACK too', async (t) => {
  const w = await world(t, { config: { dhl_key: '' } });
  await track(w, NUMBERS.inTransit);
  const renamed = await track(w, 'rr 1234-5678 5cn', 'Lamp');
  assert.match(renamed.data.message.en, /renamed Lamp/);
  assert.equal(w.tracker.parcels.size, 1);
  const removed = await w.fake.action('untrack_parcel', { parcel: 'lamp' });
  assert.match(removed.data.message.fr, /Lamp n'est plus suivi/);
  assert.equal(w.tracker.parcels.size, 0);
  assert.equal(w.api.seventeenCalls('deletetrack', NUMBERS.inTransit), 1);
  const unknown = await w.fake.action('untrack_parcel', { parcel: 'nothing' });
  assert.equal(unknown.success, true);
  assert.match(unknown.data.message.en, /No tracked parcel/);
});

test('an invalid number is answered, not thrown', async (t) => {
  const w = await world(t);
  const ack = await track(w, 'hello');
  assert.equal(ack.success, true);
  assert.match(ack.data.message.de, /ist keine Sendungsnummer/);
  assert.equal(w.tracker.parcels.size, 0);
});

test(`${MAX_PARCELS} parcels at most`, async (t) => {
  const w = await world(t, { config: { dhl_key: '', seventeentrack_key: '' } });
  for (let i = 0; i < MAX_PARCELS; i += 1) {
    await track(w, `XX${String(i).padStart(9, '0')}YY`);
  }
  const ack = await track(w, 'XX999999999YY');
  assert.match(ack.data.message.en, /remove one first/);
});

test('"Read the parcels now" reads everything and reports the quotas', async (t) => {
  const w = await world(t);
  await track(w, NUMBERS.inTransit);
  await track(w, NUMBERS.dhlTransit);
  const ack = await w.fake.action('refresh', {});
  assert.equal(ack.success, true);
  assert.match(ack.data.message.en, /2 parcel\(s\) read/);
  assert.match(ack.data.message.en, /17TRACK: 99 registrations left of 200/);
  assert.match(ack.data.message.en, /DHL: 2 of 240 requests used today/);
});

test('"Read the parcels now" without parcels checks both keys', async (t) => {
  const w = await world(t, { config: { dhl_key: 'bad-key' } });
  const ack = await w.fake.action('refresh', {});
  assert.match(ack.data.message.en, /^No parcel on the way\. DHL refuses the API key/);
  assert.equal(w.api.seventeenCalls('getquota'), 1);
});

test('the language of the configuration renames the features of new devices', async (t) => {
  const w = await world(t, { config: { language: 'de' } });
  await track(w, NUMBERS.dhlTransit);
  const device = w.fake.discoveredDevices[0];
  assert.deepEqual(
    device.features.map((f) => f.name),
    [
      'Status',
      'Letzter Schritt',
      'Ort',
      'Datum des Schritts',
      'Zusteller',
      'Voraussichtliche Zustellung',
    ],
  );
  assert.equal(w.api.requests.find((r) => r.host === 'api-eu.dhl.com').language, 'de');
});
