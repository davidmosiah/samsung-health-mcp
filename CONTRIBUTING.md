# Contributing

Contributions are welcome, especially around Samsung Health export parsing, privacy-safe summaries, tests, docs and agent setup examples.

## Local development

```bash
npm ci
npm run typecheck
npm run build
npm run smoke
npm run smoke:http
```

## Design rules

- Keep the project explicitly unofficial and unaffiliated with Samsung.
- Never commit Samsung Health exports, generated health data or local user files.
- Prefer local fixture coverage over network-dependent behavior.
- Tools should return both text content and structured content when useful.
- Error messages should be actionable without revealing private data.
- Workflow summaries should be framed as wellness context, not medical advice.

## Pull request checklist

- `npm run typecheck` passes.
- `npm run build` passes.
- `npm run smoke` passes.
- `npm run smoke:http` passes when HTTP behavior changes.
- README/tools docs are updated when behavior changes.
