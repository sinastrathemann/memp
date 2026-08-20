# Verwaltungsbereich und Admin-Bootstrap — Design

> Datum: 2026-08-20 · Status: abgestimmt
> Vorbild: Budget-Control-Agent (`personal-hub.mindsquare.de/budget-control-agent`)

## 1. Problem

**Niemand kommt an die Benutzerverwaltung.** In der Hub-Instanz gibt es keinen
einzigen mEXP-Admin. [`resolveMexpRoles`](../../../apps/api/src/routes/_user-resolution.ts)
kennt genau zwei Wege zur Rolle `admin`:

```ts
if (hub.isHubAdmin) return ["admin"];   // braucht AppHub.Admin vom Hub
const known = mexpUserStore.get(hub.id);
if (known) return known.roles;          // muss ein Admin zuweisen
```

Der erste Weg hängt an einer Hub-Rolle, die die App-Eigentümerin nicht selbst
vergeben kann. Der zweite setzt einen bestehenden Admin voraus, den es nicht
gibt. Henne und Ei — die App ist in ihrer eigenen Instanz nicht administrierbar.

**Das Administrative ist verstreut.** Benutzerverwaltung unter `/admin/users`,
Vorlagen unter `/blueprints`, und die drei Import-Wege (Personio-Sync,
SharePoint-Sync, CSV) stecken als Knopfreihe mitten in der Benutzerseite. Wer
etwas verwalten will, muss wissen, wo es liegt.

## 2. Nicht-Ziele

- **Keine feingranularen Rechte** pro Eventtyp oder Bereich, wie sie das
  Budget-Tool mit seinen Kategorien-Häkchen kennt. Erst nötig, wenn jemand
  tatsächlich nur für einen Teilbereich zuständig sein soll.
- **Kein Lieferanten-Reiter.** Lieferanten hängen in mEXP an einer
  Ausschreibung (`/api/vendors/admin?tenderId=…`) und werden im Tender-Panel
  des Events gepflegt. Eine globale Lieferantenliste wäre ein neues Konzept.
- **Kein Audit-Log-Reiter.** Audit-Einträge werden bereits geschrieben, aber es
  gibt keine Leseschnittstelle. Nachrüstbar, sobald klar ist, welche Spalten er
  zeigen muss.

## 3. Teil 1 — Admin-Bootstrap

### Verhalten

Eine Umgebungsvariable benennt Personen, die beim Anmelden `admin` erhalten:

```dotenv
MEXP_BOOTSTRAP_ADMINS=sina.strathemann@mindsquare.de
```

Kommaseparierte Liste von E-Mail-Adressen, Vergleich ohne
Groß-/Kleinschreibung gegen `X-MSQ-User-Email`.

Die Prüfung reiht sich vor der Store-Abfrage ein:

```ts
if (hub.isHubAdmin) return ["admin"];        // regulärer Weg, unverändert
if (isBootstrapAdmin(hub.email)) return ["admin"];   // neu
const known = mexpUserStore.get(hub.id);
```

### Warum E-Mail und nicht Hub-User-Id

Die Hub-User-Id ist eine opake UUID, die man erst herausfinden müsste — über
`/api/me` oder das Container-Log. Die E-Mail kennt die Person, die die Variable
setzt, ohne Umweg. Der Hub garantiert laut Integrationsvertrag A.1.4, dass
`X-MSQ-*`-Header aus einer validierten Session stammen und nicht fälschbar
sind; die E-Mail ist damit eine belastbare Zuordnung.

### Warum das sicher genug ist

Die Variable setzt, wer die App im Hub verwaltet — also die Eigentümerin. Wer
diesen Zugriff hat, könnte ohnehin ein beliebiges Image einspielen. Der
Bootstrap erweitert die Angriffsfläche nicht, er macht einen bestehenden
Vertrauensweg nutzbar.

Zwei Sicherungen:

- **Jede so vergebene Rolle wird geloggt** (`module: api/auth`, Level `warn`,
  E-Mail redacted gemäß PII-Regel). Sonst rätselt später jemand, woher die
  Rechte kamen.
- **Beim Start wird die Variable protokolliert**, wenn sie gesetzt ist — sie
  gehört entfernt, sobald der reguläre Weg über `AppHub.Admin` steht.

### Grenzen

Der Bootstrap vergibt ausschließlich `admin`, nicht die übrigen Rollen. Er ist
ein Notausgang, keine Rechteverwaltung. Sobald die erste Person Admin ist,
läuft alles Weitere über die Oberfläche.

## 4. Teil 2 — Verwaltungsbereich

### Struktur

Ein Punkt **Verwaltung** in der Seitenleiste (`/admin`), sichtbar für `admin`.
Darin drei Reiter:

| Reiter | Pfad | Inhalt | Herkunft |
|---|---|---|---|
| **Nutzer** | `/admin/users` | Liste mit Rolle, Aktiv-Schalter, zuletzt gesehen | bestehende Seite |
| **Vorlagen** | `/admin/blueprints` | Muster für Eventtypen | bisher `/blueprints` |
| **Import** | `/admin/import` | Personio-Sync, SharePoint-Sync, CSV-Import | bisher in der Nutzerseite |

`/blueprints` bleibt als Weiterleitung auf `/admin/blueprints` bestehen, damit
gespeicherte Links nicht ins Leere laufen.

Vorlagen sind heute für `admin`, `manager`, `event_office` und `werkstudent`
zugänglich. Unter `/admin` läge der Reiter hinter der Admin-Hürde und wäre für
Werkstudenten nicht mehr erreichbar — deshalb behält der Reiter seine eigene
Rollenprüfung; das Verwaltungs-Menü selbst erscheint, sobald mindestens ein
Reiter zugänglich ist.

### Reiter „Nutzer"

Ergänzungen zur bestehenden Seite:

**Rollenerklärung** als Zeile über der Tabelle, damit niemand raten muss, was
eine Rolle darf:

> `participant` sieht veröffentlichte Events · `werkstudent` legt Events an ·
> `event_office` und `manager` verwalten Portfolio und Auswertungen ·
> `budget_owner` gibt Budgets frei · `admin` verwaltet zusätzlich Benutzer

Die Aufzählung ist bewusst keine strenge Hierarchie — mEXP-Rollen sind additiv,
eine Person kann mehrere tragen. Das unterscheidet mEXP vom Budget-Tool, wo
`viewer < editor < owner < admin` eine echte Ordnung ist.

**Zuletzt gesehen** als Spalte. `MexpUser` hat dafür heute kein Feld;
`resolveMexpRoles` bekommt einen `lastSeenAt`-Stempel, der bei jedem Request
gesetzt wird — allerdings höchstens einmal pro Stunde und Person, damit nicht
jeder Seitenaufruf eine Datei schreibt (`persistentMap` schreibt bei jedem
`set` auf Disk).

### Reiter „Import"

Die drei Knöpfe wandern unverändert aus `admin-users.tsx` in eine eigene
Komponente. Kein Funktionsumbau — nur ein Ortswechsel, der die Nutzerseite von
gut 200 Zeilen Import-Logik befreit.

## 5. Schnitt und Dateien

Die heutige [`admin-users.tsx`](../../../apps/web/src/pages/admin-users.tsx) ist
mit über 500 Zeilen zu groß und vermischt drei Belange: Benutzerliste,
Rollenvergabe und Datenimport. Der Umbau trennt sie:

```
apps/web/src/pages/admin.tsx              neu — Rahmen mit Reiter-Navigation
apps/web/src/admin/users-panel.tsx        aus admin-users.tsx, ohne Import-Teil
apps/web/src/admin/import-panel.tsx       aus admin-users.tsx, nur Import
apps/web/src/admin/role-legend.tsx        neu — Rollenerklärung
apps/api/src/routes/_user-resolution.ts   Bootstrap + lastSeenAt
packages/auth/src/bootstrap-admins.ts     neu — Parsen und Prüfen der Liste
```

Die Trennung folgt der bestehenden Ablage: Panels liegen bereits unter
`apps/web/src/events/`, Seiten unter `pages/`.

## 6. Fehlerfälle

| Fall | Verhalten |
|---|---|
| `MEXP_BOOTSTRAP_ADMINS` leer oder nicht gesetzt | kein Bootstrap, alles wie bisher |
| Adresse in der Liste, aber Hub liefert keine E-Mail | kein Treffer, kein Absturz — Gast-Zugriffe tragen laut Vertrag A.1.4 keine E-Mail |
| Ungültige Einträge (Leerzeichen, leere Felder) | werden verworfen, der Rest bleibt gültig |
| Nutzer ohne `lastSeenAt` | Spalte zeigt „—" |

## 7. Tests

- `bootstrap-admins`: Parsen (Leerzeichen, leere Felder, Groß-/Kleinschreibung),
  Treffer und Nicht-Treffer, fehlende E-Mail
- `resolveMexpRoles`: Bootstrap greift vor dem Store, `AppHub.Admin` behält
  Vorrang, unbekannte Person wird weiterhin `participant`
- `lastSeenAt`: wird gesetzt, aber nicht öfter als einmal pro Stunde

Die Tests liegen neben der Quelldatei, wie in `packages/auth/tests/` bereits
üblich.

## 8. Offene Punkte

- **Audit-Log** braucht eine Leseschnittstelle über `/api/audit`, bevor er als
  Reiter sinnvoll ist.
- **Feingranulare Rechte** pro Eventtyp — nur bauen, wenn ein konkreter Fall
  auftritt.
- `MEXP_BOOTSTRAP_ADMINS` gehört entfernt, sobald `AppHub.Admin` im Hub vergeben
  ist. Ein Hinweis dazu kommt in den Runbook.
