# mEXP — mindsquare Experience Platform

Interne HR-zentrierte Event-Plattform für mindsquare AG. Deckt den Lifecycle von internen Events (Schulungen, Workshops, Betriebsveranstaltungen) ab: Portfolio, Teilnehmerverwaltung, Budget/Tax, Dokumente, Check-in, Analytics. M365-first, Agent-Hub-Deployment, KI als späterer Zusatz.

## Stack
- TypeScript 5.x strict, ES Modules, Node.js 22
- Monorepo: pnpm workspaces (`apps/*`, `packages/*`)
- Backend: Hono (HTTP), Zod (Validierung), Drizzle ORM (PostgreSQL), BullMQ (Queue/Redis), pino (Logging)
- Frontend: Vite + React + shadcn/ui + TanStack Query + react-i18next (DE default, EN Pflicht)
- Tooling: Biome (Linter + Formatter), Vitest (Tests)
- Observability: OpenTelemetry + pino; Langfuse erst mit AI-Modul (Phase 4)

## Deployment
- **Target**: mindsquare Agent Hub (Managed) — hosted at `https://<hub-domain>/mexp/`
- **Container**: `mindcode.mindsquare.de/sina.strathemann/mexp:latest` — der Hub zieht von mindcode, nicht von GHCR. Image wird **lokal** gebaut und gepusht (Runbook § Deploy); der mindcode-Runner kann keine Container bauen.
- **Repo**: kanonisch auf mindCode (`mindcode.mindsquare.de/sina.strathemann/mexp`); GitHub ist nur noch Spiegel.
- **Auth**: SSO via Hub → Identity in `X-MSQ-*`-Headern; kein eigenes Login-Form
- **State**: Docker-Volume `appdata-mexp-data` → `/app/data`
- **Local Dev**: `AUTH_MODE=dev-bypass` mit User aus `config/dev-user.yaml`
- **Reference**: `docs/agent-hub-integration.md` und `docs/mindCoder/specs/2026-07-15-agent-hub-integration-design.md`

## Verzeichnisstruktur
- `apps/api/` — Hono HTTP-API + Queue-Worker-Entrypoints
- `apps/web/` — React UI (Portfolio, Event Workspace, Teilnehmer, Attendance, Budget, Dokumente)
- `packages/domain/` — Fachmodelle & Regeln: Event, Participant, Budget, Tax, Feedback
- `packages/application/` — Use Cases / Orchestrierung (createEvent, approveBudget, checkIn, ...)
- `packages/infrastructure/` — DB (Drizzle), Queue, M365-Adapter, Storage
- `packages/auth/` — Entra ID OIDC, Rollen, Policies, Middleware
- `packages/shared/` — Logger (pino), Errors, Types, Utils
- `packages/llm/` — LLM Provider Abstraction (Phase 4, vorerst inaktiv)
- `packages/mcp/` — Optionale MCP Server/Clients (Phase 4)
- `config/` — YAML-Konfiguration (agent.yaml, auth.yaml, llm.yaml, mcp.json) + ENV-Overrides
- `specs/` — Mermaid-Diagramme: workflows/, sequences/, states/, domain/
- `docs/` — architecture.md, api.md, data-classification.md, runbook.md
- `docker/` — Dockerfile, docker-compose.yaml, nginx.conf

## Commands
- `pnpm dev` — alle Apps parallel (API + Web)
- `pnpm dev:api` / `pnpm dev:web` — einzeln
- `pnpm build` — Packages zuerst, dann Apps
- `pnpm lint` / `pnpm lint:fix` — Biome check (+ autofix)
- `pnpm typecheck` — TSC über alle Workspaces
- `pnpm test` / `pnpm test:unit` / `pnpm test:int` — Vitest

## Architektur-Regeln
- **Modular Monolith**: fachliche Trennung im Code, wenige deploybare Einheiten. Keine verfrühten Microservices.
- **Kein `any`**. Unbekannte Typen: `unknown` + Zod-Guards.
- **Config-driven**: Schwellenwerte, Fristen, Freigaberegeln, Templates nie hardcoden — immer `config/*.yaml`.
- **Jede API-Grenze geht durch Zod**: Requests, Responses, ENV, YAML-Configs.
- **Named Exports**. Kein `export default` (Ausnahme: React Pages in `apps/web/src/pages/`).
- **Logging**: nur pino aus `@mexp/shared`, nie `console.log`. PII-Redaction beachten.
- **Fehler**: Custom Error Types aus `@mexp/shared/errors`, nie rohe `throw new Error("...")`.
- **Audit by design**: Jeder fachliche State-Wechsel (Event-Status, Freigabe, Budget, Teilnehmerstatus) schreibt einen Audit-Record.
- **Domain nicht von Infrastructure abhängig**: `packages/domain` importiert NICHTS aus `packages/infrastructure`. Richtung ist domain → application → infrastructure.
- **Use Cases command-orientiert**: `createEvent`, `approveBudget`, `openRegistration`, `checkInParticipant`, `closeEvent`.
- **KI-Regeln (Phase 4)**: Jeder LLM-Call läuft durch `packages/llm/provider`. Kein Modellname im Code. KI darf nie Compliance/Budget/Pflichtteilnahme autonom überschreiben.

## M365-Integration (Microsoft-first)
- **Identity**: Entra ID OIDC für SSO + Gruppenzuweisung
- **Mail/Calendar**: Outlook/Exchange (Einladungen, ICS, Termin-Updates)
- **Teams**: Hinweise, Event-Räume, Hybrid-Links
- **SharePoint**: Dokumentenablage (bevorzugt vor S3)
- **Power BI**: standardisierte Export-Views oder Dataset

## Konventionen
- Dateien: `kebab-case.ts`
- Funktionen: `camelCase`
- Types/Interfaces: `PascalCase`
- Packages: `@mexp/<name>`
- Tests: `*.test.ts` neben Quelldatei ODER in `tests/`
- Mermaid-Diagramme: `.mmd`, Top-Down Flowcharts, Kommentar-Header mit Zweck/Datum/Autor

## Phasen (aus Implementierungsplan)
- **Phase 0** (Setup): Monorepo, Auth-Basis, CI/CD, Specs — *aktuell*
- **Phase 1** (MVP): Event Lifecycle, Teilnehmer, Warteliste, Check-in, Dashboard
- **Phase 2** (Governance): Budget, Freigaben, Audit, Dokumente, Notfalllisten
- **Phase 3** (Standardisierung): Blueprints, Power BI, Portfolio, Feedback
- **Phase 4** (AI): Feedback-Summary, No-Show-Prognose — separates Modul

## Gotchas
- DSGVO-Fachlogik wird bewusst nicht in mEXP verankert — aber PII-Redaction, Audit und Rollen sind Pflicht. Siehe `docs/data-classification.md`.
- Betriebsveranstaltungslogik (Tax-Risk) ist fachlich komplex — vor Phase 2 mit Controlling abstimmen.
- M365-Integrationen sind Phase-0-Risiko: Test-Tenant + technischer Spike vor produktiver Nutzung.
- `packages/llm/` und `packages/mcp/` sind bis Phase 4 nur Gerüst — nicht in Runtime einbinden.

## Referenzen
- Implementierungsplan: `../mEMP_Implementierungsplan_Architektur.docx` (historisches Dateiname, Dokument liegt noch unter altem Namen)
- Anforderungsdokument: `../mEMP_Anforderungsdokument_final.docx` (historisches Dateiname, Dokument liegt noch unter altem Namen)
- Agent Template: `../mindsquare_Agent_Template_2_1 1 1.md`
- Architektur: `docs/architecture.md`
- Datenklassifikation: `docs/data-classification.md`
- Runbook: `docs/runbook.md`
- Spezifikation: `specs/README.md`
- Projektdoku: `mEXP-Doku.md`
