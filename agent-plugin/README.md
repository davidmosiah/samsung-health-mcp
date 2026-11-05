# Samsung Health — Agent Plugins package

Unofficial portable [Agent Plugins](https://agent-plugins.org/) v1 package for
[Hermes Agent](https://github.com/NousResearch/hermes-agent): the `samsung-health`
MCP server (`samsung-health-mcp-unofficial@0.8.0` over stdio) and the
`samsung-health-mcp` workflow skill. Not affiliated with or endorsed by Samsung.
This is not medical advice or a live Samsung Health integration.

## Release gate

Catalog submission is on hold for the current npm pin. Repository fixes do not
change the published `0.8.0` executable. A corrected npm release, a new portable
pin, and fresh install tests are required before submission. In `0.8.0`,
`setup --client hermes` can disable the MCP reload confirmation in an existing
Hermes config; do not use that setup route. Its profile reads can migrate a legacy
profile to shared storage, and its cache-clear tool lacks an enforced intent gate.

## Install (Hermes Agent)

```bash
hermes plugins install davidmosiah/samsung-health-mcp/agent-plugin --no-enable
hermes plugins enable samsung-health-mcp
```

Requires Node.js 20+ (`npx` on PATH). The skill loads as
`samsung-health-mcp:samsung-health-mcp`. This repository install is not a catalog
listing. Review the release gate above before enabling it with personal data.

## Connector setup

Download personal data in the Samsung Health app (Settings → Download personal
data). Transfer only that export to this machine. Select the exact export file or
dedicated export folder, not a broad folder containing other personal files:

```bash
npx -y samsung-health-mcp-unofficial@0.8.0 setup --import /absolute/path/to/SamsungHealth-export.zip --timezone <IANA-zone>
npx -y samsung-health-mcp-unofficial@0.8.0 doctor
```

This generic setup stores connector configuration. The portable plugin already
supplies its MCP entry and skill, so it does not need `setup --client hermes`.
Follow Hermes's normal approval prompts; do not disable approval settings.

## Disclosure

- **Executable and network:** Hermes starts `npx`, which downloads the exact npm
  package version above and its dependencies from npm when absent from cache. The
  tool implementation comes from that npm version, not the repository's source
  tree or catalog SHA. Dependency resolution is npm's. There is no self-updater,
  Samsung login, OAuth, credential store, cloud sync, or connector telemetry.
- **Health-data sharing:** the connector parses exports locally and returns health
  records, summaries and local paths to the MCP client. That client may send tool
  output to its configured model/provider. Local parsing does not guarantee that
  health data stays on the device. Never paste raw exports or credentials in chat.
- **Reads and copies:** explicit import reads the chosen CSV, ZIP or directory and
  copies it under `~/.samsung-health-mcp/exports/`. A directory import copies the
  directory's contents, not just recognized Samsung CSV files. Optional
  `--auto-import` searches `~/Downloads`, `~/Desktop` and `~/Documents`, including
  nested folders, and can choose a folder containing CSV files. Prefer the explicit
  export path above. The source export is not deleted.
- **Local state:** configuration and source paths are plaintext at
  `~/.samsung-health-mcp/config.json`; incremental parsing timestamps and export
  metadata are at `~/.samsung-health-mcp/incremental-cache.json`. Parsed records are
  also cached in process memory. The wellness profile is plaintext shared storage
  at `~/.delx-wellness/profile.json`, used by the author's other connectors. Legacy
  profile locations are `~/.hermes/profiles/delx-wellness/wellness-profile.json` and
  `~/.openclaw-delx-wellness/workspace/wellness-profile.json`; version `0.8.0` may
  migrate them on a profile read. These HOME-based locations are outside
  `${PLUGIN_DATA}` and are not isolated by changing the Hermes profile or plugin
  working directory. Use a separate OS account/HOME for separate health datasets.
- **Client configuration:** Hermes-specific diagnostics read
  `~/.hermes/config.yaml` and the connector's installed skill to check setup. The
  optional legacy `setup --client hermes` route writes that config, a backup, and
  `~/.hermes/skills/samsung-health-mcp/SKILL.md`; it is not needed by this plugin.
- **State-changing tools:** `samsung_health_profile_update` updates the shared local
  profile; `samsung_health_reimport` may promote a new export path and update
  config/cache; `samsung_health_clear_incremental_cache` resets local cache
  metadata. Ask before changing or clearing state. Current `0.8.0` profile reads
  can also write through legacy migration, as noted above.
- **Processes and transports:** the local server runs while the MCP client keeps
  it alive. Configuring a watch folder enables automatic export-path promotion at
  startup; HTTP mode also uses a live filesystem watcher. Both may update local
  config/cache without a separate tool call. No watch folder is configured by
  this package. The standalone connector also has an optional loopback-only HTTP
  listener through CLI/environment configuration; the portable manifest uses
  stdio, with no listener requested. No background system service is installed.
- **Freshness and limits:** data is only as fresh as the imported export. The
  connector cannot read a phone, Samsung account or Health Connect directly.
  It supports personal reflection, not diagnosis or treatment.
