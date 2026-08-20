# Runbook

Betriebshandbuch für mEXP. Zielgruppe: DevOps / On-Call.

## Deploy

**Target:** mindsquare Agent Hub (Managed)
**Registry:** `mindcode.mindsquare.de/sina.strathemann/mexp` — **nicht** GHCR.
Der Hub zieht sein Image von mindcode; die Registry ist dort im Repo unter
*Pakete* einsehbar.

### Release: Image bauen und veröffentlichen

Der Build läuft **lokal**, nicht in der CI. Grund siehe „Warum kein CI-Build"
weiter unten.

```bash
# Einmalig pro Rechner: an der Registry anmelden.
# Username = mindcode-Benutzername, Passwort = Personal Access Token mit
# package-Schreibrecht (mindCode → Settings → Applications).
docker login mindcode.mindsquare.de -u <mindcode-user>

# Bauen — immer mit SHA-Tag, damit ein Rollback ein eindeutiges Ziel hat.
SHA=$(git rev-parse --short HEAD)
docker build -f docker/Dockerfile \
  -t mindcode.mindsquare.de/sina.strathemann/mexp:latest \
  -t "mindcode.mindsquare.de/sina.strathemann/mexp:sha-${SHA}" \
  --build-arg APP_VERSION=latest \
  --label "org.opencontainers.image.revision=$(git rev-parse HEAD)" \
  .

# Vor dem Push prüfen, dass der Container ueberhaupt hochkommt.
docker run -d --name mexp-smoke -p 3095:3000 -e AUTH_MODE=hub \
  "mindcode.mindsquare.de/sina.strathemann/mexp:sha-${SHA}"
sleep 8 && curl -sS http://127.0.0.1:3095/health   # {"status":"ok",...}
docker rm -f mexp-smoke

docker push "mindcode.mindsquare.de/sina.strathemann/mexp:sha-${SHA}"
docker push mindcode.mindsquare.de/sina.strathemann/mexp:latest
```

Danach im Hub: **App-Detailseite → Neue Version einspielen** → Tag wählen.
Der Hub startet den Container neu; der alte läuft, bis der neue healthy ist.

**Rollback:** Hub-Admin-UI → „Vorherige Version". Achtung: Nur das Image wird
zurückgerollt, nicht das Volume (`appdata-mexp-data`). Wenn eine
Schema-Migration passiert ist, muss sie idempotent + additiv sein.

> **Image-Ref im Hub prüfen, wenn Änderungen nicht ankommen.** Die App lief
> monatelang auf einem festgenagelten `sha-`-Tag aus einem Feature-Branch —
> „Update prüfen" findet dann nie etwas, weil ein SHA-Tag sich nie ändert.
> Steht dort ein `sha-`-Tag, das nicht dem gewünschten Stand entspricht, auf
> `:latest` oder den richtigen SHA umstellen.

### Warum kein CI-Build

Der Container-Build läuft bewusst nicht auf dem mindcode-Runner. Docker-in-Docker
nach How To Abschnitt 12.5 ist dort mit `act_runner v13.0.0` nicht lauffähig —
verifiziert am 2026-08-20 in sechs Läufen, zuletzt mit der wortgetreuen
Konfiguration aus der Anleitung (Lauf #78, Abbruch nach 5s):

| Befund | Lauf |
|---|---|
| `dial unix /var/run/docker.sock: no such file or directory` | #62 (ohne Sidecar) |
| `container health check … is not healthy` nach 3s trotz `--health-retries=10` | #68, #78 |
| `lookup docker on 127.0.0.11:53: server misbehaving` | #72 |
| Docker-API auf keiner Adresse des Job-Netzes erreichbar | #74, #76 |

`ci.yml` läuft auf mindcode normal (Build, Typecheck, Lint, Test) — nur der
Container-Build nicht. Sobald der Runner Docker bereitstellt, kann
`.forgejo/workflows/publish-container.yml` wieder aktiviert werden; die Datei
ist vorhanden.

**Manueller Trigger auf GitHub** existiert weiterhin (`Actions → Publish
Container → Run workflow`), solange das GitHub-Repo besteht. Es publiziert in
beide Registries.

## Health Checks
- API: `GET http://<host>:3000/health`
- Postgres: `pg_isready -U mexp -d mexp`
- Redis: `redis-cli ping`
- Queue-Backlog: `redis-cli LLEN bull:reminders:wait` (und analog für weitere Queues)

## Kritische Metriken

| Metrik | Schwellwert | Reaktion |
|---|---|---|
| API P95 Latenz | > 2000 ms | Profiling, DB-Index prüfen |
| Queue-Backlog | > 1000 Jobs | Worker-Concurrency erhöhen |
| Versandfehler (Outlook) | > 5 % / h | Graph-API-Limit prüfen, Retry |
| Check-in-Latenz | > 500 ms | Redis-Health, DB-Last |
| Integrationsfehler | > 10 / h | M365-Status + Token-Ablauf |

## Backups
- **Postgres**: täglich via `pg_dump` → Hetzner Object Storage, 30 Tage Retention
- **Dokumente**: SharePoint (Microsoft Backup-Policy), bei S3-Fallback: S3 Versioning

Restore-Drill mindestens quartalsweise.

## Incident Response
1. Alert empfangen → Lage sichten (Grafana / Logs)
2. Betroffenheit einschätzen (aktiver Event am Tag?)
3. Fallback-to-Human aktivieren wenn kritisch (Check-in per Papierliste)
4. Ursache beheben, Post-mortem innerhalb 3 Arbeitstagen

## Secrets-Rotation
- JWT/Session-Secrets: quartalsweise
- Entra-Client-Secret: gemäß Ablauf in Entra (max. 24 Monate)
- Postgres-Passwort: jährlich
