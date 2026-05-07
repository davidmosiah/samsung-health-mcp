# Hermes Example

```bash
npx -y samsung-health-mcp-unofficial setup --client hermes --export-path /path/to/export.zip
npx -y samsung-health-mcp-unofficial doctor --client hermes
```

Or, after transferring the export to `Downloads`, `Desktop` or `Documents`:

```bash
npx -y samsung-health-mcp-unofficial setup --client hermes --auto-import
```

Reload with `/reload-mcp` or:

```bash
hermes mcp test samsung_health
```
