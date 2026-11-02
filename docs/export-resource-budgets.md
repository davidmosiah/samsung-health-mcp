# Samsung export resource budgets

Reads now fail closed, without partial data, when one operation exceeds:
- 64 MiB of decoded CSV bytes per file;
- 256 MiB of decoded CSV bytes across the selected export;
- 10,000 filesystem/ZIP entries enumerated (including ignored sidecars);
- 2,000,000 CSV cells parsed across the operation, including headers/empty cells.

These fixed defaults apply to MCP calls; arguments or environment variables cannot
raise them. Oversized exports need splitting into smaller date ranges/files before
retrying. This deliberately changes previously unbounded imports. Ordinary values,
CSV formats, privacy modes and timestamp semantics are unchanged.

Directory traversal uses a streaming iterator and retains the previous six-level
recursion limit; nested symlinks are not followed. CSV files are read sequentially. Unreadable nested directories now abort the
operation rather than silently omitting their data.
Declared file/ZIP sizes are checked before opening the content; actual decoded
stream bytes are checked before retaining each chunk, so changing files and false
ZIP size metadata cannot bypass byte accounting. Streams and ZIP readers close on
failure. ZIP file-name validation is strict: malformed/traversal/backslash entry
names are rejected rather than normalized. No ZIP entries are extracted to disk.

The tests use tiny synthetic archives and injected smaller internal budgets. They
cover exact boundaries, aggregate bytes, ignored-entry enumeration, malformed ZIP
metadata/paths, stream cleanup and dense CSV cells. No real health export or
large compressed payload is used.

These are per-operation resource ceilings, not an overall RAM/CPU guarantee.
String/array/object overhead, cached snapshots and concurrent requests require
separate process/deployment limits. Authentication and provider access are unchanged.
