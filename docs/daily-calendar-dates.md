# Samsung daily step dates

Samsung StepDailyTrend.DAY_TIME encodes a calendar date as midnight UTC. Daily
summaries must not translate that date through a timezone or invent a noon-UTC
instant: no single UTC instant represents the same date across UTC-12 through
UTC+14.

For recognized Samsung step_daily_trend rows without start_time, an unambiguous
midnight day_time now adds an optional `calendarDate` (YYYY-MM-DD) to the raw
record. Existing startDate/endDate timestamps remain unchanged. Daily and weekly
step summaries group these rows by that calendar date; structured records expose
that same date. Generic CSV records and explicit non-UTC offset values retain
existing behavior. This is additive raw-record metadata, not a blanket change to
all Samsung timestamps or all daily tables.

Source: [Samsung StepDailyTrend API](https://developer.samsung.com/health/android/data/api-reference/com/samsung/android/sdk/healthdata/HealthConstants.StepDailyTrend.html).
The SDK documents DAY_TIME as a date encoded at 00:00 UTC; applying that meaning
to matching exported rows is an explicit connector interpretation. No real export
was needed for tests. Source UTC timestamp semantics are separately documented in
the [Samsung FAQ](https://developer.samsung.com/health/android/faq.html).

This narrow independently authored correction follows the problem reported in
[PR #19](https://github.com/davidmosiah/samsung-health-mcp/pull/19) by hitomi1. It does
not incorporate or execute that contributor's implementation. The original PR's
other proposed corrections (UTC source interpretation, distance, energy, workout
duration/deduplication) remain separate review items; it must not be closed as
fully superseded by this patch.

Overlapping workouts remain separate unless their existing source data already
identifies them otherwise. Temporal overlap alone does not establish identity.
Tests preserve two overlapping same-type sessions and cover daily/weekly dates at
UTC-12, +12, +14 and a DST transition with synthetic data.

`list_records` start/end filters and inventory timestamp ranges retain their
existing instant-based semantics. `calendarDate` is a grouping hint for daily and
weekly summaries, not a reinterpretation of every query boundary.
