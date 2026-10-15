// -----------------------------------------------------------------------------
// The scene actions and the widget, through the SDK's fake Gladys: outputs,
// sentence, widget content validated like the core does (budget, components),
// in the four languages.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { MAX_ITEMS } from '../src/widgets.js';
import { after, createWorld, NUMBERS, track } from './helpers/world.js';

const LANGS = ['en', 'fr', 'de', 'es'];

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

test('track_parcel takes the first number of a whole text', async (t) => {
  const w = await world(t);
  const ack = await w.fake.sceneAction('track_parcel', {
    number: 'Votre commande est expédiée ! Suivi UPS : 1Z999AA10123456784.',
    name: 'Shoes',
  });
  assert.equal(ack.success, true);
  assert.deepEqual(ack.data.outputs, {
    number: '1Z999AA10123456784',
    name: 'Shoes',
    status: 'En livraison',
    carrier: 'UPS',
    added: 1,
  });
  const again = await w.fake.sceneAction('track_parcel', { number: '1Z999AA10123456784' });
  assert.equal(again.data.outputs.added, 0);
});

test('track_parcel fails, alone, on a text without a number', async (t) => {
  const w = await world(t);
  const ack = await w.fake.sceneAction('track_parcel', { number: 'Hello' });
  assert.equal(ack.success, false);
});

test('untrack_parcel says whether a parcel was removed', async (t) => {
  const w = await world(t);
  await track(w, NUMBERS.inTransit, 'Lamp');
  const found = await w.fake.sceneAction('untrack_parcel', { parcel: 'Lamp' });
  assert.deepEqual(found.data.outputs, { removed: 1, name: 'Lamp' });
  const none = await w.fake.sceneAction('untrack_parcel', { parcel: 'Lamp' });
  assert.deepEqual(none.data.outputs, { removed: 0, name: '' });
});

test('read_parcels: a sentence and the counts', async (t) => {
  const w = await world(t, { config: { language: 'fr' } });
  const empty = await w.fake.sceneAction('read_parcels', {});
  assert.equal(empty.data.outputs.text, 'Aucun colis en cours.');
  await track(w, NUMBERS.outForDelivery, 'Chaussures');
  await track(w, NUMBERS.awaitingPickup, 'Livre');
  await track(w, NUMBERS.delivered, 'Lampe');
  const ack = await w.fake.sceneAction('read_parcels', {});
  assert.deepEqual(ack.data.outputs, {
    text: "Vous avez 2 colis en cours : Chaussures, en cours de livraison aujourd'hui ; Livre, à retirer.",
    in_progress: 2,
    out_for_delivery: 1,
    awaiting_pickup: 1,
    problems: 0,
  });
});

test('the widget lists the parcels, what needs the user first, valid for the core', async (t) => {
  const w = await world(t);
  await track(w, NUMBERS.inTransit, 'Lamp');
  await track(w, NUMBERS.delivered, 'Book');
  await track(w, NUMBERS.dhlOutForDelivery, 'Shoes');
  for (const language of LANGS) {
    const ack = await w.fake.widgetGet('parcels', { language });
    assert.equal(ack.success, true);
    const content = ack.data.content;
    assert.doesNotThrow(() => validateWidgetContent(content), language);
    const [list] = content.components;
    assert.deepEqual(
      list.items.map((item) => item.title),
      ['Shoes', 'Lamp', 'Book'],
    );
    assert.ok(list.items.every((item) => item.links[0].url.startsWith('https://')));
  }
  const fr = (await w.fake.widgetGet('parcels', { language: 'fr' })).data.content;
  const shoes = fr.components[0].items[0];
  assert.equal(shoes.badge.text, 'En livraison');
  assert.match(shoes.subtitle, /^The shipment has been loaded onto the delivery vehicle/);
  assert.match(
    shoes.description,
    /^DHL Paket · N° 00340434000000000012\nPrévu le mercredi 14 octobre/,
  );
  assert.match(shoes.description, /Historique\n14\/10\/2026 08:02 — The shipment/);
});

test('the widget: empty list, too many parcels, a source problem', async (t) => {
  const w = await world(t, { config: { dhl_key: 'refused' } });
  const empty = (await w.fake.widgetGet('parcels', { language: 'de' })).data.content;
  assert.match(empty.components[0].text, /Keine Sendung verfolgt/);
  for (let i = 0; i < MAX_ITEMS + 2; i += 1) {
    w.api.seventeen.answers[`RR00000000${i}CN`] = 'in-transit';
    await track(w, `RR00000000${i}CN`);
  }
  await track(w, NUMBERS.dhlTransit);
  const content = (await w.fake.widgetGet('parcels', { language: 'en' })).data.content;
  assert.doesNotThrow(() => validateWidgetContent(content));
  assert.equal(content.components[0].items.length, MAX_ITEMS);
  assert.deepEqual(
    content.components.slice(1).map((c) => c.text),
    ['+ 3 more parcels', 'DHL refuses the API key: check it in the configuration.'],
  );
});

test('the widget is refreshed when a parcel changes', async (t) => {
  const w = await world(t);
  await track(w, NUMBERS.inTransit);
  await new Promise((resolve) => setImmediate(resolve));
  const before = w.fake.widgetRefreshes.length;
  assert.ok(before > 0);
  w.api.seventeen.answers[NUMBERS.inTransit] = 'out-for-delivery';
  await after(w, 60 * 60_000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(w.fake.widgetRefreshes.length > before);
});
