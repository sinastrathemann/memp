# mEXP — mindsquare Experience Platform

Interne HR-zentrierte Event-Plattform für mindsquare AG. Deckt den Lifecycle interner Events (Schulungen, Workshops, Feelgood-Events, Bereichsevents, mindsquare-Events, …) ab: Portfolio, Teilnehmerverwaltung, Budget, Dokumente, Check-in, Reporting.

## Container

- 📦 **Package**: https://mindcode.mindsquare.de/sina.strathemann/-/packages/container/mexp
- Image-Ref zum Einhängen in den Agent Hub:

  ```
  mindcode.mindsquare.de/sina.strathemann/mexp:latest
  ```

Für eine pinned Version den SHA-Tag des gewünschten Commits verwenden (z. B. `:sha-2b079d0`).

Das Image wird **lokal** gebaut und veröffentlicht — der mindcode-Runner kann
keine Container bauen. Der Ablauf steht im [Runbook](docs/runbook.md#deploy).

## Deployment

mEXP läuft als **Managed Agent** im mindsquare Agent Hub — SSO über Entra ID, Container-Lifecycle managed vom Hub. Onboarding-Details siehe [`docs/agent-hub-integration.md`](docs/agent-hub-integration.md).

## Lokale Entwicklung

```bash
pnpm install
pnpm dev            # API + Web parallel
# oder:
pnpm dev:api        # nur API auf :3000
pnpm dev:web        # nur Web auf :8080
```

Standardmäßig läuft die App lokal mit `AUTH_MODE=dev-bypass` — der User aus [`config/dev-user.yaml`](config/dev-user.yaml) wird als angemeldet simuliert. Anpassen für Rollen-Switches.

## Stack

- **Runtime**: Node.js 22, TypeScript 5 strict, ES Modules
- **Backend**: Hono, Zod, `@hono/node-server`
- **Frontend**: Vite + React + TanStack Query + react-i18next
- **Persistence**: Docker-Volume `/app/data` (JSON-Files via `persistentMap`); Postgres via Drizzle folgt in Phase 2
- **Auth**: `X-MSQ-*`-Header vom Agent Hub → `packages/auth` Middleware
- **Tooling**: pnpm workspaces, Biome, Vitest

## Verzeichnisstruktur

- `apps/api/` — Hono HTTP-API (serviert außerdem die gebauten Web-Assets)
- `apps/web/` — React UI
- `packages/{domain,application,infrastructure,auth,shared,llm,mcp}/` — Fachlogik, DB, M365-Adapter, Utilities
- `docs/mindCoder/` — Design-Specs und Implementierungspläne
- `docker/` — Dockerfile (Multi-Stage, produziert das GHCR-Image)

## Commands

- `pnpm dev` / `pnpm dev:api` / `pnpm dev:web` — lokale Entwicklung
- `pnpm build` — Packages + Apps bauen
- `pnpm lint` / `pnpm -r typecheck` — Qualitäts-Checks
- `pnpm -r test` — Vitest
- `docker build -f docker/Dockerfile -t mexp:local .` — lokales Container-Image

## Referenzen

- [Architektur](docs/architecture.md)
- [Datenklassifikation](docs/data-classification.md)
- [Runbook (Deploy, Rollback)](docs/runbook.md)
- [Agent-Hub-Integration](docs/agent-hub-integration.md)
- [Design-Specs](docs/mindCoder/specs/) und [Implementierungspläne](docs/mindCoder/plans/)
