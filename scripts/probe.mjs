// -----------------------------------------------------------------------------
// Probe of the real APIs, read only, from a machine that has the network:
//
//   node scripts/probe.mjs                       fake keys: a clean refusal is expected
//   SEVENTEENTRACK_KEY=… DHL_KEY=… node scripts/probe.mjs   real keys
//
// It runs the integration's own clients (src/seventeentrack.js, src/dhl.js),
// so it checks the real shapes the tests only simulate. It never registers a
// number (the one 17TRACK call that spends quota) and never prints a key: only
// the kinds of answers, the statuses and the field names found.
// -----------------------------------------------------------------------------

import * as dhl from '../src/dhl.js';
import * as seventeen from '../src/seventeentrack.js';

const fake17 = !process.env.SEVENTEENTRACK_KEY;
const fakeDhl = !process.env.DHL_KEY;
const key17 = process.env.SEVENTEENTRACK_KEY || 'F'.repeat(32);
const keyDhl = process.env.DHL_KEY || 'probe-not-a-key';
// A number nobody tracks on this account, and DHL's documentation sample.
const UNREGISTERED = process.env.PROBE_17TRACK_NUMBER || 'RR000000000CN';
const DHL_SAMPLE = process.env.PROBE_DHL_NUMBER || '00340434292135100186';

let failures = 0;
const report = (label, ok, detail) => {
  failures += ok ? 0 : 1;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
};
const kindOf = (err) => err?.kind ?? err?.name ?? String(err);

async function probe17() {
  console.log(`\n17TRACK v2.2 (${fake17 ? 'fake key' : 'real key'})`);
  try {
    const quota = await seventeen.getQuota({ apiKey: key17 });
    report(
      'getquota',
      !fake17,
      `total ${quota.total}, remaining ${quota.remaining}, daily ${quota.maxDaily}`,
    );
  } catch (err) {
    report('getquota', fake17 && err.kind === 'invalid_key', `${kindOf(err)}: ${err.message}`);
  }
  try {
    const { accepted, rejected } = await seventeen.getTrackInfo([UNREGISTERED], { apiKey: key17 });
    const code = rejected.get(UNREGISTERED);
    report(
      'gettrackinfo of an unregistered number',
      !fake17 && (code === seventeen.CODES.NOT_REGISTERED || accepted.has(UNREGISTERED)),
      accepted.has(UNREGISTERED)
        ? `accepted, status ${accepted.get(UNREGISTERED).status}`
        : `rejected with code ${code}`,
    );
  } catch (err) {
    report('gettrackinfo', fake17 && err.kind === 'invalid_key', `${kindOf(err)}: ${err.message}`);
  }
}

async function probeDhl() {
  console.log(`\nDHL Shipment Tracking - Unified (${fakeDhl ? 'fake key' : 'real key'})`);
  try {
    const shipment = await dhl.fetchShipment(DHL_SAMPLE, { apiKey: keyDhl, language: 'de' });
    report(
      `shipment ${DHL_SAMPLE}`,
      !fakeDhl,
      `status ${shipment.status}, carrier ${shipment.carrier}, ${shipment.events.length} event(s)`,
    );
  } catch (err) {
    const expected = fakeDhl ? err.kind === 'invalid_key' : err instanceof dhl.NotFoundError;
    report(`shipment ${DHL_SAMPLE}`, expected, `${kindOf(err)}: ${err.message}`);
  }
  try {
    await dhl.fetchShipment('0000000000', { apiKey: keyDhl });
    report('unknown number', false, 'answered with a shipment');
  } catch (err) {
    const expected = fakeDhl ? err.kind === 'invalid_key' : err instanceof dhl.NotFoundError;
    report('unknown number', expected, `${kindOf(err)}: ${err.message}`);
  }
}

await probe17();
// DHL allows one request every 5 seconds on the free plan.
await new Promise((resolve) => setTimeout(resolve, 5_000));
await probeDhl();
console.log(failures === 0 ? '\nAll answers as expected.' : `\n${failures} unexpected answer(s).`);
process.exitCode = failures === 0 ? 0 : 1;
