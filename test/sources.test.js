// -----------------------------------------------------------------------------
// The two clients (17TRACK v2.2, DHL Unified) on the fixtures: parsing, status
// normalization, errors sorted by kind, keys never in a message; and the
// tracking numbers.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as dhl from '../src/dhl.js';
import { ERROR_KINDS, SourceError } from '../src/errors.js';
import { extractNumber, looksLikeDhl, normalizeNumber } from '../src/numbers.js';
import * as seventeen from '../src/seventeentrack.js';
import { fromDhl, fromSeventeenTrack, STATUSES } from '../src/status.js';
import { fixture, KEY_17, KEY_DHL } from './helpers/world.js';

const answer =
  (status, body, headers = {}) =>
  async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => {
      if (body === undefined) {
        throw new SyntaxError('Unexpected token <');
      }
      return body;
    },
  });

const seventeenOf = (name) => seventeen.parseTrackInfo(fixture('17track', name).data.accepted[0]);
const dhlOf = (name) => dhl.parseShipment(fixture('dhl', name).shipments[0], 'x');

test('17TRACK: statuses of the fixtures', () => {
  assert.equal(seventeenOf('in-transit').status, 'in_transit');
  assert.equal(seventeenOf('out-for-delivery').status, 'out_for_delivery');
  assert.equal(seventeenOf('delivered').status, 'delivered');
  assert.equal(seventeenOf('awaiting-pickup').status, 'awaiting_pickup');
  assert.equal(seventeenOf('problem').status, 'problem');
  assert.equal(seventeenOf('not-found').status, 'not_found');
});

test('17TRACK: every main status maps to one of ours', () => {
  for (const status of [
    'NotFound',
    'InfoReceived',
    'InTransit',
    'Expired',
    'AvailableForPickup',
    'OutForDelivery',
    'DeliveryFailure',
    'Delivered',
    'Exception',
    'SomethingNew',
  ]) {
    assert.ok(STATUSES.includes(fromSeventeenTrack(status)), status);
  }
  assert.equal(fromSeventeenTrack('Expired'), 'problem');
});

test('17TRACK: one timeline of every carrier, most recent first, original texts kept', () => {
  const parsed = seventeenOf('in-transit');
  assert.equal(parsed.carrier, 'La Poste');
  assert.equal(parsed.events.length, 4);
  assert.deepEqual(parsed.lastEvent, {
    date: '2026-10-13T04:41:00.000Z',
    text: "Votre colis est arrivé en France. Il est en cours d'acheminement.",
    location: 'ROISSY CHARLES DE GAULLE',
  });
  assert.equal(parsed.events.at(-1).text, 'Shipment information received');
  assert.equal(parsed.estimatedDate, '2026-10-15T22:00:00.000Z');
  assert.equal(parsed.url, 'https://t.17track.net/en#nums=RR123456785CN');
  assert.equal(seventeenOf('problem').lastEvent.text.startsWith('Zustellung nicht möglich'), true);
});

test('17TRACK: requests carry the key in the 17token header, numbers in a list', async () => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    return answer(200, fixture('17track', 'register-accepted'))();
  };
  const { accepted } = await seventeen.register(['RR123456785CN'], { apiKey: KEY_17, fetch });
  assert.deepEqual([...accepted], [['RR123456785CN', 3011]]);
  assert.equal(calls[0].url, 'https://api.17track.net/track/v2.2/register');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['17token'], KEY_17);
  assert.deepEqual(JSON.parse(calls[0].options.body), [{ number: 'RR123456785CN' }]);
});

test('17TRACK: refused numbers keep their error code', async () => {
  const options = { apiKey: KEY_17 };
  const already = await seventeen.register(['RR123456785CN'], {
    ...options,
    fetch: answer(200, fixture('17track', 'register-already')),
  });
  assert.equal(already.rejected.get('RR123456785CN'), seventeen.CODES.ALREADY_REGISTERED);
  const missing = await seventeen.getTrackInfo(['RR123456785CN'], {
    ...options,
    fetch: answer(200, fixture('17track', 'gettrackinfo-not-registered')),
  });
  assert.equal(missing.rejected.get('RR123456785CN'), seventeen.CODES.NOT_REGISTERED);
});

test('17TRACK: errors sorted by kind, the key never in the message', async () => {
  const cases = [
    [answer(401, fixture('17track', 'error-401')), ERROR_KINDS.INVALID_KEY],
    [
      answer(200, { code: -18010001, data: { errors: [{ code: -18010001, message: 'ip' }] } }),
      ERROR_KINDS.INVALID_KEY,
    ],
    [answer(429, undefined, { 'retry-after': '2' }), ERROR_KINDS.QUOTA],
    [
      answer(200, { code: -18019908, data: { errors: [{ code: -18019908, message: 'q' }] } }),
      ERROR_KINDS.QUOTA,
    ],
    [answer(500, undefined), ERROR_KINDS.UNAVAILABLE],
    [answer(200, { code: 0 }), ERROR_KINDS.UNAVAILABLE],
    [
      async () => {
        throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
      },
      ERROR_KINDS.UNAVAILABLE,
    ],
  ];
  for (const [fetch, kind] of cases) {
    await assert.rejects(
      seventeen.getTrackInfo(['RR123456785CN'], { apiKey: KEY_17, fetch }),
      (err) => err instanceof SourceError && err.kind === kind && !err.message.includes(KEY_17),
      kind,
    );
  }
});

test('17TRACK: the quota', async () => {
  const quota = await seventeen.getQuota({
    apiKey: KEY_17,
    fetch: answer(200, fixture('17track', 'getquota')),
  });
  assert.deepEqual(quota, { total: 200, used: 12, remaining: 188, todayUsed: 2, maxDaily: 100 });
});

test('DHL: the real pre-transit answer, and the derived ones', () => {
  const real = dhl.parseShipment(
    fixture('dhl', 'pre-transit').shipments[0],
    '00340434292135100186',
  );
  assert.equal(real.status, 'info_received');
  assert.equal(real.carrier, 'DHL Paket');
  assert.match(real.lastEvent.text, /instruction data for this shipment/);
  assert.match(real.url, /^https:\/\/www\.dhl\.de\//);
  assert.equal(dhlOf('transit').status, 'in_transit');
  assert.equal(dhlOf('transit').estimatedDate, '2026-10-15T00:00:00.000Z');
  assert.equal(dhlOf('out-for-delivery').status, 'out_for_delivery');
  assert.equal(dhlOf('awaiting-pickup').status, 'awaiting_pickup');
  assert.equal(dhlOf('delivered').status, 'delivered');
  assert.equal(dhlOf('failure').status, 'problem');
  assert.equal(dhlOf('delivered').lastEvent.location, 'Köln');
});

test('DHL: the wordings of "out for delivery" and "ready for pickup"', () => {
  const of = (statusCode, text) => fromDhl({ statusCode, status: text, description: text });
  assert.equal(
    of('transit', 'Die Sendung wurde in das Zustellfahrzeug geladen.'),
    'out_for_delivery',
  );
  assert.equal(of('transit', 'The shipment is out for delivery'), 'out_for_delivery');
  assert.equal(
    of('transit', 'Die Sendung liegt in der Filiale zur Abholung bereit.'),
    'awaiting_pickup',
  );
  assert.equal(
    of('transit', 'The shipment is ready for pick-up at the PACKSTATION'),
    'awaiting_pickup',
  );
  assert.equal(of('failure', 'Ready for collection at the retail outlet'), 'awaiting_pickup');
  assert.equal(of('transit', 'Arrival at the delivery base'), 'in_transit');
  assert.equal(of('pre-transit', 'Label created'), 'info_received');
  assert.equal(of('unknown', ''), 'not_found');
  assert.equal(of('delivered', 'Delivered to a neighbour'), 'delivered');
});

test('DHL: request, language, and errors sorted by kind', async () => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    return answer(200, fixture('dhl', 'transit'))();
  };
  await dhl.fetchShipment('00340434000000000011', { apiKey: KEY_DHL, language: 'es', fetch });
  const url = new URL(calls[0].url);
  assert.equal(url.origin + url.pathname, 'https://api-eu.dhl.com/track/shipments');
  assert.equal(url.searchParams.get('trackingNumber'), '00340434000000000011');
  assert.equal(url.searchParams.get('language'), 'es');
  assert.equal(calls[0].options.headers['DHL-API-Key'], KEY_DHL);

  const options = (fetchFn) => ({ apiKey: KEY_DHL, fetch: fetchFn });
  await assert.rejects(
    dhl.fetchShipment('1', options(answer(404, fixture('dhl', 'error-404')))),
    dhl.NotFoundError,
  );
  await assert.rejects(
    dhl.fetchShipment('1', options(answer(400, fixture('dhl', 'error-400')))),
    dhl.NotFoundError,
  );
  await assert.rejects(
    dhl.fetchShipment('1', options(answer(200, { shipments: [] }))),
    dhl.NotFoundError,
  );
  for (const [status, kind, body] of [
    [401, ERROR_KINDS.INVALID_KEY, fixture('dhl', 'error-401')],
    [429, ERROR_KINDS.QUOTA, fixture('dhl', 'error-429')],
    [503, ERROR_KINDS.UNAVAILABLE, undefined],
  ]) {
    await assert.rejects(
      dhl.fetchShipment('1', options(answer(status, body))),
      (err) => err.kind === kind && !err.message.includes(KEY_DHL),
      String(status),
    );
  }
});

test('tracking numbers: normalized, extracted from a text, DHL shapes', () => {
  assert.equal(normalizeNumber(' 1z 999 aa1-0123-456784 '), '1Z999AA10123456784');
  assert.equal(normalizeNumber('hello world'), null);
  assert.equal(normalizeNumber('ABCDEFGH1234'), null, 'five digits at least');
  assert.equal(normalizeNumber('1'.repeat(41)), null);
  assert.equal(normalizeNumber(12345678901), '12345678901');
  assert.equal(
    extractNumber('Your order has shipped! Tracking: 1Z999AA10123456784 (UPS)'),
    '1Z999AA10123456784',
  );
  assert.equal(extractNumber('Votre colis LP00123456789012 arrive'), 'LP00123456789012');
  assert.equal(extractNumber('no number here, order 1234'), null);
  for (const number of [
    '00340434292135100186',
    'JJD000390007882845123',
    '1234567890',
    'LX123456789DE',
    'RR123456785DE',
    '3SABCD123456789',
  ]) {
    assert.ok(looksLikeDhl(number), number);
  }
  for (const number of ['1Z999AA10123456784', 'RR123456785CN', 'LP00123456789012']) {
    assert.ok(!looksLikeDhl(number), number);
  }
});
