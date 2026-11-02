# Samsung Health 0.8.0 candidate

This is a versioned release candidate in source, **not a published npm artifact**.
The package is `samsung-health-mcp-unofficial`; both existing CLI bin names remain.
Preparation does not create a git tag, GitHub release, npm version or dist-tag.
The final artifact hash, commit, file list, isolated tests and CI must be presented
for explicit publication approval before any registry change.

## Before upgrading from 0.7.4

Back up local configuration, the shared profile and downstream import state without
sharing them. Stop profile writers before maintenance. Test a synthetic export and
review the bounded-input and local-only settings; no real account is required.

### Deployment boundary (breaking)

HTTP binds accept exactly `127.0.0.1`, `::1`, or case-insensitive `localhost`.
`localhost` binds to 127.0.0.1 without DNS resolution; CORS retains the configured
localhost origin. IPv6 URLs are bracketed. Wildcards (`0.0.0.0`, `::`), remote
hostnames, LAN addresses and alternate numeric aliases are rejected. Stdio is
unchanged. Direct LAN access and container wildcard publishing no longer work.
This is deliberately local-first, not OAuth or multi-user authentication. Local
processes are trusted; CORS is not authentication, and a reverse proxy/tunnel can
still expose the local server. Do not use one to bypass this restriction.
No real server, account or network configuration is altered by the source change.

### Data interpretation and replay (breaking)

Recognized Samsung table names interpret zone-less timestamps as UTC without
applying `time_offset` twice. Generic CSV offset behavior is retained. Calendar-day
records use their calendar date, including UTC+12/+14 summaries. Explicit offsets
are preserved; year-first timestamp parsing rejects invalid leap days/rollovers
and keeps milliseconds (additional fractional digits are truncated).
Samsung exercise duration is milliseconds; default distance metres becomes km.
Canonical step totals contribute distance once; explicit active calories are used,
never inferred from resting calories. These corrections can change historical totals.

Incremental cursor schema 3 invalidates older cursors, even for unchanged input
paths/mtimes. Previously imported records may be delivered again. Consumers must
reconcile their own stores before resuming incremental ingestion.
See [source contracts](samsung-source-contracts.md) for qualifications and sources.

Deduplication requires an unambiguous same record UUID/datauuid and identical
source fields before rounding. Filename is not identity; device UUID is not a
session identity. Different or missing IDs and conflicting payloads are retained.
Phone/watch overlap alone does not prove identity: PR19/issue18 remain distinct
open work, not silently closed by this release. Thanks to hitomi1 for those reports;
the integrated corrections and synthetic tests were independently authored.

### Storage and input boundaries

- Profiles: 256 KiB serialized UTF-8, validation on read/write, canonical cooperative
  lock, private atomic writes. All writers must use the protocol. An abandoned lock
  is not stolen; stop writers and inspect it before deliberate manual recovery.
- Existing malformed, oversized, unreadable or symlinked canonical/legacy profiles
  fail closed, not overwritten with defaults. No hostile filesystem race guarantee.
- CSV/ZIP: 64 MiB/file, 256 MiB/operation, 10,000 entries and 2,000,000 cells.
  Oversized imports fail; split a synthetic representative export first if needed.
- HTTP JSON: 1 MiB, no compressed request bodies. MCP input: 10,000 elements.

These are bounded-operation controls, not total-RAM or medical-accuracy guarantees.
Unix symlink fixtures are exercised; Windows privileged symlink fixtures are
skipped. Platform testing limitations must accompany the final artifact approval.

## Release gates and rollback

1. Freeze a reviewed commit; require typecheck/build/full suite, metadata pins,
   input/storage negatives, exact-head CI and installed/lock audits.
2. Build explicitly, then inspect `npm pack --dry-run --json --ignore-scripts` and
   create a local tarball with scripts disabled. Check every packed path and the
   compiled version/bins. Exclude profiles, credentials, exports and transient data.
3. Test the actual tarball in an isolated HOME using synthetic fixtures and local
   stdio/HTTP only. Record SHA-256, npm integrity, file list and tested runtime/OS.
4. Revalidate npm availability and obtain explicit package/version/dist-tag/tag
   approval. Use only the existing authorized publishing mechanism; missing access
   is a blocker, not permission to create tokens or change publisher settings.
5. After an authorized release, verify public registry integrity and cold install
   before claiming issue17 fixed. No npm publication is part of this candidate.

A published npm name/version cannot be overwritten. Prefer a reviewed corrective
version if needed; moving a dist-tag or deprecating a version is another authorized
registry change. Reverting to 0.7.4 would restore known correctness/security gaps
and cannot undo records already imported by consumers. Restore/reconcile backed-up
consumer state deliberately; no automatic rollback or guarantee of zero bugs.
