// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake Gladys)
// and returns the tracker, so index.js stays a few lines and the tests drive
// the very same wiring.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { SCENE_ACTIONS } from './scenes.js';
import { Store } from './store.js';
import { CONNECTION } from './texts.js';
import { Tracker } from './tracker.js';
import { WIDGETS } from './widgets.js';

const logger = createLogger({ name: 'colis-app' });

// A configuration action displays what it resolves, in the user's language,
// while a thrown error shows a single string: the mistakes of the user (an
// invalid number, an unknown parcel) are answered, not thrown.
const answered =
  (fn) =>
  async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err.messages) {
        return err.messages;
      }
      throw err;
    }
  };

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams: store, fetch, timers, now, sleep
 */
export function registerHandlers(gladys, options = {}) {
  const tracker = new Tracker({
    gladys,
    store: options.store ?? new Store(),
    fetch: options.fetch,
    timers: options.timers ?? true,
    now: options.now,
    sleep: options.sleep,
  });

  // Resolved once the tracker has started; every handler waits for it, so a
  // command arriving during the start is not lost.
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let started = false;
  const whenReady =
    (fn) =>
    async (...args) => {
      await ready;
      return fn(...args);
    };

  gladys.on('connected', async () => {
    try {
      const config = normalizeConfig(await gladys.getConfig());
      if (started) {
        await tracker.resync(config);
        return;
      }
      started = true;
      await tracker.start(config);
    } catch (err) {
      logger.error('Initialization failed', err);
      await gladys.setConnectionStatus(false, CONNECTION.initFailed).catch(() => {});
    } finally {
      resolveReady();
    }
  });

  gladys.onScanRequest(whenReady(() => tracker.publishDevices()));

  // The devices are published with should_poll: false (the tracker's own timer
  // reads the sources); this only serves a Gladys that would poll anyway.
  gladys.onPoll(whenReady(() => tracker.runCycle()));

  gladys.onDeviceCreated(whenReady((device) => tracker.onDeviceCreated(device)));

  gladys.onConfigUpdated(whenReady((raw) => tracker.reconfigure(normalizeConfig(raw))));

  const actions = {
    track_parcel: (fields) => tracker.trackAction(fields),
    untrack_parcel: (fields) => tracker.untrackAction(fields),
    refresh: () => tracker.refreshNow(),
  };
  for (const [key, handler] of Object.entries(actions)) {
    gladys.onAction(key, whenReady(answered(handler)));
  }

  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(
      key,
      whenReady((fields) => handler(tracker, { fields: fields ?? {} })),
    );
  }

  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(
      key,
      whenReady((request) => widget.get(tracker, request)),
    );
  }

  return {
    tracker,
    ready,
    actions: Object.keys(actions),
    stop: () => tracker.stop(),
  };
}
