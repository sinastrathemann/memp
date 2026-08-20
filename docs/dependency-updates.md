# Offene Abhängigkeits-Updates

> Stand: 2026-08-20 · Schnappschuss der Dependabot-PRs auf GitHub, bevor das
> dortige Repository stillgelegt wurde.

Dependabot lief nur auf GitHub. Auf mindCode gibt es kein Gegenstück, deshalb
kommen Update-Hinweise künftig nicht mehr automatisch. Dieses Dokument hält den
letzten Stand fest, damit die Arbeit nicht verlorengeht.

**Ersatzverfahren:** vierteljährlich `pnpm outdated -r` laufen lassen und die
Sicherheitslage über `pnpm audit` prüfen.

## Unbedenklich — Pipeline-Updates

Betreffen nur die CI, nicht die Anwendung.

| PR | Update |
|---|---|
| #20 | `actions/checkout` 4 → 7 |
| #19 | `docker/metadata-action` 5 → 6 |

Die Node-20-Deprecation-Warnungen in den GitHub-Läufen kamen von
`actions/checkout@v4`. Für die `.forgejo/workflows/` ist das ebenfalls
relevant, sobald der Runner dort Actions in neueren Versionen auflöst.

## Mittleres Risiko — vor dem Übernehmen testen

| PR | Update | Anmerkung |
|---|---|---|
| #16 | Sammel-PR, 11 Minor-/Patch-Updates | einzeln durchsehen, nicht blind übernehmen |
| #11 | `@vitejs/plugin-react` 4.7.0 → 6.0.3 | Build-Zeit, zwei Major-Sprünge |
| #10 | `react-dom` + `@types/react-dom` | mit React-Version abgleichen |

## Bewusst zurückgestellt

| PR | Update | Warum |
|---|---|---|
| #15 | Docker-Base `node:22-alpine` → `node:25-alpine` | [CLAUDE.md](../CLAUDE.md) schreibt Node 22 fest; ein Wechsel der Laufzeit gehört abgestimmt, nicht nebenbei gemerged |
| #13 | `@hono/node-server` 1.19.14 → 2.0.10 | Major-Sprung am HTTP-Server — der trägt die gesamte API |
| #12 | `i18next` 23.16.8 → 26.3.6 | drei Major-Versionen auf einmal; DE/EN ist Pflicht, Regressionen fallen erst im UI auf |

## Vorgehen bei Wiederaufnahme

1. Erst die beiden unbedenklichen übernehmen, CI beobachten.
2. Dann die mittleren einzeln, jeweils mit `pnpm -r test` und einem manuellen
   Blick auf Portfolio, Event-Detail und Sprachumschaltung.
3. Die zurückgestellten nur als eigenes Vorhaben mit Testzeit — nicht zwischen
   Tür und Angel.
