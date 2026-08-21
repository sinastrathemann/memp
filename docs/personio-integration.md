# Personio-Integration

Manueller HR-Employee-Sync: Mitarbeiter aus Personio werden auf Knopfdruck als
mEXP-User verfügbar, statt manuell angelegt werden zu müssen (siehe `docs/architecture.md`
für den Gesamtkontext, `docs/data-classification.md` für die Datenschutz-Einordnung).

## Setup

1. In Personio einloggen → **Einstellungen** ⚙️ → **Integrationen** → **API-Zugangsdaten**
2. **„Neue API-Zugangsdaten"** anlegen:
   - Name: `mEXP-Employee-Sync`
   - Berechtigungen (read-only): `first_name`, `last_name`, `email`, `status`, `department`, `position`, `office`, `hire_date`, `employment_type`
   - Speichern → einmalig **Client-ID** + **Client-Secret** angezeigt
3. Werte in `.env` eintragen:
   ```
   PERSONIO_CLIENT_ID=<deine-client-id>
   PERSONIO_CLIENT_SECRET=<dein-secret>
   PERSONIO_API_URL=https://api.personio.de/v1
   ```
4. API neu starten (`pnpm dev:api`)

## Nutzung

- In der Web-UI → **Benutzerverwaltung** → Button **🔄 Personio synchronisieren**
- Der Sync (E-Mail-Match zwischen Personio-Employee und mEXP-User):
  - Neue Employees in Personio → auto als mEXP-User mit Rolle `participant`
  - Bestehende → Update von Department, Position, Office, Status
  - In Personio deaktivierte/entfernte User → in mEXP deaktiviert (`isActive=false`),
    NICHT gelöscht — historische Teilnahmen bleiben erhalten
- Der Sync läuft manuell per Button (kein CRON) — Sinas bewusste Design-Entscheidung für den Pilot.
- Ohne gesetzte `PERSONIO_CLIENT_ID`/`PERSONIO_CLIENT_SECRET` antwortet der Endpoint mit
  `400 personio_not_configured` — die App bootet trotzdem normal (Personio ist optional).

## Hub-Deployment

Im Hub-Admin-UI unter **Container-Einstellungen** die drei Env-Vars setzen — Secrets werden verschlüsselt gespeichert.

## Datenschutz

Nur die für Event-Management nötigen Felder werden gesynct. Kein Gehalt, kein Geburtsdatum, keine PII über das nötige hinaus. Details in `docs/data-classification.md`.

## Technische Referenz

- Client: `packages/infrastructure/src/personio/personio-client.ts` (`PersonioClient`) —
  Token-Auth (gecacht ~23h) + `GET /company/employees`, Response via Zod geparst
  (`packages/infrastructure/src/personio/personio.types.ts`).
- Endpoint: `POST /api/admin/personio/sync` (`apps/api/src/routes/admin-personio.ts`),
  Admin-only (`requireMexpRole("admin")`) — echte Hub-Admins sind eingeschlossen.
- User-Modell-Erweiterung: `MexpUser` in `apps/api/src/routes/_user-resolution.ts` um
  `personioId`, `department`, `position`, `office`, `personioStatus`, `personioSyncedAt`
  (alle optional — bestehende, nicht-Personio-verknüpfte User bleiben unverändert).
