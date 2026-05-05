# Changelog
All notable changes to Table-Talk are documented in this file.

## 2026-05-05
### Fixed
- Dual Mode: “Start Fresh” now forces the remaining partner into a Waiting screen (session stays active until mutual confirmation or midnight cleanup).
- Dual Mode: Waiting screen copy now distinguishes “Start Fresh requested” vs “switched to Single Mode”.
- Dual Mode: one-scan join reliability (Phone A no longer stuck on “Waiting for Partner” after Phone B joins).
- Dual Mode: rejoining from Waiting now transitions both phones back to the synced paired session.
- Dual Mode: tap-to-reveal synchronization via socket events.
- Dual Mode: context switching restored via mutual intent + server-authoritative update.
- Session cleanup behavior refined for Dual/Single flows (timeouts and termination rules).

## 2026-05-04
### Fixed
- DigitalOcean routing: production HTTP API calls use `/api` and socket.io uses `/api/socket.io/` to match ingress rules.
- Socket.io production URL handling moved to same-origin (no hardcoded app domain).
- PostgreSQL SSL robustness improvements for DigitalOcean (certificate-chain handling and `sslmode` compatibility).

### Changed
- Deployment/runtime wiring adjustments (Procfile and dependency/lockfile sync) to stabilize builds.
