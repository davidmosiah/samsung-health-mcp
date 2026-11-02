# Input resource boundaries

The MCP SDK is configured to reject tool arguments exceeding 10,000 combined
object members and array elements before tool-schema processing, over both stdio
and HTTP. This is not a general process-memory guarantee: message bytes, handshake
structures, concurrency and deeply nested JSON still need deployment-level limits.

HTTP JSON requests remain limited to 1 MiB. Compressed request bodies (gzip,
deflate and Brotli) now return 415 rather than being inflated. Send uncompressed
JSON; ordinary UTF-8 and uncompressed UTF-16 JSON remain supported. Invalid JSON
returns 400 and oversized bodies 413 without terminating the server.

HTTP remains local-first and unauthenticated on loopback by default. These limits
do not make a public unauthenticated listener safe. No authentication permission,
review requirement, security setting or provider credential is changed.

Dependency updates raise SDK/Zod and vulnerable transitive override versions. Audit and tests are reported
for an exact local lockfile, not as a permanent guarantee against future advisories.
