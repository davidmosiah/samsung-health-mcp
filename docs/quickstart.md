# Samsung Health MCP Quickstart

1. Export Samsung Health data from the Android Samsung Health app.

   `Samsung Health -> More options -> Settings -> Download personal data`
2. Transfer `export.zip` to this machine.
3. Run:

```bash
npx -y samsung-health-mcp-unofficial setup --export-path /path/to/SamsungHealth
npx -y samsung-health-mcp-unofficial doctor
```

For the lowest-friction local import after transferring the export to this Mac:

```bash
npx -y samsung-health-mcp-unofficial setup --auto-import
```

This scans `Downloads`, `Desktop` and `Documents`, copies the newest Samsung Health folder/CSV/ZIP export into `~/.samsung-health-mcp/exports/`, and stores that managed path.

Then add the MCP client config from the README.
