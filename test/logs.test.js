// -----------------------------------------------------------------------------
// What the integration writes to `docker logs`: at info, only the lifecycle
// and one line per user action, never one line per reading cycle; a failure
// that repeats is logged once, plus one line when it is over; the API keys
// never appear.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  after,
  captureLogs,
  createDevice,
  createWorld,
  KEY_17,
  KEY_DHL,
  NUMBERS,
  track,
} from './helpers/world.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const strip = (line) => line.text.replace(/^\[[^\]]+\] /, '');

async function busyWorld(t) {
  const w = await createWorld();
  t.after(() => w.app.stop());
  await track(w, NUMBERS.inTransit, 'Lamp');
  await track(w, NUMBERS.dhlTransit, 'Shoes');
  await createDevice(w, NUMBERS.inTransit);
  await createDevice(w, NUMBERS.dhlTransit);
  return w;
}

test('normal reading cycles write nothing at info', async (t) => {
  const w = await busyWorld(t);
  const lines = captureLogs(t, 'info');
  w.api.seventeen.answers[NUMBERS.inTransit] = 'out-for-delivery';
  w.api.dhl.answers[NUMBERS.dhlTransit] = 'delivered';
  for (let i = 0; i < 8; i += 1) {
    await after(w, 30 * MIN);
  }
  assert.deepEqual(lines, []);
});

test('LOG_LEVEL=debug shows the cycles', async (t) => {
  const w = await busyWorld(t);
  const lines = captureLogs(t, 'debug');
  await after(w, HOUR);
  assert.ok(lines.some((line) => /Reading cycle: 2 parcel\(s\) read, 2 tracked/.test(line.text)));
});

test('an outage is one warning, then one line when the source answers again', async (t) => {
  const w = await busyWorld(t);
  const lines = captureLogs(t, 'info');
  w.api.seventeen.failAll = { status: 502, body: undefined };
  for (let i = 0; i < 4; i += 1) {
    await after(w, HOUR);
  }
  w.api.seventeen.failAll = null;
  await after(w, HOUR);
  assert.deepEqual(lines.map(strip), [
    '[WARN] [colis] 17TRACK: unavailable (HTTP 502): readings paused for 10 min',
    '[INFO] [colis] 17TRACK answers again',
  ]);
});

test('states refused at every cycle: one warning, then one line at recovery', async (t) => {
  const w = await busyWorld(t);
  const lines = captureLogs(t, 'info');
  w.api.seventeen.answers[NUMBERS.inTransit] = 'out-for-delivery';
  const publish = t.mock.method(w.gladys, 'publishChangedStates', async () => {
    throw new Error('Gladys unreachable');
  });
  for (let i = 0; i < 3; i += 1) {
    await after(w, HOUR);
  }
  publish.mock.restore();
  await after(w, MIN);
  assert.deepEqual(lines.map(strip), [
    '[WARN] [colis] Publishing the states failed: Gladys unreachable',
    '[INFO] [colis] Publishing the states works again',
  ]);
});

test('refused keys: one warning each, and no key is ever written', async (t) => {
  const lines = captureLogs(t, 'debug');
  const bad17 = 'secret-17track-0123456789';
  const badDhl = 'secret-dhl-0123456789';
  const w = await createWorld({ config: { seventeentrack_key: bad17, dhl_key: badDhl } });
  t.after(() => w.app.stop());
  await track(w, NUMBERS.inTransit);
  await track(w, NUMBERS.dhlTransit);
  for (let i = 0; i < 3; i += 1) {
    await after(w, HOUR);
  }
  await w.fake.configUpdated({ seventeentrack_key: KEY_17, dhl_key: KEY_DHL });
  await w.fake.action('refresh', {});
  assert.equal(lines.filter((line) => /17TRACK: invalid_key/.test(line.text)).length, 1);
  assert.equal(lines.filter((line) => /DHL: invalid_key/.test(line.text)).length, 1);
  for (const secret of [bad17, badDhl, KEY_17, KEY_DHL]) {
    assert.ok(
      lines.every((line) => !line.text.includes(secret)),
      'a key appears in the logs',
    );
  }
});

test('a user action is one info line', async (t) => {
  const w = await busyWorld(t);
  const lines = captureLogs(t, 'info');
  await track(w, NUMBERS.problem, 'Letter');
  await w.fake.action('untrack_parcel', { parcel: 'Letter' });
  assert.deepEqual(lines.map(strip), [
    '[INFO] [colis] Parcel Letter added',
    '[INFO] [colis] Parcel Letter removed',
  ]);
});
