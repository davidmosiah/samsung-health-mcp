# Samsung Health 0.8.0 release

[samsung-health-mcp-unofficial@0.8.0](https://www.npmjs.com/package/samsung-health-mcp-unofficial/v/0.8.0)
was published on 2026-11-02; npm `latest` was verified as 0.8.0 at publication.
The [v0.8.0 GitHub release](https://github.com/davidmosiah/samsung-health-mcp/releases/tag/v0.8.0)
points to commit `24ac407fcafb7e80edc09db94793b1c59a8af8fc`.
Both existing CLI bin names remain available.

The published tarball is the reviewed candidate artifact, SHA-256
`c70dee08f4e658d7c47b057bb1bb84a46d6f241d6b01b16d6d333edd570cec62`.
Its bundled documentation retains the preparation-time candidate labels; this
updated guide records the completed publication. The published package and tag
are unchanged—this documentation correction does not replace or republish them.

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
skipped. These platform-testing limitations also apply to the published version.

## Release verification and rollback

The reviewed artifact passed typecheck/build/full suite, installed/lock audits
(zero known vulnerabilities at verification), and Linux CI on Node 20/22/24.
All three CI pack dry-runs reproduced its exact npm integrity. Twelve synthetic
runtime suites exercised the locally installed tarball without recompilation;
independent review checked all 125 packed files and reran selected fixtures.

Public registry readback confirmed version 0.8.0, `latest` and the approved
integrity. GitHub tag v0.8.0 points to the reviewed merge commit above. No real
exports/accounts were used for these checks; this is not a claim that an individual
user's private export or every platform was tested. The main-branch documentation
now reflects release status without modifying the immutable published artifact.

A published npm name/version cannot be overwritten. Prefer a reviewed corrective
version if needed; moving a dist-tag or deprecating a version is another authorized
registry change. Reverting to 0.7.4 would restore known correctness/security gaps
and cannot undo records already imported by consumers. Restore/reconcile backed-up
consumer state deliberately; no automatic rollback or guarantee of zero bugs.
