// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG, KEEP_DELIVERED_DAYS, LANGUAGES } from '../src/config.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { TRIGGERS } from '../src/status.js';
import { WIDGET_KEY } from '../src/tracker.js';
import { WIDGETS } from '../src/widgets.js';
import { after, createApi, createWorld, NUMBERS, track } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

// The handlers the integration actually registers on the SDK.
const { gladys: registered, app } = await createWorld({ connect: false });
await app.stop();
const handlerKeys = (prefix) =>
  Object.keys(registered.handlers)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length));

const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const optionValues = (field) => field.options.map((option) => option.value);
const field = (list, key) => list.find((entry) => entry.key === key);

test('identity: name, image, cover, cloud transport, services category', () => {
  assert.equal(manifest.name, 'Parcel tracking (17TRACK, DHL)');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  assert.equal(manifest.type, 'device');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-colis:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-colis/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.deepEqual(manifest.categories, ['services']);
});

test('Gladys 5.1.0 at least: widgets, scene triggers and actions', () => {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  const [major, minor] = match.slice(1).map(Number);
  assert.ok(major > 5 || (major === 5 && minor >= 1), manifest.gladys_version);
});

test('every manifest action has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions).sort(), handlerKeys('action:').sort());
});

test('every scene action has a handler, and its outputs are the declared ones', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
  assert.deepEqual(handlerKeys('sceneAction:').sort(), keysOf(manifest.scene_actions).sort());
  const world = await createWorld();
  t.after(() => world.app.stop());
  const results = {
    track_parcel: await world.fake.sceneAction('track_parcel', { number: NUMBERS.inTransit }),
    read_parcels: await world.fake.sceneAction('read_parcels', {}),
    untrack_parcel: await world.fake.sceneAction('untrack_parcel', { parcel: NUMBERS.inTransit }),
  };
  for (const action of manifest.scene_actions) {
    assert.equal(results[action.key].success, true, action.key);
    assert.deepEqual(
      Object.keys(results[action.key].data.outputs).sort(),
      keysOf(action.outputs).sort(),
      `${action.key} outputs`,
    );
    // "Continue only if" compares with ===: numbers, never booleans.
    for (const output of action.outputs) {
      assert.notEqual(output.type, 'boolean', `${action.key}.${output.key}`);
      assert.equal(
        typeof results[action.key].data.outputs[output.key],
        output.type,
        `${action.key}.${output.key}`,
      );
    }
  }
});

test('the scene triggers fired are the declared ones, with their filters and variables', async (t) => {
  assert.deepEqual(
    keysOf(manifest.scene_triggers).sort(),
    [...new Set(Object.values(TRIGGERS).map((trigger) => trigger.key))].sort(),
  );
  const api = createApi();
  const world = await createWorld({ api });
  t.after(() => world.app.stop());
  const numbers = ['RR000000001CN', 'RR000000002CN', 'RR000000003CN', 'RR000000004CN'];
  for (const number of numbers) {
    api.seventeen.answers[number] = 'in-transit';
    await track(world, number);
  }
  ['out-for-delivery', 'awaiting-pickup', 'problem', 'delivered'].forEach((name, index) => {
    api.seventeen.answers[numbers[index]] = name;
  });
  await after(world, 60 * 60_000);
  const fired = world.fake.sceneEvents;
  assert.deepEqual(
    [...new Set(fired.map((event) => event.key))].sort(),
    keysOf(manifest.scene_triggers).sort(),
  );
  assert.equal(fired.length, 4);
  for (const event of fired) {
    const trigger = field(manifest.scene_triggers, event.key);
    const declared = [...keysOf(trigger.fields), ...keysOf(trigger.variables)];
    assert.deepEqual(
      Object.keys(event.data).sort(),
      [...new Set(declared)].sort(),
      `${event.key} sends every declared key, and only those`,
    );
    for (const value of Object.values(event.data)) {
      assert.equal(typeof value, 'string');
    }
    // The parcel filter is the external id of the parcel's device.
    assert.ok(world.fake.discoveredDevices.some((d) => d.external_id === event.data.parcel));
    const reason = field(trigger.fields, 'reason');
    if (reason) {
      assert.ok(optionValues(reason).includes(event.data.reason));
    }
  }
});

test('every widget has its handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.widgets), [WIDGET_KEY]);
  assert.deepEqual(Object.keys(WIDGETS), [WIDGET_KEY]);
  assert.deepEqual(handlerKeys('widget:'), [WIDGET_KEY]);
});

test('config_schema defaults and options are the ones of the code', () => {
  for (const entry of manifest.config_schema) {
    if (entry.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[entry.key], entry.default, entry.key);
    }
  }
  assert.deepEqual(
    Object.keys(DEFAULT_CONFIG).sort(),
    manifest.config_schema
      .filter((entry) => entry.type !== 'section')
      .map((entry) => entry.key)
      .sort(),
  );
  assert.deepEqual(optionValues(field(manifest.config_schema, 'language')), LANGUAGES);
  assert.deepEqual(
    optionValues(field(manifest.config_schema, 'keep_delivered')),
    KEEP_DELIVERED_DAYS,
  );
  assert.equal(field(manifest.config_schema, 'seventeentrack_key').type, 'secret');
  assert.equal(field(manifest.config_schema, 'dhl_key').type, 'secret');
});

test('section fields are purely presentational', () => {
  for (const section of manifest.config_schema.filter((entry) => entry.type === 'section')) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('number fields have integer bounds (the form has no step)', () => {
  for (const entry of allFields.filter((f) => f.type === 'number')) {
    for (const key of ['min', 'max', 'default']) {
      if (entry[key] !== undefined) {
        assert.ok(Number.isInteger(entry[key]), `${entry.key}.${key}`);
      }
    }
  }
});

test('actions: no secret field, no default (the core applies none to actions)', () => {
  // GladysAssistant/Gladys#3154 and #3155.
  for (const action of [...manifest.actions, ...manifest.scene_actions]) {
    for (const entry of action.fields ?? []) {
      assert.notEqual(entry.type, 'secret', `${action.key}.${entry.key}`);
      assert.equal(entry.default, undefined, `${action.key}.${entry.key}`);
    }
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});

test('trigger filters: no secret, optional (a wildcard by default), devices as the parcel source', () => {
  for (const trigger of manifest.scene_triggers) {
    for (const entry of trigger.fields ?? []) {
      assert.ok(['string', 'number', 'select', 'multi_select'].includes(entry.type), entry.key);
      assert.notEqual(entry.required, true, `${trigger.key}.${entry.key}`);
    }
    assert.equal(field(trigger.fields, 'parcel').source, 'devices');
  }
});

test('the manifest names the carriers it is not affiliated with', () => {
  const intro = field(manifest.config_schema, 'intro').description;
  assert.match(intro.en, /Not affiliated with the carriers or 17TRACK/);
});
