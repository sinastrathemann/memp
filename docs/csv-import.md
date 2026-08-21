# CSV-Import (Alternative zu Graph-API)

Solange keine Azure-App-Registrierung mit Admin-Freigabe verfügbar ist (siehe
`docs/sharepoint-integration.md` → Setup-Schritt „Administratorzustimmung erteilen"),
funktioniert der Studi-Import auch komplett ohne Azure/OAuth: manueller wöchentlicher
CSV-Export aus SharePoint + Upload in mEXP.

## Wöchentlicher Workflow

1. **In SharePoint**: die Studi-Liste öffnen → Toolbar oben → **In Excel exportieren**
   (bzw. „Export" → „Export to CSV", je nach SharePoint-Ansicht)
2. Datei speichern (z.B. `studis-2026-KW29.csv`)
3. **In mEXP**: Benutzerverwaltung (`/admin/users`) → Button **📄 Studi-CSV importieren**
   → Datei auswählen
4. Upload läuft automatisch nach Dateiauswahl → Ergebnis-Anzeige: „X Zeilen · Y neu ·
   Z aktualisiert" (ggf. „· N ohne E-Mail übersprungen")

## Endpoint

`POST /api/admin/users/import-csv` (Admin-only, requireMexpRole("admin") — echte
Hub-Admins eingeschlossen, siehe `apps/api/src/routes/admin-users-import.ts`)

Akzeptiert drei Content-Types:
- `multipart/form-data` mit Feld `file` (das nutzt der Button in der Web-UI)
- `text/csv` oder `text/plain` mit dem CSV-Inhalt als Rohtext im Body
- `application/json` mit `{"csv": "..."}`

## Verhalten (Sinas Design-Entscheidungen)

- **Neue E-Mail** → mEXP-User wird neu angelegt mit Rolle `participant` (bewusst nicht
  `werkstudent` — konservative Default-Rolle, analog zum SharePoint-Graph-Sync) und
  `isActive=true`.
- **Bekannte E-Mail** (Match gegen bestehenden mEXP-User) → Update von Position/Team,
  die **Rolle wird nicht überschrieben** (der User könnte bereits z.B. über Personio mit
  einer anderen Rolle bekannt sein).
- **Kein Reverse-Sync / keine Auto-Deaktivierung**: anders als beim Personio- und
  SharePoint-Graph-Sync (`admin-personio.ts`, `admin-sharepoint.ts`) deaktiviert der
  CSV-Import KEINE User automatisch, nur weil sie in der aktuellen CSV fehlen. Grund:
  Sina importiert CSVs teilweise (nicht zwingend immer die komplette Liste) — ein
  fehlender Eintrag heißt hier nicht „ausgeschieden". Deaktivierung bleibt bewusst
  manuell über den „Deaktivieren"-Button in der Benutzerverwaltung.
- Jeder importierte/aktualisierte User bekommt `csvImportedAt` gesetzt (Timestamp,
  analog zu `personioSyncedAt`/`sharepointSyncedAt`) — sichtbar als Badge „CSV-Import"
  in der Benutzerliste.

## Unterstützte Spalten (Header-Aliases)

Deutsch/Englisch gemischt ok — der Parser probiert pro Feld mehrere Spaltennamen und
nimmt den ersten nicht-leeren Treffer (case-insensitive Fallback inklusive):

| Feld          | Kandidaten                                                        |
|---------------|--------------------------------------------------------------------|
| `firstName`   | `Vorname`, `First Name`, `FirstName`, `Given Name`                  |
| `lastName`    | `Nachname`, `Last Name`, `LastName`, `Surname`                      |
| `displayName` | `Name`, `Vollständiger Name`, `Full Name`, `DisplayName`, `Title` (Fallback: Vor-+Nachname, sonst E-Mail) |
| `email`       | `E-Mail`, `Email`, `EMail`, `E-Mail-Adresse`, `Mail`                |
| `position`    | `Position`, `Rolle`, `Typ`, `Art`, `Stelle`                         |
| `team`        | `Team`, `Bereich`, `Abteilung`, `Department`                        |

Neue Kandidaten ergänzen: in `FIELD_ALIASES` (oben in `admin-users-import.ts`) den
Spaltennamen an der gewünschten Position im jeweiligen Array einfügen.

## Format-Details

- Delimiter: `,` oder `;` — wird automatisch anhand der Header-Zeile erkannt
- Encoding: erwartet UTF-8 (mit oder ohne BOM)
- Quoted values (`"Meier, Anna"`) werden korrekt geparst, inkl. escaped Quotes (`""`)
- Header muss in der ersten Zeile stehen
- Zeilen ohne E-Mail werden übersprungen (kein User-Match möglich) und im Ergebnis als
  `skippedNoEmail` gezählt

### Wenn Umlaute (ä ö ü ß) als Mojibake ankommen

Der Parser konvertiert **keine** Zeichensätze — er erwartet UTF-8. Excel exportiert CSV
je nach Version/Einstellung manchmal in Windows-1252 statt UTF-8, was Umlaute kaputt
macht. Workaround: beim Speichern in Excel explizit **„CSV UTF-8 (durch Trennzeichen
getrennt)"** als Dateityp wählen (statt „CSV (Trennzeichen-getrennt)").

## Manueller Test (curl)

```bash
printf 'Vorname;Nachname;E-Mail;Position;Team\nAnna;Meier;anna.meier@mindsquare.de;Werkstudent;IT\n' > /tmp/test-studis.csv
curl -X POST http://127.0.0.1:3000/api/admin/users/import-csv \
  -H "X-MSQ-User-Id: sina" -H "X-MSQ-Roles: AppHub.Admin" \
  -F "file=@/tmp/test-studis.csv"
```

Erwartete Antwort: `200`, `{"ok":true,"total":1,"created":1,"updated":0,...}`.
