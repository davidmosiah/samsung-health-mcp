# Year-first export dates

The parser accepts year-first YYYY-MM-DD, YYYY/MM/DD or YYYY.MM.DD (consistent
separator), optionally followed by a space/T and H:mm[:ss[.fraction]]. Missing
zone means UTC for this parser; callers retain the documented generic CSV offset
adaptation. An explicit Z or +/-HH:mm / +/-HHmm is preserved, not reapplied.
Fractional seconds retain millisecond precision; extra fractional digits are
truncated, not rounded into another second. Numeric epoch handling is unchanged.

Calendar components are round-trip validated before offset conversion. Invalid
leap days/month lengths, hour24, minute60, second60 and malformed/out-of-range
offsets are rejected rather than normalized. Leap-second notation is unsupported.
Other legacy date strings retain the existing fallback; this is not a wholesale
replacement of every generic CSV/date format.

An invalid timestamp returns no parsed Date, not an exception for the whole export.
Existing undated-record behavior remains: dated queries exclude it; an unfiltered
record query may still expose its metric without a timestamp. This delta does not
change how invalid caller range arguments are handled by existing tool schemas.
