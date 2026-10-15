# Test fixtures

- `gladys-feature-table.json`: the category/type couples, units and poll
  frequencies the Gladys core knows (extracted from the core code by the
  maintainer).
- `dhl/pre-transit.json` and `dhl/error-400.json`: **real answers** of DHL
  "Shipment Tracking - Unified", published in the tests of
  [RomaBilka/parcel-tracking](https://github.com/RomaBilka/parcel-tracking)
  (MIT). The tracking number `00340434292135100186` is the sample number of
  the DHL documentation.
- The other `dhl/` files are **derived** from that answer: same structure, the
  status, events and texts changed to the wordings DHL Paket uses (English and
  German), invented numbers `003404340000000000xx`. The error bodies follow the
  problem+json format of the API.
- `17track/`: **built from the documented schema** of the 17TRACK tracking API
  v2.2 (`register`, `gettrackinfo`, `deletetrack`, `getquota`; field names and
  error codes as in the typings of `@be-link/17trak-api-sdk`, ISC). No captured
  answer was available without an account: `scripts/probe.mjs` checks the real
  shapes. Numbers, places and texts are invented or public sample numbers.
