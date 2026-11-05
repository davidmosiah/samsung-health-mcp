# Samsung source timestamps, units and record identity

Recognized `com.samsung.health.*` / `com.samsung.shealth.*` CSV tables now read
zone-less measurement/creation timestamps as UTC, without applying time_offset a
second time. Explicit offsets remain explicit. Generic CSV names retain their
previous offset interpretation. This changes incorrect historical values for
Samsung-prefixed exports; it does not reinterpret all generic CSV formats.

Samsung exercise duration is milliseconds and default distance is metres,
including short workouts and distances below 100 m. Explicit distance units take
precedence (including km values above 100). Canonical step_daily_trend source_type
-2 rows additionally provide daily distance in km; per-device rows do not add a
second distance total. Existing calendarDate grouping is preserved.

Sources: [Samsung time FAQ](https://developer.samsung.com/health/android/faq.html),
[Exercise API](https://developer.samsung.com/health/android/data/api-reference/com/samsung/android/sdk/healthdata/HealthConstants.Exercise.html),
[StepDailyTrend API](https://developer.samsung.com/health/android/data/api-reference/com/samsung/android/sdk/healthdata/HealthConstants.StepDailyTrend.html).
SDK semantics applied to matching CSV export tables are a connector interpretation,
not a claim that Samsung publishes a universal CSV specification.

`calories_burned.details` uses only the explicit active_calorie field, never a
suffix-matched tef_calorie/rest_calorie substitute. Its day_time uses calendarDate.
This table mapping follows the export-format problem reported in PR19; no public
SDK contract for that internal table was located. Missing active_calorie yields
no active-energy record instead of guessing from another calorie column.

## Conservative duplicate policy
Only recognized exercise records with the same unambiguous explicit UUID/datauuid
and identical source fields (before numeric rounding) are collapsed
within a parse. A private ephemeral SHA256 fingerprint is used; identifiers are
not added to output or persisted. Device UUID is never a session identity.
Different IDs, missing/ambiguous IDs, or conflicting payloads remain separate,
including sub-rounding numeric changes and different device/source fields. The
export filename is excluded; identical records copied between files can collapse.
By default no overlap threshold or rounding heuristic merges potentially distinct sessions.
Accordingly, counts may include phone/watch copies when their identities differ;
this uncertainty cannot be safely solved from temporal overlap alone.

[Samsung Common API](https://developer.samsung.com/health/android/data/api-reference/com/samsung/android/sdk/healthdata/HealthConstants.Common.html)
distinguishes a record's unique ID from a source device identifier. CSV aliases
are accepted conservatively; unsupported identifiers simply disable deduplication.

### Overlapping workouts: reported by default, merged only on request

Daily and weekly summaries flag a workout as a possible duplicate when it covers
at least 80% of a longer workout of the same activity type, the shape of a copy
another app writes back through Health Connect. By default flagged workouts are
still counted and only reported (`workouts.possible_duplicates`,
`totals.possible_duplicate_workouts`), so default totals stay faithful to the
export. `SAMSUNG_HEALTH_MERGE_OVERLAPPING_WORKOUTS=true`, or
`merge_overlapping_workouts: true` on the summary tools, counts each flagged
workout once and keeps the longest record. Back-to-back sessions and sessions
that overlap by half never reach the 80% share. The raw workout listing and the
parser are not affected.

Related: [PR19](https://github.com/davidmosiah/samsung-health-mcp/pull/19) by hitomi1
and issue18. This implementation and synthetic tests were authored independently
on current main; no external-contributor code or real exports were executed.
The overlap-based proposal in PR19 is intentionally not adopted, so do not close
that proposal as fully incorporated without separately reconciling its scope.

Incremental cursor schema advances from 2 to 3. The next incremental read
invalidates old cursors even if the export path/mtime is unchanged, so corrected
UTC readings are not skipped behind a previously offset timestamp. Consumers
may receive previously imported records again and must reconcile their own stores.
