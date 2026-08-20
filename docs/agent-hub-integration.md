# Agent-Hub-Integration — Hub-Admin-Handout

Dieser Guide richtet sich an den Agent-Hub-Operator, der mEXP im Hub-Admin-UI einträgt.

## Registrierungs-Werte

Alle Felder zum Copy-Paste ins Hub-Admin-Formular:

| Feld | Wert |
|---|---|
| Anzeigename | mEXP — Experience |
| Slug | `mindsquare-experience-plattform` |
| Beschreibung | mindsquare Experience Platform — Events, Budget, Anmeldungen, Reporting |
| Icon | 📅 |
| Kategorie | `hr` |
| Image-Ref | `mindcode.mindsquare.de/sina.strathemann/mexp:latest` |
| Container-Port | `3000` (aus `EXPOSE` im Image) |
| Health-Pfad | `/health` |
| Timeout | `30s` (Standard) |
| Body-Limit | `50 MB` (Standard, ausreichend für PDF-Rechnungen) |
| Salesforce-Integration | nein |

## Zugriff

**Alle angemeldeten Mitarbeiter der mindsquare AG.** Feingranulare mEXP-Rollen (admin, event_office, werkstudent, budget_owner, participant) werden **in mEXP** gepflegt — verknüpft über die Entra-User-ID. Unbekannte User werden beim ersten Request automatisch als `participant` registriert.

**Hub-Admin-Marker:** Ein User mit `AppHub.Admin` in `X-MSQ-Roles` gilt in mEXP automatisch als mEXP-Admin — unabhängig von seiner in mEXP gespeicherten Rollenzuweisung.

## Env-Variablen (Tab „Container-Einstellungen")

Werden im Hub-UI eingetragen; die `.env.example` aus dem Image ist vorbefüllt:

```
NODE_ENV=production
AUTH_MODE=hub
MEXP_DATA_DIR=/app/data
PORT=3000
HOST=0.0.0.0
TZ=Europe/Berlin
LOG_LEVEL=info
```

## Volumes

Persistenter State (Event-JSON-Overrides, Uploads, Registrierungsdaten):

```
appdata-mexp-data → /app/data
```

Der Hub schlägt das automatisch vor (VOLUME-Direktive im Image).

## Registry-Zugriff

Das Package `ghcr.io/sinastrathemann/mexp` liegt im GitHub Container Registry des Personal-Accounts `sinastrathemann`. Zwei Optionen für den Hub-Pull:

1. **Package auf public setzen** (Empfehlung falls keine sensible Repo-Sichtbarkeit nötig) — dann keine Auth beim Pull.
2. **Package bleibt private** — der Hub-Operator legt einen Git-Host für `ghcr.io` mit einem GitHub-PAT (Scopes: `read:packages`) an.

Aktuell gewählt: **wird bei erster GHCR-Publish festgelegt** — Empfehlung: Package auf `public` setzen (kein Hub-Operator-Setup nötig; mEXP enthält keinen sensiblen Code, nur interne Business-Logik). Alternative bei restriktiver Policy: private + Hub-Operator legt einen `ghcr.io`-Git-Host mit einem `read:packages`-PAT an.

## Deploy-Ablauf

1. Entwickler pusht auf `main` → GitHub-Actions baut neues Image → `ghcr.io/sinastrathemann/mexp:latest` und `ghcr.io/sinastrathemann/mexp:sha-<abbrev>`
2. Hub-Admin öffnet `https://<hub-domain>/admin/apps/mexp` → **Neue Version einspielen** → Tag wählen (`latest` oder `sha-...`)
3. Hub führt `docker pull` + Container-Neustart aus. Rollback via **Vorherige Version wiederherstellen**.

## SPA-Cache-Verhalten

- `index.html` wird mit `Cache-Control: no-cache, must-revalidate` ausgeliefert → nach Deploy laden alle User die neuen Asset-Hashes.
- `/assets/*` (content-gehasht) mit `Cache-Control: public, max-age=31536000, immutable`.

## Smoke-Test nach Registrierung

```bash
# vom Browser (nach Hub-Login)
open https://<hub-domain>/mexp/

# vom Terminal (führt zum Hub-Login-Redirect, nicht direkt zur App)
curl -I https://<hub-domain>/mexp/health
```

Erwartung: Waffle-Menü oben rechts vorhanden, Feedback-Button funktioniert (öffnet Issue in `sinastrathemann/mexp`).
