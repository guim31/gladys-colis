# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Track parcels from every carrier worldwide: 17TRACK (carrier detected from the number) and the official DHL
  "Shipment Tracking - Unified" API, each turned on by its free key. "Track a parcel", "Stop tracking a parcel" and
  "Read the parcels now" in the configuration.
- One device per parcel: status normalized across carriers (registered, in transit, out for delivery, to pick up,
  problem, delivered), last event in the carrier's own words, its place and date, carrier, expected delivery date.
- Reading pace that follows the status (every 15 minutes out for delivery, every hour in transit, never once
  delivered), within the free quotas: 240 DHL requests a day at most, one 17TRACK registration per parcel.
- "My parcels" dashboard widget: status badge, last event and date, history and tracking link on tap.
- Scene triggers: a parcel is out for delivery, delivered, needs you (to pick up or a problem), each with an
  optional parcel filter.
- Scene actions: "Track a parcel" (also finds the number in a mail subject), "Stop tracking a parcel" and "Read my
  parcels".
- A delivered parcel is archived after 7 days (adjustable).
- English, French, German and Spanish everywhere.

[Unreleased]: https://github.com/guim31/gladys-colis/commits/main
