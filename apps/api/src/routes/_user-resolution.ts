/**
 * mEXP-interne Rollen (admin, manager, event_office, budget_owner, werkstudent, participant,
 * read_only) leben getrennt von der Hub-Identität. Der Hub liefert nur, WER jemand ist
 * (X-MSQ-User-Id / X-MSQ-Roles / isHubAdmin) — welche mEXP-Rechte diese Person innerhalb der
 * App hat, verwalten wir selbst, keyed by Hub-User-Id.
 */
import { getHubUser, isBootstrapAdmin } from "@mexp/auth";
import { rootLogger } from "@mexp/shared";
import type { Context, MiddlewareHandler } from "hono";
import { persistentMap } from "../dev-persistence.js";

const log = rootLogger.child({ module: "api/user-resolution" });

export interface MexpUser {
  id: string;
  email: string | null;
  displayName: string | null;
  roles: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  // --- Personio-Sync (optional; nur gesetzt für User, die aus Personio stammen oder
  // per Sync mit einem Personio-Employee verknüpft wurden — siehe admin-personio.ts).
  // Bestehende User ohne Personio-Bezug bleiben unangetastet: alle Felder optional. ---
  personioId?: string;
  department?: string | null;
  team?: string | null;
  position?: string | null;
  office?: string | null;
  /** Rohstatus aus Personio: "active" | "inactive" | "onboarding" | "leave" | "removed" (Reverse-Sync). */
  personioStatus?: string | null;
  personioSyncedAt?: string;
  // --- SharePoint-Sync (optional; nur gesetzt für Werkstudenten/Praktikanten, die aus der
  // SharePoint-Liste stammen oder per Sync damit verknüpft wurden — siehe
  // admin-sharepoint.ts). Kann gemeinsam mit personioId gesetzt sein, falls ein Studi
  // zusätzlich in Personio geführt wird (E-Mail-Match findet dann denselben User). ---
  sharepointStudiId?: string;
  sharepointSyncedAt?: string;
  // --- CSV-Import (optional; nur gesetzt für User, die per manuellem CSV-Upload
  // angelegt/aktualisiert wurden — siehe admin-users-import.ts. Alternative zum
  // SharePoint-Graph-Sync, solange keine Azure-App-Registrierung mit Admin-Freigabe
  // verfügbar ist. Kann gemeinsam mit personioId/sharepointStudiId gesetzt sein. ---
  csvImportedAt?: string;
}

// Persistiert in apps/api/data/memp-users.json — bleibt bei Neustarts erhalten
// (Storage-Key bewusst nicht umbenannt: physische Datei aus Bestandsdaten bliebe sonst verwaist.)
export const mexpUserStore = persistentMap<MexpUser>("memp-users");

/**
 * Liefert die mEXP-internen Rollen des aktuell eingeloggten Hub-Users.
 * - Hub-Admins (isHubAdmin === true) bekommen immer ["admin"] — unconditional override.
 * - Bootstrap-Admins (MEXP_BOOTSTRAP_ADMINS, siehe isBootstrapAdmin) bekommen ebenfalls
 *   ["admin"] — Notausgang, solange im Hub niemand AppHub.Admin hat.
 * - Unbekannte Hub-User werden beim ersten Request automatisch mit Rolle "participant" registriert.
 */
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

  const now = new Date().toISOString();
  const fresh: MexpUser = {
    id: hub.id,
    email: hub.email,
    displayName: hub.name,
    roles: ["participant"],
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  mexpUserStore.set(hub.id, fresh);
  return fresh.roles;
}

/**
 * Middleware-Factory: lässt den Request durch, wenn der Hub-User Hub-Admin ist ODER
 * mindestens eine der übergebenen mEXP-internen Rollen besitzt. Ersetzt das alte
 * `requireRole(...roles)` (variadic) aus der gelöschten Cookie-Session-Middleware.
 */
export function requireMexpRole(...allowed: string[]): MiddlewareHandler {
  return async (c, next) => {
    const hub = getHubUser(c);
    if (hub.isHubAdmin) return next();
    const mexpRoles = resolveMexpRoles(c);
    if (allowed.some((r) => mexpRoles.includes(r))) return next();
    return c.json({ error: { code: "FORBIDDEN", message: "Nicht berechtigt" } }, 403);
  };
}
