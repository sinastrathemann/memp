import { requireHubAdmin } from "@mexp/auth";
/**
 * Manueller SharePoint-Werkstudi/Praktikanten-Sync (Sinas Design-Entscheidung: Button
 * statt CRON, analog zum Personio-Sync in admin-personio.ts).
 * - Werkstudenten/Praktikanten sind NICHT in Personio, sondern in einer SharePoint-Liste
 *   gepflegt (Microsoft Graph API, App-only Client-Credentials-Flow).
 * - Neue Studis (per E-Mail-Match) → auto als mEXP-User mit Rolle "participant"
 *   (Sinas Wahl — konservativ, nicht "werkstudent").
 * - Bestehende mEXP-User (E-Mail-Match) → Position/Team aktualisiert, Rolle bleibt
 *   unangetastet (könnte bereits ein Personio-User mit anderer Rolle sein).
 * - mEXP-User mit `sharepointStudiId`, die nicht mehr in der aktuellen SharePoint-Liste
 *   auftauchen (Vertragsende) → in mEXP deaktiviert (isActive=false), NICHT gelöscht —
 *   historische Teilnahmen bleiben erhalten.
 * Hub-Admin-only (requireHubAdmin): der Sync legt/ändert User account-weit, das ist
 * bewusst strenger als das mEXP-interne "admin"-Rolle-Gate von admin-users.ts.
 */
import { SharePointClient } from "@mexp/infrastructure";
import { rootLogger } from "@mexp/shared";
import { Hono } from "hono";
import { env } from "../deps.js";
import { type MexpUser, mexpUserStore } from "./_user-resolution.js";

const log = rootLogger.child({ module: "api/admin/sharepoint" });

export const adminSharepointRoutes = new Hono();

adminSharepointRoutes.post("/sync-studis", requireHubAdmin(), async (c) => {
  if (
    !env.AZURE_TENANT_ID ||
    !env.AZURE_CLIENT_ID ||
    !env.AZURE_CLIENT_SECRET ||
    !env.SHAREPOINT_SITE_URL ||
    !env.SHAREPOINT_STUDIS_LIST_ID
  ) {
    return c.json(
      {
        error: "sharepoint_not_configured",
        message:
          "AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET / SHAREPOINT_SITE_URL / " +
          "SHAREPOINT_STUDIS_LIST_ID fehlen in der .env. Siehe docs/sharepoint-integration.md.",
      },
      400,
    );
  }

  const client = new SharePointClient(
    env.AZURE_TENANT_ID,
    env.AZURE_CLIENT_ID,
    env.AZURE_CLIENT_SECRET,
    env.SHAREPOINT_SITE_URL,
    env.SHAREPOINT_STUDIS_LIST_ID,
  );

  try {
    const studis = await client.listStudis();
    const now = new Date().toISOString();
    let created = 0;
    let updated = 0;
    let deactivated = 0;
    let skippedNoEmail = 0;

    // Emails der aktuellen SharePoint-Liste (fürs Reverse-Sync unten)
    const spEmails = new Set(
      studis
        .map((s) => s.email)
        .filter((e): e is string => !!e)
        .map((e) => e.toLowerCase()),
    );

    for (const studi of studis) {
      if (!studi.email) {
        skippedNoEmail++;
        continue;
      }
      const email = studi.email.toLowerCase();

      let existing: MexpUser | undefined;
      for (const u of mexpUserStore.values()) {
        if (u.email?.toLowerCase() === email) {
          existing = u;
          break;
        }
      }

      if (existing) {
        // Update, aber NICHT die Rolle überschreiben (der User könnte in Personio als
        // Employee mit anderer Rolle sein).
        mexpUserStore.set(existing.id, {
          ...existing,
          sharepointStudiId: studi.id,
          position: studi.position ?? existing.position ?? null,
          team: studi.team ?? existing.team ?? null,
          sharepointSyncedAt: now,
          isActive: true, // aktiv in SharePoint = aktiv in mEXP
          updatedAt: now,
        });
        updated++;
      } else {
        const id = `sharepoint-studi-${studi.id}`;
        const fresh: MexpUser = {
          id,
          email,
          displayName: studi.displayName,
          roles: ["participant"], // Sinas Wahl
          isActive: true,
          createdAt: now,
          updatedAt: now,
          sharepointStudiId: studi.id,
          position: studi.position,
          team: studi.team,
          sharepointSyncedAt: now,
        };
        mexpUserStore.set(id, fresh);
        created++;
      }
    }

    // Reverse-Sync: User mit sharepointStudiId, die nicht mehr in SP-Liste sind → deaktivieren
    for (const u of mexpUserStore.values()) {
      if (u.sharepointStudiId && u.email && !spEmails.has(u.email.toLowerCase())) {
        if (u.isActive !== false) {
          mexpUserStore.set(u.id, {
            ...u,
            isActive: false,
            sharepointSyncedAt: now,
            updatedAt: now,
          });
          deactivated++;
        }
      }
    }

    log.info(
      { total: studis.length, created, updated, deactivated, skippedNoEmail },
      "sharepoint studis sync done",
    );
    return c.json({
      ok: true,
      total: studis.length,
      created,
      updated,
      deactivated,
      skippedNoEmail,
      syncedAt: now,
    });
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : String(err) },
      "sharepoint studis sync failed",
    );
    return c.json(
      {
        error: "sharepoint_sync_failed",
        message: err instanceof Error ? err.message : "Unknown error",
      },
      500,
    );
  }
});
