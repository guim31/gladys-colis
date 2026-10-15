# Parcel tracking for Gladys Assistant (17TRACK, DHL)

A [Gladys Assistant](https://gladysassistant.com/) integration that tracks your parcels from **every carrier**,
worldwide: UPS, FedEx, USPS, DHL, Deutsche Post, GLS, DPD, Royal Mail, the postal services, the parcels shipped
from China and more than 3,000 others, with one status for all of them.

> **Developed without a 17TRACK or DHL account: feedback welcome.** The answers of both APIs were simulated from
> their documentation; `scripts/probe.mjs` checks them against the real services.

For La Poste, Colissimo and Chronopost, use [gladys-laposte](https://github.com/guim31/gladys-laposte), which reads
the official La Poste API.

## What you get

- **Two sources**, each turned on by its free key:
  - the official DHL **Shipment Tracking - Unified** API for the DHL and Deutsche Post numbers (and for a parcel
    17TRACK says DHL carries);
  - **17TRACK** (tracking API v2.2) for everything else: it detects the carrier from the number and merges the events
    of every carrier along the way into one timeline.
- **One device per parcel**: normalized status (registered, in transit, out for delivery, to pick up, problem,
  delivered), last event in the carrier's own words, its place and date, carrier, expected delivery date.
- A **"My parcels" widget**, like a small parcel tracking app: what needs you first, history and tracking link on
  tap.
- **Scene triggers**: a parcel is out for delivery, delivered, needs you (to pick up or a problem).
- **Scene actions**: track a parcel (also from a mail subject), stop tracking a parcel, read my parcels (a sentence
  for a message or a voice announcement).
- Delivered parcels are archived after 7 days (adjustable).
- English, French, German and Spanish.

## Requirements

- Gladys 5.1.0 or later.
- A free 17TRACK key ([api.17track.net](https://api.17track.net/en)), a free DHL key
  ([developer.dhl.com](https://developer.dhl.com/), "Shipment Tracking - Unified"), or both.

## Installation

In Gladys, **Integrations → Install from GitHub**, address `https://github.com/guim31/gladys-colis`. Enter your
key(s) in the configuration, use the **Track a parcel** action, then create the parcel's device in the **Discover**
tab. The full guide: [English](docs/en.md), [français](docs/fr.md), [Deutsch](docs/de.md), [español](docs/es.md).

## How it works

- The container reads the sources on its own timer (the devices are published with `should_poll: false`), at a pace
  that follows the status: every 15 minutes out for delivery, every hour in transit, never once delivered.
- **DHL**: 250 requests a day and one every 5 seconds on the free plan. The integration stops at 240 a day, spaces
  its requests by 5 seconds, and stretches the interval when many DHL parcels share the day.
- **17TRACK**: only the registration of a new number spends quota, once per parcel; the readings are free and batched
  (40 numbers per request). The free plan's registrations are limited (200 granted once to new accounts, according
  to the 17TRACK help center): "Read the parcels now" shows what is left.
- Statuses are normalized from 17TRACK's main status, and from DHL's `statusCode` plus the wording of the event
  (DHL has no "out for delivery" or "ready for pickup" code). The carrier's text is kept as it is.
- Scene triggers fire once per status change; the state is kept in `/data`, so a restart fires nothing again.
- UPS, FedEx and USPS also have official APIs, but they need a business account and OAuth: they go through 17TRACK.
  parcelsapp.com inspired the user experience (carrier detection, unified timeline); nothing is taken from it.

## Limitations

- Developed without the accounts: the first real answers may show wordings or fields the simulation did not cover.
- One device per parcel stays in Gladys after the parcel is archived (an integration cannot delete a device): the
  user deletes it.
- DHL's "out for delivery" and "ready for pickup" are inferred from English and German wordings.
- 40 tracked parcels at most. Carriers that need a postal code or a phone number to track are not supported.

## Development

```bash
npm install
npm test                 # node --test, against the SDK's fake Gladys and simulated APIs
npm run lint
npm run format:check
SEVENTEENTRACK_KEY=… DHL_KEY=… node scripts/probe.mjs   # real APIs, read only, never prints a key
npx github:GladysAssistant/integration-store .           # store admission checks
```

See [CLAUDE.md](CLAUDE.md) for the architecture and the pitfalls of the Gladys core.

## Credits

- The Home Assistant [`seventeentrack`](https://www.home-assistant.io/integrations/seventeentrack/) integration
  (Apache 2.0) and its library [pyseventeentrack](https://github.com/shaiu/pyseventeentrack) (MIT): the idea of the
  normalized statuses; nothing was copied (they use the 17TRACK user account, not the tracking API).
- [RomaBilka/parcel-tracking](https://github.com/RomaBilka/parcel-tracking) (MIT): the real DHL Unified answers used
  as test fixtures.
- [@be-link/17trak-api-sdk](https://github.com/snowmountain-top/17TrackAPI) (ISC): the field names and error codes of
  the 17TRACK tracking API, used to build the test fixtures.

## License

Apache 2.0, see [LICENSE](LICENSE). Not affiliated with the carriers or 17TRACK. 17TRACK, DHL and the carrier names
are trademarks of their owners.
