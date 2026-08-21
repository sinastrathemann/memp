/**
 * Manueller Personio-Employee-Sync (Sinas Design-Entscheidung: Button statt CRON).
 * - Neue Employees (per E-Mail-Match) → auto als mEXP-User mit Rolle "participant".
 * - Bestehende mEXP-User (E-Mail-Match) → Department/Position/Office/Status aktualisiert.
 * - mEXP-User mit `personioId`, die nicht mehr in der aktuellen Personio-Liste auftauchen
 *   (Austritt) → in mEXP deaktiviert (isActive=false), NICHT gelöscht — historische
 *   Teilnahmen bleiben erhalten.
 * Admin-only (requireMexpRole("admin")): der Sync legt/aendert User account-weit.
 * Die mEXP-Adminrolle wird ausschliesslich von Admins vergeben; requireMexpRole prueft
 * hub.isHubAdmin selbst zuerst (siehe packages/auth/src/hub-middleware.ts) — echte
 * Hub-Admins sind also eingeschlossen.
 */
import { PersonioClient } from "@mexp/infrastructure";
import { rootLogger } from "@mexp/shared";
import { Hono } from "hono";
import { env } from "../deps.js";
import { type MexpUser, mexpUserStore, requireMexpRole } from "./_user-resolution.js";

const log = rootLogger.child({ module: "api/admin/personio" });

export const adminPersonioRoutes = new Hono();

adminPersonioRoutes.post("/sync", requireMexpRole("admin"), async (c) => {
  if (!env.PERSONIO_CLIENT_ID || !env.PERSONIO_CLIENT_SECRET) {
    return c.json(
      {
        error: "personio_not_configured",
        message:
          "PERSONIO_CLIENT_ID / PERSONIO_CLIENT_SECRET fehlen in der .env. Siehe docs/personio-integration.md.",
      },
      400,
    );
  }

  const client = new PersonioClient(
    env.PERSONIO_CLIENT_ID,
    env.PERSONIO_CLIENT_SECRET,
    env.PERSONIO_API_URL,
  );

  try {
    const employees = await client.listEmployees();
    const now = new Date().toISOString();
    let created = 0;
    let updated = 0;
    let deactivated = 0;

    // Für den Reverse-Sync unten: welche E-Mails sind aktuell (noch) in Personio bekannt.
    const personioEmails = new Set(
      employees
        .map((e) => e.email)
        .filter((email): email is string => email !== null)
        .map((email) => email.toLowerCase()),
    );

    for (const emp of employees) {
      if (!emp.email) continue; // ohne E-Mail kein Match gegen mEXP-User möglich
      const email = emp.email.toLowerCase();

      let existing: MexpUser | undefined;
      for (const u of mexpUserStore.values()) {
        if (u.email?.toLowerCase() === email) {
          existing = u;
          break;
        }
      }

      const personioActive = emp.status === "active";

      if (existing) {
        mexpUserStore.set(existing.id, {
          ...existing,
          personioId: emp.id,
          department: emp.department,
          team: emp.team,
          position: emp.position,
          office: emp.office,
          personioStatus: emp.status,
          personioSyncedAt: now,
          isActive: personioActive,
          updatedAt: now,
        });
        updated++;
      } else {
        // Neu anlegen: synthetische ID, wird beim Erst-Login über den Hub durch die
        // echte Entra-Id ersetzt (Hub-Auth matcht ohnehin per E-Mail, nicht per Id).
        const id = `personio-${emp.id}`;
        const displayName = `${emp.first_name ?? ""} ${emp.last_name ?? ""}`.trim() || email;
        const fresh: MexpUser = {
          id,
          email,
          displayName,
          roles: ["participant"],
          isActive: personioActive,
          createdAt: now,
          updatedAt: now,
          personioId: emp.id,
          department: emp.department,
          team: emp.team,
          position: emp.position,
          office: emp.office,
          personioStatus: emp.status,
          personioSyncedAt: now,
        };
        mexpUserStore.set(id, fresh);
        if (personioActive) created++;
      }
    }

    // Reverse-Sync: mEXP-User, die per Personio-Sync verknüpft waren (personioId gesetzt)
    // aber in der aktuellen Personio-Liste nicht mehr auftauchen (Austritt) → deaktivieren.
    for (const u of mexpUserStore.values()) {
      if (u.personioId && u.email && !personioEmails.has(u.email.toLowerCase())) {
        if (u.isActive !== false) {
          mexpUserStore.set(u.id, {
            ...u,
            isActive: false,
            personioStatus: "removed",
            personioSyncedAt: now,
            updatedAt: now,
          });
          deactivated++;
        }
      }
    }

    log.info({ created, updated, deactivated, total: employees.length }, "personio sync done");
    return c.json({
      ok: true,
      total: employees.length,
      created,
      updated,
      deactivated,
      syncedAt: now,
    });
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : String(err) }, "personio sync failed");
    return c.json(
      {
        error: "personio_sync_failed",
        message: err instanceof Error ? err.message : "Unknown error",
      },
      500,
    );
  }
});
