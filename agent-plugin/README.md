# Samsung Health — Agent Plugins package

Portable [Agent Plugins](https://agent-plugins.org/) v1 package for
[Hermes Agent](https://github.com/NousResearch/hermes-agent) and other Agent Plugins clients:
the `samsung-health` MCP server (`samsung-health-mcp-unofficial@0.8.0` over stdio) plus the `samsung-health-mcp` workflow skill.

## Install (Hermes Agent)

```bash
hermes plugins install davidmosiah/samsung-health-mcp/agent-plugin --no-enable
hermes plugins enable samsung-health-mcp
```

Requires Node.js 20+ (`npx` on PATH). The skill loads as `samsung-health-mcp:samsung-health-mcp`.

## Connector setup

```bash
npx -y samsung-health-mcp-unofficial@0.8.0 setup --auto-import --timezone <IANA zone>
npx -y samsung-health-mcp-unofficial@0.8.0 doctor
```

Download the data first in the Samsung Health app (Settings → Download personal data) and copy it to this machine; `setup --import <path>` takes an explicit file or folder.

## Disclosure

Runs the `samsung-health-mcp-unofficial@0.8.0` npm package locally over stdio through `npx` (Node.js 20+ required); the package is downloaded from npm on first start. Data source: no network service: it parses the user's own Samsung Health personal-data CSV/ZIP export on disk. Tools that change state: samsung_health_profile_update (local profile only); samsung_health_reimport (re-reads the local export); samsung_health_clear_incremental_cache (clears the local parsed cache). No live sync: data is as fresh as the last export the user imported. The tool set comes from the pinned npm version, not from this repository's source tree.
