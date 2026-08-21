import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hubAuthMiddleware } from "@mexp/auth";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";

// MEXP_DATA_DIR muss VOR dem ersten Import von _user-resolution.js gesetzt sein --
// dev-persistence.ts liest den Wert beim Modul-Laden. Ohne diese Umleitung wuerde
// dieser Test die echten Dev-Daten unter apps/api/data/memp-users.json ueberschreiben.
process.env.MEXP_DATA_DIR = mkdtempSync(join(tmpdir(), "mexp-require-mexp-role-test-"));

// hubAuthMiddleware faellt in dev-bypass zurueck, wenn AUTH_MODE weder gesetzt noch
// NODE_ENV production ist -- das wuerde X-MSQ-*-Header ignorieren und den Dev-User aus
// config/dev-user.yaml einsetzen. Dieser Test soll das Gate ueber echte Hub-Header
// pruefen, deshalb den Header-Pfad erzwingen.
process.env.AUTH_MODE = "hub";

// Dynamischer Import statt eines statischen: ein statischer Import wuerde vor obigen
// process.env-Zuweisungen ausgewertet (ESM hebt Imports an den Dateianfang).
const { mexpUserStore, requireMexpRole } = await import("../src/routes/_user-resolution.js");

type MexpUser = NonNullable<ReturnType<typeof mexpUserStore.get>>;

function makeStoredUser(overrides: Partial<MexpUser> & Pick<MexpUser, "id" | "roles">): MexpUser {
  const now = new Date().toISOString();
  return {
    email: null,
    displayName: null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const PROTECTED_PATH = "/protected/import-csv";

/**
 * Baut denselben Aufbau nach, den die drei echten Import-Endpunkte verwenden
 * (z. B. adminUsersImportRoutes.post("/import-csv", requireMexpRole("admin"), ...) in
 * admin-users-import.ts): eine echte Hono-App mit hubAuthMiddleware davor und
 * requireMexpRole("admin") als Routen-Middleware, dahinter ein simpler Handler. Geprueft
 * wird damit die Verdrahtung ueber echte HTTP-Requests, nicht der isolierte Funktionsaufruf.
 */
function buildApp(): Hono {
  const app = new Hono();
  app.use("*", hubAuthMiddleware());
  app.post(PROTECTED_PATH, requireMexpRole("admin"), (c) => c.json({ ok: true }));
  return app;
}

async function requestAsHubUser(headers: Record<string, string>): Promise<Response> {
  const app = buildApp();
  return app.request(PROTECTED_PATH, { method: "POST", headers });
}

describe("requireMexpRole an den Import-Endpunkten (Adminrechte-Gate)", () => {
  beforeEach(() => {
    mexpUserStore.clear();
  });

  it("laesst einen Hub-Admin durch, auch ohne Store-Eintrag", async () => {
    const res = await requestAsHubUser({
      "X-MSQ-User-Id": "u-hubadmin",
      "X-MSQ-User-Email": "hubadmin@mindsquare.de",
      "X-MSQ-Roles": "AppHub.Admin",
    });

    expect(res.status).toBe(200);
    expect(mexpUserStore.get("u-hubadmin")).toBeUndefined();
  });

  it("laesst einen Nutzer mit der Store-Rolle admin durch", async () => {
    mexpUserStore.set("u-admin", makeStoredUser({ id: "u-admin", roles: ["admin"] }));

    const res = await requestAsHubUser({
      "X-MSQ-User-Id": "u-admin",
      "X-MSQ-User-Email": "admin@mindsquare.de",
    });

    expect(res.status).toBe(200);
  });

  it("weist einen Nutzer mit der Rolle manager mit 403 ab", async () => {
    mexpUserStore.set("u-manager", makeStoredUser({ id: "u-manager", roles: ["manager"] }));

    const res = await requestAsHubUser({
      "X-MSQ-User-Id": "u-manager",
      "X-MSQ-User-Email": "manager@mindsquare.de",
    });

    expect(res.status).toBe(403);
  });

  it("weist einen Nutzer mit der Rolle event_office mit 403 ab", async () => {
    mexpUserStore.set(
      "u-event-office",
      makeStoredUser({ id: "u-event-office", roles: ["event_office"] }),
    );

    const res = await requestAsHubUser({
      "X-MSQ-User-Id": "u-event-office",
      "X-MSQ-User-Email": "eventoffice@mindsquare.de",
    });

    expect(res.status).toBe(403);
  });

  it("weist einen unbekannten Nutzer (wird zu participant) mit 403 ab", async () => {
    const res = await requestAsHubUser({
      "X-MSQ-User-Id": "u-unknown",
      "X-MSQ-User-Email": "neu@mindsquare.de",
    });

    expect(res.status).toBe(403);
    expect(mexpUserStore.get("u-unknown")?.roles).toEqual(["participant"]);
  });
});
