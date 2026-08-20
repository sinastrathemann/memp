# Verwaltungsbereich und Admin-Bootstrap — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use mindCoder:subagent-driven-development (recommended) or mindCoder:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die App-Eigentümerin kann sich in der Hub-Instanz selbst zum Admin machen und findet alles Administrative unter einem Menüpunkt mit drei Reitern.

**Architecture:** Zwei unabhängige Teile. Backend: eine Umgebungsvariable benennt Bootstrap-Admins, geprüft in `resolveMexpRoles` vor der Store-Abfrage; dazu ein gedrosselter `lastSeenAt`-Stempel. Frontend: eine Rahmenseite `/admin` mit Reiter-Navigation, in die die bestehende Benutzerseite aufgeteilt einzieht.

**Tech Stack:** TypeScript strict, Hono, Zod, React + react-router-dom, react-i18next, Vitest, Biome.

**Spec:** [`docs/mindCoder/specs/2026-08-20-admin-area-design.md`](../specs/2026-08-20-admin-area-design.md)

## Global Constraints

- **Kein `any`.** Unbekannte Typen: `unknown` + Zod-Guards.
- **Named Exports.** Kein `export default` — Ausnahme: React-Pages unter `apps/web/src/pages/`.
- **Logging nur über pino** aus `@mexp/shared`, nie `console.log`. PII-Redaction beachten: E-Mail-Adressen nicht im Klartext loggen.
- **Dateien:** `kebab-case.ts` · **Funktionen:** `camelCase` · **Typen:** `PascalCase`
- **i18n ist Pflicht:** jeder sichtbare Text bekommt einen Schlüssel in `de.json` **und** `en.json`.
- **Keine React-Komponententests.** `apps/web` hat keine Test-Bibliotheken installiert; das Nachrüsten ist nicht Teil dieses Plans. Testbare Logik gehört deshalb in reine `.ts`-Module, nicht in `.tsx`.
- **Tests laufen über den Root-Vitest** (`npx vitest run`), der `packages/**/*.test.ts` und `apps/**/*.test.ts` einsammelt. `pnpm -r test --if-present` deckt nur `packages/auth` und `packages/infrastructure` ab.
- **Rollen sind additiv,** keine Rangfolge. Eine Person kann `event_office` und `budget_owner` gleichzeitig tragen.

---

## Dateien

| Datei | Verantwortung |
|---|---|
| `packages/auth/src/bootstrap-admins.ts` | **neu** — Liste aus der Umgebung lesen und prüfen |
| `packages/auth/tests/bootstrap-admins.test.ts` | **neu** — Tests dazu |
| `packages/auth/src/index.ts` | Export ergänzen |
| `apps/api/src/routes/_user-resolution.ts` | Bootstrap einhängen, `lastSeenAt` pflegen |
| `apps/api/src/routes/_last-seen.ts` | **neu** — reine Drossel-Logik, testbar |
| `apps/api/tests/last-seen.test.ts` | **neu** — Tests dazu |
| `apps/web/src/pages/admin.tsx` | **neu** — Rahmen mit Reiter-Navigation |
| `apps/web/src/admin/users-panel.tsx` | **neu** — aus `admin-users.tsx`, ohne Import-Teil |
| `apps/web/src/admin/import-panel.tsx` | **neu** — aus `admin-users.tsx`, nur Import |
| `apps/web/src/admin/role-order.ts` | **neu** — Reihenfolge der Rollenerklärung, testbar |
| `apps/web/src/admin/role-order.test.ts` | **neu** — Tests dazu |
| `apps/web/src/admin/role-legend.tsx` | **neu** — Anzeige der Rollenerklärung |
| `apps/web/src/pages/admin-users.tsx` | **entfällt** — Inhalt wandert in die Panels |
| `apps/web/src/app.tsx` | Routen umstellen |
| `apps/web/src/components/sidebar.tsx` | Menüpunkt „Verwaltung" |
| `apps/web/src/locales/{de,en}.json` | neue Schlüssel |
| `.env.example` | `MEXP_BOOTSTRAP_ADMINS` |
| `docs/runbook.md` | Abschnitt „Ersten Admin einrichten" |

---

## Task 1: Bootstrap-Liste lesen und prüfen

**Files:**
- Create: `packages/auth/src/bootstrap-admins.ts`
- Test: `packages/auth/tests/bootstrap-admins.test.ts`
- Modify: `packages/auth/src/index.ts`

**Interfaces:**
- Consumes: nichts
- Produces: `parseBootstrapAdmins(raw: string | undefined): string[]`, `isBootstrapAdmin(email: string | null | undefined): boolean`

- [ ] **Step 1: Test schreiben**

`packages/auth/tests/bootstrap-admins.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isBootstrapAdmin, parseBootstrapAdmins } from "../src/bootstrap-admins.js";

describe("parseBootstrapAdmins", () => {
  it("liefert eine leere Liste ohne Wert", () => {
    expect(parseBootstrapAdmins(undefined)).toEqual([]);
    expect(parseBootstrapAdmins("")).toEqual([]);
  });

  it("trennt an Kommas und entfernt Leerraum", () => {
    expect(parseBootstrapAdmins("a@x.de, b@x.de ,c@x.de")).toEqual([
      "a@x.de",
      "b@x.de",
      "c@x.de",
    ]);
  });

  it("normalisiert auf Kleinschreibung", () => {
    expect(parseBootstrapAdmins("Sina.Strathemann@Mindsquare.DE")).toEqual([
      "sina.strathemann@mindsquare.de",
    ]);
  });

  it("verwirft leere Eintraege", () => {
    expect(parseBootstrapAdmins("a@x.de,,  ,b@x.de")).toEqual(["a@x.de", "b@x.de"]);
  });
});

describe("isBootstrapAdmin", () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env.MEXP_BOOTSTRAP_ADMINS;
  });

  afterEach(() => {
    if (original === undefined) {
      // biome-ignore lint/performance/noDelete: env cleanup requires actual deletion
      delete process.env.MEXP_BOOTSTRAP_ADMINS;
    } else {
      process.env.MEXP_BOOTSTRAP_ADMINS = original;
    }
  });

  it("ist false ohne gesetzte Variable", () => {
    // biome-ignore lint/performance/noDelete: env cleanup requires actual deletion
    delete process.env.MEXP_BOOTSTRAP_ADMINS;
    expect(isBootstrapAdmin("a@x.de")).toBe(false);
  });

  it("ist false ohne E-Mail", () => {
    process.env.MEXP_BOOTSTRAP_ADMINS = "a@x.de";
    expect(isBootstrapAdmin(null)).toBe(false);
    expect(isBootstrapAdmin(undefined)).toBe(false);
    expect(isBootstrapAdmin("")).toBe(false);
  });

  it("trifft unabhaengig von Gross-/Kleinschreibung", () => {
    process.env.MEXP_BOOTSTRAP_ADMINS = "sina.strathemann@mindsquare.de";
    expect(isBootstrapAdmin("Sina.Strathemann@Mindsquare.de")).toBe(true);
  });

  it("trifft nicht bei fremder Adresse", () => {
    process.env.MEXP_BOOTSTRAP_ADMINS = "a@x.de";
    expect(isBootstrapAdmin("b@x.de")).toBe(false);
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

```bash
npx vitest run packages/auth/tests/bootstrap-admins.test.ts
```

Erwartet: FAIL — `Cannot find module '../src/bootstrap-admins.js'`

- [ ] **Step 3: Implementieren**

`packages/auth/src/bootstrap-admins.ts`:

```typescript
/**
 * Notausgang fuer die erste Administratorin: MEXP_BOOTSTRAP_ADMINS benennt
 * E-Mail-Adressen, die beim Anmelden die Rolle `admin` erhalten.
 *
 * Hintergrund: In einer frischen Hub-Instanz gibt es keinen mEXP-Admin. Die
 * regulaeren Wege setzen entweder die Hub-Rolle AppHub.Admin voraus (kann die
 * App-Eigentuemerin nicht selbst vergeben) oder einen bestehenden Admin, der
 * die Rolle zuweist. Henne und Ei.
 *
 * Wer diese Variable setzen kann, verwaltet die App im Hub und koennte ohnehin
 * ein beliebiges Image einspielen — der Bootstrap vergroessert die
 * Angriffsflaeche also nicht, er macht einen bestehenden Vertrauensweg nutzbar.
 *
 * Die Variable gehoert entfernt, sobald AppHub.Admin im Hub vergeben ist.
 */

/** Kommaseparierte Liste in normalisierte E-Mail-Adressen zerlegen. */
export function parseBootstrapAdmins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/** Steht diese Adresse in MEXP_BOOTSTRAP_ADMINS? */
export function isBootstrapAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const allowed = parseBootstrapAdmins(process.env.MEXP_BOOTSTRAP_ADMINS);
  if (allowed.length === 0) return false;
  return allowed.includes(email.trim().toLowerCase());
}
```

- [ ] **Step 4: Test laufen lassen, Erfolg prüfen**

```bash
npx vitest run packages/auth/tests/bootstrap-admins.test.ts
```

Erwartet: PASS, 9 Tests

- [ ] **Step 5: Export ergänzen**

In `packages/auth/src/index.ts` nach der `loadDevUser`-Zeile anfügen:

```typescript
export { isBootstrapAdmin, parseBootstrapAdmins } from "./bootstrap-admins.js";
```

- [ ] **Step 6: Typecheck und Lint**

```bash
pnpm --filter @mexp/auth build && pnpm -r typecheck && pnpm lint
```

Erwartet: alles ohne Fehler

- [ ] **Step 7: Commit**

```bash
git add packages/auth/src/bootstrap-admins.ts packages/auth/tests/bootstrap-admins.test.ts packages/auth/src/index.ts
git commit -m "feat(auth): bootstrap admins from MEXP_BOOTSTRAP_ADMINS"
```

---

## Task 2: Bootstrap in die Rollenauflösung einhängen

**Files:**
- Modify: `apps/api/src/routes/_user-resolution.ts`
- Modify: `.env.example`
- Modify: `docs/runbook.md`

**Interfaces:**
- Consumes: `isBootstrapAdmin` aus Task 1
- Produces: `resolveMexpRoles` liefert `["admin"]` auch für Bootstrap-Adressen

- [ ] **Step 1: Bootstrap einhängen**

In `apps/api/src/routes/_user-resolution.ts` den Import erweitern:

```typescript
import { getHubUser, isBootstrapAdmin } from "@mexp/auth";
import { rootLogger } from "@mexp/shared";
```

Direkt unter den Imports einen Logger anlegen:

```typescript
const log = rootLogger.child({ module: "api/user-resolution" });
```

Dann `resolveMexpRoles` erweitern — die neue Prüfung kommt **nach** `isHubAdmin`
und **vor** der Store-Abfrage:

```typescript
export function resolveMexpRoles(c: Context): string[] {
  const hub = getHubUser(c);
  if (hub.isHubAdmin) return ["admin"];

  // Notausgang, solange im Hub niemand AppHub.Admin hat. Absichtlich laut:
  // sonst raetselt spaeter jemand, woher die Rechte kamen. E-Mail bleibt
  // draussen (PII), die Hub-User-Id genuegt zur Zuordnung.
  if (isBootstrapAdmin(hub.email)) {
    log.warn({ userId: hub.id }, "admin granted via MEXP_BOOTSTRAP_ADMINS");
    return ["admin"];
  }

  const known = mexpUserStore.get(hub.id);
  if (known) return known.roles;
  // ... unveraendert weiter
```

- [ ] **Step 2: Von Hand gegenprüfen**

```bash
cd apps/api
AUTH_MODE=hub NODE_ENV=production PORT=3099 HOST=127.0.0.1 \
  MEXP_BOOTSTRAP_ADMINS=probe@mindsquare.de \
  node ./node_modules/tsx/dist/cli.mjs src/index.ts &
sleep 6
curl -sS -H "X-MSQ-User-Id: probe-1" -H "X-MSQ-User-Email: probe@mindsquare.de" \
  http://127.0.0.1:3099/api/me/roles
curl -sS -H "X-MSQ-User-Id: probe-2" -H "X-MSQ-User-Email: fremd@mindsquare.de" \
  http://127.0.0.1:3099/api/me/roles
kill %1
```

Erwartet: erster Aufruf enthält `admin`, zweiter `participant`

- [ ] **Step 3: `.env.example` ergänzen**

Nach dem Block `AUTH_MODE=hub` einfügen:

```dotenv
# Notausgang fuer die erste Administratorin: kommaseparierte E-Mail-Adressen,
# die beim Anmelden die Rolle "admin" erhalten. Leer lassen, sobald im Agent Hub
# jemand die Rolle AppHub.Admin traegt — dann ist dieser Weg ueberfluessig.
MEXP_BOOTSTRAP_ADMINS=
```

- [ ] **Step 4: Runbook ergänzen**

In `docs/runbook.md` nach dem Abschnitt „Warum kein CI-Build" anfügen:

```markdown
## Ersten Admin einrichten

In einer frischen Instanz gibt es keinen mEXP-Admin: `AppHub.Admin` vergibt der
Hub, und die interne Rollenvergabe setzt einen bestehenden Admin voraus. Für
diesen Fall gibt es einen Notausgang.

Im Hub unter **App-Detailseite → Container-Einstellungen** setzen:

```
MEXP_BOOTSTRAP_ADMINS=vorname.nachname@mindsquare.de
```

Danach **Neue Version einspielen**. Wer in der Liste steht, bekommt beim
Anmelden `admin` und kann unter *Verwaltung → Nutzer* Rollen vergeben.

Jede so vergebene Rolle landet als `warn` im Container-Log
(`admin granted via MEXP_BOOTSTRAP_ADMINS`).

> **Wieder entfernen,** sobald im Hub jemand `AppHub.Admin` trägt oder die
> Rollen intern vergeben sind. Der Notausgang soll kein Dauerzustand werden.
```

- [ ] **Step 5: Typecheck, Lint, Tests**

```bash
pnpm -r typecheck && pnpm lint && npx vitest run
```

Erwartet: alles ohne Fehler

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/_user-resolution.ts .env.example docs/runbook.md
git commit -m "feat(auth): wire bootstrap admins into role resolution"
```

---

## Task 3: „Zuletzt gesehen" mit Drosselung

**Files:**
- Create: `apps/api/src/routes/_last-seen.ts`
- Test: `apps/api/tests/last-seen.test.ts`
- Modify: `apps/api/src/routes/_user-resolution.ts`

**Interfaces:**
- Consumes: `MexpUser` aus `_user-resolution.ts`
- Produces: `shouldTouchLastSeen(lastSeenAt: string | undefined, nowMs: number): boolean`, `LAST_SEEN_THROTTLE_MS: number`

- [ ] **Step 1: Test schreiben**

`apps/api/tests/last-seen.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { LAST_SEEN_THROTTLE_MS, shouldTouchLastSeen } from "../src/routes/_last-seen.js";

const NOW = Date.parse("2026-08-20T12:00:00.000Z");

describe("shouldTouchLastSeen", () => {
  it("schreibt, wenn noch nie gesehen", () => {
    expect(shouldTouchLastSeen(undefined, NOW)).toBe(true);
  });

  it("schreibt bei unlesbarem Zeitstempel", () => {
    expect(shouldTouchLastSeen("kein-datum", NOW)).toBe(true);
  });

  it("schreibt nicht innerhalb des Fensters", () => {
    const vorFuenfMinuten = new Date(NOW - 5 * 60 * 1000).toISOString();
    expect(shouldTouchLastSeen(vorFuenfMinuten, NOW)).toBe(false);
  });

  it("schreibt nach Ablauf des Fensters", () => {
    const abgelaufen = new Date(NOW - LAST_SEEN_THROTTLE_MS - 1).toISOString();
    expect(shouldTouchLastSeen(abgelaufen, NOW)).toBe(true);
  });

  it("schreibt genau auf der Grenze", () => {
    const grenze = new Date(NOW - LAST_SEEN_THROTTLE_MS).toISOString();
    expect(shouldTouchLastSeen(grenze, NOW)).toBe(true);
  });

  it("schreibt bei Zeitstempel aus der Zukunft nicht", () => {
    const zukunft = new Date(NOW + 60_000).toISOString();
    expect(shouldTouchLastSeen(zukunft, NOW)).toBe(false);
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

```bash
npx vitest run apps/api/tests/last-seen.test.ts
```

Erwartet: FAIL — Modul nicht gefunden

- [ ] **Step 3: Implementieren**

`apps/api/src/routes/_last-seen.ts`:

```typescript
/**
 * Drossel fuer den lastSeenAt-Stempel.
 *
 * resolveMexpRoles laeuft bei jedem authentifizierten Request. Wuerde dort
 * jedes Mal geschrieben, schriebe persistentMap bei jedem Seitenaufruf die
 * komplette Nutzerdatei auf Disk — bei 805 Nutzern rund 460 KB pro Klick.
 * Einmal pro Stunde und Person genuegt fuer die Anzeige "zuletzt gesehen".
 */

/** Mindestabstand zwischen zwei Schreibvorgaengen: eine Stunde. */
export const LAST_SEEN_THROTTLE_MS = 60 * 60 * 1000;

/** Soll der Stempel jetzt neu geschrieben werden? */
export function shouldTouchLastSeen(lastSeenAt: string | undefined, nowMs: number): boolean {
  if (!lastSeenAt) return true;
  const previous = Date.parse(lastSeenAt);
  if (Number.isNaN(previous)) return true;
  return nowMs - previous >= LAST_SEEN_THROTTLE_MS;
}
```

- [ ] **Step 4: Test laufen lassen, Erfolg prüfen**

```bash
npx vitest run apps/api/tests/last-seen.test.ts
```

Erwartet: PASS, 6 Tests

- [ ] **Step 5: Feld und Aufruf ergänzen**

In `apps/api/src/routes/_user-resolution.ts` den Import ergänzen — nur
`shouldTouchLastSeen`, die Konstante wird hier nicht gebraucht und würde als
ungenutzte Einfuhr auffallen:

```typescript
import { shouldTouchLastSeen } from "./_last-seen.js";
```

Im Interface `MexpUser` nach `updatedAt` einfügen:

```typescript
  /** Letzter authentifizierter Request dieser Person. Hoechstens stuendlich
   *  fortgeschrieben — siehe _last-seen.ts. */
  lastSeenAt?: string;
```

In `resolveMexpRoles` den `known`-Zweig ersetzen:

```typescript
  const known = mexpUserStore.get(hub.id);
  if (known) {
    const now = Date.now();
    if (shouldTouchLastSeen(known.lastSeenAt, now)) {
      mexpUserStore.set(hub.id, { ...known, lastSeenAt: new Date(now).toISOString() });
    }
    return known.roles;
  }
```

Und im `fresh`-Objekt den Stempel gleich mitsetzen:

```typescript
  const fresh: MexpUser = {
    id: hub.id,
    email: hub.email,
    displayName: hub.name,
    roles: ["participant"],
    isActive: true,
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
  };
```

- [ ] **Step 6: Typecheck, Lint, alle Tests**

```bash
pnpm -r typecheck && pnpm lint && npx vitest run
```

Erwartet: alles ohne Fehler

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/_last-seen.ts apps/api/tests/last-seen.test.ts apps/api/src/routes/_user-resolution.ts
git commit -m "feat(admin): track lastSeenAt with hourly throttle"
```

---

## Task 4: Reihenfolge der Rollenerklärung

**Files:**
- Create: `apps/web/src/admin/role-order.ts`
- Test: `apps/web/src/admin/role-order.test.ts`

**Interfaces:**
- Consumes: `ROLE_NAMES`, `RoleName` aus `apps/web/src/auth/types.ts`
- Produces: `ROLE_EXPLANATION_ORDER: readonly RoleName[]`

- [ ] **Step 1: Test schreiben**

`apps/web/src/admin/role-order.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { ROLE_NAMES } from "../auth/types";
import { ROLE_EXPLANATION_ORDER } from "./role-order";

describe("ROLE_EXPLANATION_ORDER", () => {
  it("enthaelt jede Rolle genau einmal", () => {
    expect([...ROLE_EXPLANATION_ORDER].sort()).toEqual([...ROLE_NAMES].sort());
  });

  it("beginnt mit der eingeschraenktesten Rolle", () => {
    expect(ROLE_EXPLANATION_ORDER[0]).toBe("read_only");
  });

  it("endet mit admin", () => {
    expect(ROLE_EXPLANATION_ORDER[ROLE_EXPLANATION_ORDER.length - 1]).toBe("admin");
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

```bash
npx vitest run apps/web/src/admin/role-order.test.ts
```

Erwartet: FAIL — Modul nicht gefunden

- [ ] **Step 3: Implementieren**

`apps/web/src/admin/role-order.ts`:

```typescript
import type { RoleName } from "../auth/types";

/**
 * Reihenfolge, in der Rollen in der Legende erklaert werden — von wenig zu viel
 * Verantwortung.
 *
 * Das ist eine Lesereihenfolge, KEINE Hierarchie: mEXP-Rollen sind additiv,
 * eine Person kann `event_office` und `budget_owner` gleichzeitig tragen. Wer
 * hier eine Rangfolge hineinliest, irrt.
 *
 * Der Test haelt die Liste mit ROLE_NAMES synchron: kommt eine Rolle dazu,
 * schlaegt er fehl, bis sie hier eingeordnet ist.
 */
export const ROLE_EXPLANATION_ORDER: readonly RoleName[] = [
  "read_only",
  "participant",
  "werkstudent",
  "event_office",
  "budget_owner",
  "manager",
  "admin",
] as const;
```

- [ ] **Step 4: Test laufen lassen, Erfolg prüfen**

```bash
npx vitest run apps/web/src/admin/role-order.test.ts
```

Erwartet: PASS, 3 Tests

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/admin/role-order.ts apps/web/src/admin/role-order.test.ts
git commit -m "feat(admin): add role explanation order"
```

---

## Task 5: Übersetzungen ergänzen

**Files:**
- Modify: `apps/web/src/locales/de.json`
- Modify: `apps/web/src/locales/en.json`

**Interfaces:**
- Consumes: nichts
- Produces: Schlüssel `admin.tabUsers`, `admin.tabBlueprints`, `admin.tabImport`, `admin.title`, `admin.navLink`, `admin.roleLegendTitle`, `admin.roleDesc.<rolle>`, `admin.colLastSeen`, `admin.neverSeen`, `admin.importTitle`

- [ ] **Step 1: Deutsche Schlüssel ergänzen**

In `apps/web/src/locales/de.json` im Objekt `admin` ergänzen:

```json
    "navLink": "Verwaltung",
    "title": "Verwaltung",
    "tabUsers": "Nutzer",
    "tabBlueprints": "Vorlagen",
    "tabImport": "Import",
    "importTitle": "Daten übernehmen",
    "colLastSeen": "Zuletzt gesehen",
    "neverSeen": "—",
    "roleLegendTitle": "Was die Rollen bedeuten",
    "roleDesc": {
      "read_only": "sieht Events, kann nichts ändern",
      "participant": "sieht veröffentlichte Events und meldet sich an",
      "werkstudent": "legt Events an und pflegt Vorlagen",
      "event_office": "verwaltet Portfolio, Teilnehmende und Auswertungen",
      "budget_owner": "gibt Budgets frei",
      "manager": "verwaltet Portfolio und Auswertungen",
      "admin": "verwaltet zusätzlich Nutzer und Rollen"
    }
```

- [ ] **Step 2: Englische Schlüssel ergänzen**

In `apps/web/src/locales/en.json` im Objekt `admin` ergänzen:

```json
    "navLink": "Administration",
    "title": "Administration",
    "tabUsers": "Users",
    "tabBlueprints": "Templates",
    "tabImport": "Import",
    "importTitle": "Import data",
    "colLastSeen": "Last seen",
    "neverSeen": "—",
    "roleLegendTitle": "What the roles mean",
    "roleDesc": {
      "read_only": "sees events, cannot change anything",
      "participant": "sees published events and registers",
      "werkstudent": "creates events and maintains templates",
      "event_office": "manages portfolio, participants and reports",
      "budget_owner": "approves budgets",
      "manager": "manages portfolio and reports",
      "admin": "additionally manages users and roles"
    }
```

- [ ] **Step 3: Gültigkeit prüfen**

```bash
node -e "const de=require('./apps/web/src/locales/de.json'); const en=require('./apps/web/src/locales/en.json'); const dk=Object.keys(de.admin.roleDesc).sort(); const ek=Object.keys(en.admin.roleDesc).sort(); if(JSON.stringify(dk)!==JSON.stringify(ek)) throw new Error('roleDesc weicht ab'); console.log('OK', dk.length, 'Rollen in beiden Sprachen');"
```

Erwartet: `OK 7 Rollen in beiden Sprachen`

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/locales/de.json apps/web/src/locales/en.json
git commit -m "feat(i18n): add admin area keys"
```

---

## Task 6: Benutzerseite in zwei Panels aufteilen

**Files:**
- Create: `apps/web/src/admin/users-panel.tsx`
- Create: `apps/web/src/admin/import-panel.tsx`
- Create: `apps/web/src/admin/role-legend.tsx`
- Delete: `apps/web/src/pages/admin-users.tsx`

**Interfaces:**
- Consumes: `ROLE_EXPLANATION_ORDER` aus Task 4, i18n-Schlüssel aus Task 5
- Produces: `UsersPanel()`, `ImportPanel()`, `RoleLegend()` — alle als Named Exports

- [ ] **Step 1: Import-Panel herauslösen**

`apps/web/src/admin/import-panel.tsx` anlegen. Aus `apps/web/src/pages/admin-users.tsx` übernehmen:

- die Interfaces `PersonioSyncResult`, `SharepointSyncResult`, `CsvImportResult` (Zeilen 11–39)
- die Mutationen `syncMut`, `spSyncMut`, `csvImportMut` samt `csvFileRef` (Zeilen 53–88)
- die drei Anzeigeblöcke (Zeilen 151–267)

Kopf der neuen Datei:

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "../api/client";
import { withBasePath } from "../base-path";

export function ImportPanel() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin", "users"] });
  // ... Mutationen und Anzeigeblöcke aus admin-users.tsx
}
```

> Die relativen Einfuhrpfade bleiben unverändert: `pages/` und `admin/` liegen
> beide eine Ebene unter `src/`, `../api/client` trifft von dort dasselbe Ziel.

- [ ] **Step 2: Rollenlegende anlegen**

`apps/web/src/admin/role-legend.tsx`:

```tsx
import { useTranslation } from "react-i18next";
import { ROLE_EXPLANATION_ORDER } from "./role-order";

/**
 * Erklaert, was die Rollen duerfen. Bewusst als Aufzaehlung, nicht als
 * Rangfolge: mEXP-Rollen sind additiv.
 */
export function RoleLegend() {
  const { t } = useTranslation();
  return (
    <details className="card" style={{ marginBottom: "var(--space-4)" }}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>
        {t("admin.roleLegendTitle")}
      </summary>
      <ul style={{ marginTop: "var(--space-2)" }}>
        {ROLE_EXPLANATION_ORDER.map((role) => (
          <li key={role}>
            <code>{role}</code> — {t(`admin.roleDesc.${role}`)}
          </li>
        ))}
      </ul>
    </details>
  );
}
```

- [ ] **Step 3: Nutzer-Panel anlegen**

`apps/web/src/admin/users-panel.tsx` anlegen mit dem Rest aus
`admin-users.tsx`: der Benutzerliste (ab Zeile 270), `CreateUserForm` (ab 355)
und `RoleEditor` (ab 457). Kopf:

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/auth-context";
import { ROLE_NAMES } from "../auth/types";
import type { AdminUserRow, RoleName } from "../auth/types";
import { RoleLegend } from "./role-legend";

export function UsersPanel() {
  const { t } = useTranslation();
  // ... data-Query, Mutationen, Tabelle
}
```

Die Legende erscheint direkt über der Tabelle:

```tsx
      <RoleLegend />
      <h2 style={{ marginTop: "var(--space-4)" }}>{t("admin.usersListTitle")}</h2>
```

Die Spalte „zuletzt gesehen" kommt in Task 8 dazu — hier nur der Umzug ohne
Funktionsänderung.

- [ ] **Step 4: Alte Seite löschen**

```bash
git rm apps/web/src/pages/admin-users.tsx
```

- [ ] **Step 5: Typecheck und Lint**

```bash
pnpm -r typecheck && pnpm lint
```

Erwartet: Fehler in `app.tsx`, weil `AdminUsersPage` nicht mehr existiert —
das behebt Task 7. Alle anderen Dateien müssen sauber sein.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/admin/
git commit -m "refactor(admin): split admin-users into users and import panels"
```

---

## Task 7: Rahmenseite mit Reitern, Routen und Menü

**Files:**
- Create: `apps/web/src/pages/admin.tsx`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/components/sidebar.tsx`

**Interfaces:**
- Consumes: `UsersPanel`, `ImportPanel` aus Task 6, `BlueprintsPage`
- Produces: Route `/admin` mit Unterpfaden `users`, `blueprints`, `import`

- [ ] **Step 1: Rahmenseite anlegen**

`apps/web/src/pages/admin.tsx`:

```tsx
import { useTranslation } from "react-i18next";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { ImportPanel } from "../admin/import-panel";
import { UsersPanel } from "../admin/users-panel";
import { useAuth } from "../auth/auth-context";
import BlueprintsPage from "./blueprints";

/**
 * Rahmen fuer den Verwaltungsbereich. Die Reiter tragen ihre eigene
 * Rollenpruefung: Vorlagen stehen auch Werkstudenten offen, Nutzer und Import
 * nur Admins. Deshalb reicht eine Pruefung auf der Route nicht aus.
 */
export default function AdminPage() {
  const { t } = useTranslation();
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const mayBlueprints = hasRole("admin", "manager", "event_office", "werkstudent");

  const tabClass = ({ isActive }: { isActive: boolean }) =>
    `btn btn-sm${isActive ? " btn-primary" : " btn-ghost"}`;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="eyebrow">mEXP</div>
          <h1 className="page-title">{t("admin.title")}</h1>
        </div>
      </div>

      <nav className="row" style={{ gap: 8, marginBottom: "var(--space-6)" }}>
        {isAdmin && (
          <NavLink to="/admin/users" className={tabClass}>
            {t("admin.tabUsers")}
          </NavLink>
        )}
        {mayBlueprints && (
          <NavLink to="/admin/blueprints" className={tabClass}>
            {t("admin.tabBlueprints")}
          </NavLink>
        )}
        {isAdmin && (
          <NavLink to="/admin/import" className={tabClass}>
            {t("admin.tabImport")}
          </NavLink>
        )}
      </nav>

      <Routes>
        <Route index element={<Navigate to={isAdmin ? "users" : "blueprints"} replace />} />
        {isAdmin && <Route path="users" element={<UsersPanel />} />}
        {mayBlueprints && <Route path="blueprints" element={<BlueprintsPage />} />}
        {isAdmin && <Route path="import" element={<ImportPanel />} />}
        <Route path="*" element={<Navigate to={isAdmin ? "users" : "blueprints"} replace />} />
      </Routes>
    </div>
  );
}
```

- [ ] **Step 2: Routen umstellen**

In `apps/web/src/app.tsx` den Import tauschen:

```tsx
import AdminPage from "./pages/admin";
```

`import AdminUsersPage from "./pages/admin-users";` entfernen.

Die Routen `/blueprints` und `/admin/users` durch diese ersetzen:

```tsx
      {/* Alter Pfad — gespeicherte Links sollen nicht ins Leere laufen */}
      <Route path="/blueprints" element={<Navigate to="/admin/blueprints" replace />} />
      <Route
        path="/admin/*"
        element={
          <ProtectedRoute roles={["admin", "manager", "event_office", "werkstudent"]}>
            <AdminPage />
          </ProtectedRoute>
        }
      />
```

> Die Route lässt alle Rollen durch, die mindestens einen Reiter sehen dürfen.
> Die Feinprüfung sitzt in `AdminPage`.

- [ ] **Step 3: Menüpunkt zusammenfassen**

In `apps/web/src/components/sidebar.tsx` die beiden Blöcke für `/blueprints`
und `/admin/users` durch einen ersetzen:

```tsx
        {hasRole("admin", "manager", "event_office", "werkstudent") && (
          <NavLink
            to="/admin"
            className={({ isActive }) => `ms-sidebar-link${isActive ? " active" : ""}`}
          >
            <span className="ms-sidebar-icon" aria-hidden="true">
              ⚙️
            </span>
            {t("admin.navLink")}
          </NavLink>
        )}
```

- [ ] **Step 4: Typecheck, Lint, Build**

```bash
pnpm -r typecheck && pnpm lint && pnpm --filter @mexp/web build
```

Erwartet: alles ohne Fehler

- [ ] **Step 5: Von Hand prüfen**

```bash
pnpm dev
```

Im Browser auf `http://127.0.0.1:8080/admin` prüfen:
- Menüpunkt **Verwaltung** ist da, die drei Reiter schalten um
- `/blueprints` leitet auf `/admin/blueprints` um
- Personio-Sync und CSV-Import stehen unter **Import**
- Die Rollenlegende lässt sich auf- und zuklappen

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/admin.tsx apps/web/src/app.tsx apps/web/src/components/sidebar.tsx
git commit -m "feat(admin): tabbed administration area"
```

---

## Task 8: Spalte „Zuletzt gesehen"

**Files:**
- Modify: `apps/web/src/auth/types.ts`
- Modify: `apps/web/src/admin/users-panel.tsx`
- Modify: `apps/api/src/routes/admin-users.ts`

**Interfaces:**
- Consumes: `lastSeenAt` aus Task 3
- Produces: `AdminUserRow.lastSeenAt?: string`

- [ ] **Step 1: Feld im Typ ergänzen**

In `apps/web/src/auth/types.ts` im Interface `AdminUserRow` ergänzen:

```typescript
  /** Letzter authentifizierter Request. Fehlt bei Nutzern, die sich nie
   *  angemeldet haben — etwa frisch aus Personio importierte. */
  lastSeenAt?: string;
```

- [ ] **Step 2: Feld in der API durchreichen**

In `apps/api/src/routes/admin-users.ts` prüfen, wie die Liste gebaut wird:

```bash
grep -n "users:" apps/api/src/routes/admin-users.ts | head -5
```

Wird dort explizit auf Felder abgebildet, `lastSeenAt: u.lastSeenAt` ergänzen.
Wird der `MexpUser` unverändert ausgegeben, ist nichts zu tun — das Feld ist
dann bereits enthalten.

- [ ] **Step 3: Spalte anzeigen**

In `apps/web/src/admin/users-panel.tsx` in der Kopfzeile der Tabelle nach
`colStatus` ergänzen:

```tsx
                  <th>{t("admin.colLastSeen")}</th>
```

Und in der Datenzeile an gleicher Stelle:

```tsx
                    <td>
                      {u.lastSeenAt
                        ? new Date(u.lastSeenAt).toLocaleString(i18n.language)
                        : t("admin.neverSeen")}
                    </td>
```

Dafür `i18n` aus `useTranslation()` mitnehmen:

```tsx
  const { t, i18n } = useTranslation();
```

- [ ] **Step 4: Typecheck, Lint, Build, Tests**

```bash
pnpm -r typecheck && pnpm lint && pnpm --filter @mexp/web build && npx vitest run
```

Erwartet: alles ohne Fehler

- [ ] **Step 5: Von Hand prüfen**

```bash
pnpm dev
```

Unter `http://127.0.0.1:8080/admin/users` steht bei der eigenen Person ein
Zeitstempel, bei den importierten Personio-Nutzern ein `—`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/auth/types.ts apps/web/src/admin/users-panel.tsx apps/api/src/routes/admin-users.ts
git commit -m "feat(admin): show last seen per user"
```

---

## Abschluss

- [ ] **Vollständige Pipeline**

```bash
pnpm --filter "./packages/*" build && pnpm -r typecheck && pnpm lint && npx vitest run
```

Erwartet: alles grün

- [ ] **Pull Request**

```bash
gh pr create --base main --head feat/admin-area \
  --title "feat(admin): tabbed administration area and admin bootstrap"
```

- [ ] **Nach dem Merge: im Hub setzen**

Container-Einstellungen der App: `MEXP_BOOTSTRAP_ADMINS=sina.strathemann@mindsquare.de`,
dann Image neu bauen und pushen (Runbook § Deploy) und **Neue Version einspielen**.
