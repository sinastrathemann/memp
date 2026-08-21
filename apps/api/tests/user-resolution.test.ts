import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HubUser } from "@mexp/auth";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { beforeEach, describe, expect, it } from "vitest";

// MEXP_DATA_DIR muss VOR dem ersten Import von _user-resolution.js gesetzt sein --
// dev-persistence.ts liest den Wert beim Modul-Laden. Ohne diese Umleitung wuerde
// dieser Test die echten Dev-Daten unter apps/api/data/memp-users.json ueberschreiben.
process.env.MEXP_DATA_DIR = mkdtempSync(join(tmpdir(), "mexp-user-resolution-test-"));

// Ebenfalls vor dem ersten Aufruf setzen: isBootstrapAdmin liest ueber loadEnv(), das
// Ergebnis wird pro Prozess gecacht (siehe packages/shared/src/env.ts) -- die Variable
// gilt also fuer die gesamte Testdatei einheitlich, passend zum echten Boot-Verhalten.
const BOOTSTRAP_EMAIL = "bootstrap-admin@mindsquare.de";
process.env.MEXP_BOOTSTRAP_ADMINS = BOOTSTRAP_EMAIL;

// Dynamischer Import statt eines statischen: ein statischer Import wuerde vor obigen
// process.env-Zuweisungen ausgewertet (ESM hebt Imports an den Dateianfang).
const { mexpUserStore, resolveMexpRoles } = await import("../src/routes/_user-resolution.js");
const { LAST_SEEN_THROTTLE_MS } = await import("../src/routes/_last-seen.js");

type MexpUser = NonNullable<ReturnType<typeof mexpUserStore.get>>;

function makeStoredUser(overrides: Partial<MexpUser> & Pick<MexpUser, "id">): MexpUser {
  const now = new Date().toISOString();
  return {
    email: null,
    displayName: null,
    roles: [],
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeHubUser(overrides: Partial<HubUser> & Pick<HubUser, "id">): HubUser {
  return {
    email: null,
    name: null,
    roles: [],
    groups: [],
    authTime: new Date().toISOString(),
    isGuest: false,
    isHubAdmin: false,
    ...overrides,
  };
}

/** Schlanker Doppelgaenger fuer den Hono-Context: setzt hubUser direkt, wie es
 *  hubAuthMiddleware in echt tun wuerde -- getHubUser liest ihn ueber c.get("hubUser"). */
function withHubUser(hubUser: HubUser): MiddlewareHandler {
  return async (c, next) => {
    c.set("hubUser", hubUser);
    await next();
  };
}

async function callResolve(hubUser: HubUser): Promise<string[]> {
  const app = new Hono();
  app.use("*", withHubUser(hubUser));
  app.get("/roles", (c) => c.json({ roles: resolveMexpRoles(c) }));
  const res = await app.request("/roles");
  const body = (await res.json()) as { roles: string[] };
  return body.roles;
}

describe("resolveMexpRoles", () => {
  beforeEach(() => {
    mexpUserStore.clear();
  });

  it("laesst Bootstrap greifen, wenn AppHub.Admin fehlt", async () => {
    const roles = await callResolve(makeHubUser({ id: "u-bootstrap-1", email: BOOTSTRAP_EMAIL }));
    expect(roles).toEqual(["admin"]);
  });

  it("laesst AppHub.Admin Vorrang behalten", async () => {
    mexpUserStore.set(
      "u-hubadmin-1",
      makeStoredUser({
        id: "u-hubadmin-1",
        email: "hubadmin@mindsquare.de",
        roles: ["participant"],
      }),
    );

    const roles = await callResolve(
      makeHubUser({ id: "u-hubadmin-1", email: "hubadmin@mindsquare.de", isHubAdmin: true }),
    );
    expect(roles).toEqual(["admin"]);
  });

  it("registriert eine unbekannte Person als participant", async () => {
    const roles = await callResolve(makeHubUser({ id: "u-unknown-1", email: "neu@mindsquare.de" }));
    expect(roles).toEqual(["participant"]);
    expect(mexpUserStore.get("u-unknown-1")?.roles).toEqual(["participant"]);
  });

  it("registriert den Bootstrap-Admin im Store (K2)", async () => {
    expect(mexpUserStore.get("u-bootstrap-2")).toBeUndefined();

    await callResolve(makeHubUser({ id: "u-bootstrap-2", email: BOOTSTRAP_EMAIL }));

    const stored = mexpUserStore.get("u-bootstrap-2");
    expect(stored).toBeDefined();
    expect(stored?.roles).toEqual(["admin"]);
  });

  it("ergaenzt admin bei einem bekannten Nutzer, ohne vorhandene Rollen zu ersetzen (K2/G6)", async () => {
    mexpUserStore.set(
      "u-known-1",
      makeStoredUser({
        id: "u-known-1",
        email: BOOTSTRAP_EMAIL,
        roles: ["manager", "event_office"],
      }),
    );

    const roles = await callResolve(makeHubUser({ id: "u-known-1", email: BOOTSTRAP_EMAIL }));

    expect([...roles].sort()).toEqual(["admin", "event_office", "manager"]);
    expect([...(mexpUserStore.get("u-known-1")?.roles ?? [])].sort()).toEqual([
      "admin",
      "event_office",
      "manager",
    ]);
  });

  it("setzt lastSeenAt beim Hub-Admin-Zweig, wenn bereits ein Store-Eintrag existiert (W1)", async () => {
    const stale = new Date(Date.now() - LAST_SEEN_THROTTLE_MS - 1000).toISOString();
    mexpUserStore.set(
      "u-hubadmin-2",
      makeStoredUser({
        id: "u-hubadmin-2",
        email: "hubadmin2@mindsquare.de",
        roles: ["participant"],
        lastSeenAt: stale,
      }),
    );

    await callResolve(
      makeHubUser({ id: "u-hubadmin-2", email: "hubadmin2@mindsquare.de", isHubAdmin: true }),
    );

    expect(mexpUserStore.get("u-hubadmin-2")?.lastSeenAt).not.toBe(stale);
  });

  it("legt fuer einen Hub-Admin ohne Store-Eintrag keinen neuen Eintrag an", async () => {
    await callResolve(
      makeHubUser({ id: "u-hubadmin-3", email: "hubadmin3@mindsquare.de", isHubAdmin: true }),
    );
    expect(mexpUserStore.get("u-hubadmin-3")).toBeUndefined();
  });

  it("drosselt lastSeenAt auf hoechstens einmal pro Stunde", async () => {
    const withinWindow = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    mexpUserStore.set(
      "u-known-2",
      makeStoredUser({
        id: "u-known-2",
        email: "bekannt@mindsquare.de",
        roles: ["participant"],
        lastSeenAt: withinWindow,
      }),
    );

    await callResolve(makeHubUser({ id: "u-known-2", email: "bekannt@mindsquare.de" }));
    expect(mexpUserStore.get("u-known-2")?.lastSeenAt).toBe(withinWindow);

    const stale = new Date(Date.now() - LAST_SEEN_THROTTLE_MS - 1000).toISOString();
    mexpUserStore.set(
      "u-known-2",
      makeStoredUser({
        id: "u-known-2",
        email: "bekannt@mindsquare.de",
        roles: ["participant"],
        lastSeenAt: stale,
      }),
    );

    await callResolve(makeHubUser({ id: "u-known-2", email: "bekannt@mindsquare.de" }));
    expect(mexpUserStore.get("u-known-2")?.lastSeenAt).not.toBe(stale);
  });
});
