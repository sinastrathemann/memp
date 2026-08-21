# SharePoint-Integration (Werkstudenten & Praktikanten)

Manueller Sync für Werkstudenten/Praktikanten, die NICHT in Personio geführt werden,
sondern in einer SharePoint-Liste. Analog zur Personio-Integration (siehe
`docs/personio-integration.md`), aber über Microsoft Graph statt der Personio-REST-API
(siehe `docs/architecture.md` für den Gesamtkontext, `docs/data-classification.md` für
die Datenschutz-Einordnung).

## Setup: Azure App Registration

Diese Schritte führt jemand mit Azure-Portal-Zugriff (Entra ID Admin, z.B. Tobias) aus.

1. **Azure Portal** → **Entra ID** → **App-Registrierungen** → **Neue Registrierung**
   - Name: `mEXP-SharePoint-Sync`
   - Kontotyp: „Nur Konten in diesem Organisationsverzeichnis" (single tenant)
   - Redirect-URI: keine nötig (App-only, kein User-Login)
2. Nach dem Anlegen notieren:
   - **Anwendungs-ID (Client-ID)** — auf der Übersichtsseite der App-Registrierung
   - **Verzeichnis-ID (Tenant-ID)** — ebenfalls auf der Übersichtsseite
3. **Zertifikate & Geheimnisse** → **Neuer geheimer Clientschlüssel**
   - Beschreibung: `mEXP-Sync`, Ablauf nach Bedarf (z.B. 24 Monate)
   - **Wert** sofort kopieren (wird danach nicht mehr angezeigt) → das ist das **Client-Secret**
4. **API-Berechtigungen** → **Berechtigung hinzufügen** → **Microsoft Graph** → **Anwendungsberechtigungen**
   - `Sites.Read.All` hinzufügen
   - **Administratorzustimmung erteilen** (Admin-Consent) — Pflicht bei App-only-Zugriff,
     ohne diesen Klick bleiben alle Graph-Requests mit `403 Forbidden` stehen
5. Die drei Werte (Tenant-ID, Client-ID, Client-Secret) an Sina weitergeben (sicherer Kanal,
   nicht per Chat/Mail im Klartext).

## Env-Vars eintragen

In `.env`:
```
AZURE_TENANT_ID=<verzeichnis-id>
AZURE_CLIENT_ID=<anwendungs-id>
AZURE_CLIENT_SECRET=<client-secret>
SHAREPOINT_SITE_URL=https://mindsquare1.sharepoint.com/sites/fk/tl
SHAREPOINT_STUDIS_LIST_ID=c2364bea-6f17-4532-b1ca-ebd9dee40c13
```
`SHAREPOINT_SITE_URL` und `SHAREPOINT_STUDIS_LIST_ID` haben bereits Defaults (siehe
`packages/shared/src/env.ts`) — die beiden müssen nur bei einem anderen Standort/Liste
überschrieben werden. API danach neu starten (`pnpm dev:api`), damit die neuen Werte
geladen werden.

## Nutzung

- In der Web-UI → **Benutzerverwaltung** → Button **🎓 SharePoint-Studis synchronisieren**
  (neben dem Personio-Sync-Button)
- Der Sync (E-Mail-Match zwischen SharePoint-Listeneintrag und mEXP-User):
  - Neue Studis/Praktikanten in der Liste → auto als mEXP-User mit Rolle `participant`
    (Sinas bewusste, konservative Wahl — nicht `werkstudent`)
  - Bestehende → Update von Position/Team; die Rolle wird NICHT überschrieben (falls der
    User bereits über Personio mit einer anderen Rolle bekannt ist)
  - Aus der SharePoint-Liste verschwundene Studis (Vertragsende) → in mEXP deaktiviert
    (`isActive=false`), NICHT gelöscht — historische Teilnahmen bleiben erhalten
  - Einträge ohne E-Mail-Adresse werden übersprungen (kein Match gegen mEXP-User möglich)
    und im Ergebnis als `skippedNoEmail` gezählt
- Der Sync läuft manuell per Button (kein CRON) — Sinas bewusste Design-Entscheidung, analog
  zu Personio.
- Ohne gesetzte `AZURE_TENANT_ID`/`AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET` antwortet der
  Endpoint mit `400 sharepoint_not_configured` — die App bootet trotzdem normal
  (SharePoint-Sync ist optional).

## Field-Mapping (tolerantes Fallback-Verfahren)

Wir kennen die exakten Spaltennamen der SharePoint-Liste nicht im Voraus — SharePoint
liefert über die Graph-API immer die **internen** Spaltennamen (die von den in der UI
sichtbaren **Anzeigenamen** abweichen können, z.B. deutsch angezeigt, aber intern
englisch benannt). `SharePointClient` (`packages/infrastructure/src/sharepoint/sharepoint-client.ts`)
probiert daher pro semantischem Feld eine Liste von Kandidaten-Spaltennamen der Reihe
nach durch und nimmt den ersten nicht-leeren Treffer:

| Semantisches Feld | Kandidaten (in Priorität)                                         |
|--------------------|---------------------------------------------------------------------|
| `firstName`        | `Vorname`, `FirstName`, `First_x0020_Name`, `field_1`               |
| `lastName`         | `Nachname`, `LastName`, `Last_x0020_Name`, `field_2`                |
| `displayName`      | `Title`, `LinkTitle`, `Name`, `field_3` (Fallback: Vor-+Nachname)   |
| `email`            | `EMail`, `Email`, `E_x002d_Mail`, `E-Mail`, `Mail`, `field_4`       |
| `position`         | `Position`, `Rolle`, `Typ`, `Art`, `Bereich`                        |
| `team`             | `Team`, `Abteilung`, `Bereich`                                      |
| `endDate`          | `EndDatum`, `Vertragsende`, `Ende`, `EndDate`, `Bis`                 |

Neue Kandidaten ergänzen: in `FIELD_CANDIDATES` (oben in `sharepoint-client.ts`) den
Spaltennamen an der gewünschten Prioritätsposition in das jeweilige Array einfügen.

## Post-Sync-Debug: fehlende Felder finden

Falls nach einem Sync Felder leer bleiben (z.B. `position` immer `null`), die exakten
internen Spaltennamen der Liste per Graph-Explorer oder curl abrufen:

```
GET https://graph.microsoft.com/v1.0/sites/{site-id}/lists/{list-id}/items?expand=fields&$top=1
```

Jeder `StudiRecord` trägt zusätzlich `rawFields` — das komplette, ungefilterte
`fields`-Objekt aus der Graph-Response. Ein `log.info({ rawFields }, ...)` direkt vor
dem Push in `SharePointClient.listStudis()` (temporär auskommentiert einfügen) zeigt
die tatsächlichen internen Spaltennamen der Liste — danach `FIELD_CANDIDATES` um den
fehlenden Namen ergänzen und erneut syncen.

## Hub-Deployment

Im Hub-Admin-UI unter **Container-Einstellungen** die drei Azure-Env-Vars setzen —
Secrets werden verschlüsselt gespeichert. `SHAREPOINT_SITE_URL`/`SHAREPOINT_STUDIS_LIST_ID`
nur setzen, falls sie vom Default abweichen sollen.

## Datenschutz

Nur die für Event-Management nötigen Felder werden gesynct (Name, E-Mail, Position,
Team, Vertragsende). Kein Gehalt, keine sonstigen HR-Daten. Details in
`docs/data-classification.md`.

## Technische Referenz

- Client: `packages/infrastructure/src/sharepoint/sharepoint-client.ts` (`SharePointClient`)
  — Client-Credentials-Token-Auth (gecacht ~50min), Site-Id-Auflösung, paginiertes
  `GET .../lists/{list-id}/items`, Response via Zod geparst
  (`packages/infrastructure/src/sharepoint/sharepoint.types.ts`).
- Endpoint: `POST /api/admin/sharepoint/sync-studis`
  (`apps/api/src/routes/admin-sharepoint.ts`), Admin-only (`requireMexpRole("admin")`) —
  echte Hub-Admins sind eingeschlossen.
- User-Modell-Erweiterung: `MexpUser` in `apps/api/src/routes/_user-resolution.ts` um
  `sharepointStudiId`, `sharepointSyncedAt` (alle optional — bestehende, nicht
  SharePoint-verknüpfte User bleiben unverändert; `position`/`team` werden mit
  Personio geteilt).
- Frontend: Button + Ergebnis-Badge in `apps/web/src/pages/admin-users.tsx`, neben dem
  Personio-Sync-Button; Übersetzungen in `apps/web/src/locales/{de,en}.json`
  (`admin.sharepointSync*`).
