# Security Policy

## Sensitive Data

Samsung Health exports can include highly sensitive health data. Do not share:

- Samsung Health personal-data CSV files
- `export.zip`
- Samsung Health export directories
- Raw health records
- Local MCP config files that reveal personal filesystem paths

The connector is designed to read local files and return bounded summaries or filtered records. It does not need Samsung account credentials and does not provide live Samsung Health access.

## Reporting Issues

Open a GitHub issue for security-relevant behavior without attaching private health exports. Use synthetic fixtures when possible.
