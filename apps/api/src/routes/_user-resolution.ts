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
import { shouldTouchLastSeen } from "./_last-seen.js";

const log = rootLogger.child({ module: "api/user-resolution" });

// W6: ohne diese Drossel loggt resolveMexpRoles bei JEDEM authentifizierten Request
// des Bootstrap-Admins eine Warnung -- ein Arbeitstag erzeugt hunderte identischer
// Zeilen. Pro Prozess und Hub-User-Id genuegt eine einzige Zeile; der Prozess lebt
// kurz genug (Container-Neustart), dass ein Set auf Modulebene nicht unbegrenzt waechst.
const bootstrapWarned = new Set<string>();

function logBootstrapGrantOnce(hubUserId: string): void {
  if (bootstrapWarned.has(hubUserId)) return;
  bootstrapWarned.add(hubUserId);
  // Absichtlich laut: sonst raetselt spaeter jemand, woher die Rechte kamen. E-Mail
  // bleibt draussen (PII), die Hub-User-Id genuegt zur Zuordnung.
  log.warn({ userId: hubUserId }, "admin granted via MEXP_BOOTSTRAP_ADMINS");
}

/**
 * Schreibt lastSeenAt nur, wenn fuer diese Hub-User-Id bereits ein Store-Eintrag
 * existiert -- legt bewusst KEINEN neuen an. Hub-Admins beziehen ihre Rechte allein
 * aus der Hub-Rolle AppHub.Admin, nicht aus dem Store; wuerde hier automatisch ein
 * Eintrag angelegt, laende jede Person mit AppHub.Admin allein durchs Einloggen in
 * der Nutzerliste, auch ohne je mEXP-seitig registriert worden zu sein. Existiert
 * aber schon ein Eintrag (z. B. aus einem frueheren Import), soll lastSeenAt trotzdem
 * fortgeschrieben werden -- sonst zeigt die Nutzerliste fuer aktive Hub-Admins
 * dauerhaft "-" (Befund W1).
 */
function touchLastSeenIfKnown(hubUserId: string): void {
  const known = mexpUserStore.get(hubUserId);
  if (!known) return;
  const now = Date.now();
  if (shouldTouchLastSeen(known.lastSeenAt, now)) {
    mexpUserStore.set(hubUserId, { ...known, lastSeenAt: new Date(now).toISOString() });
  }
}

export interface MexpUser {
  id: string;
  email: string | null;
  displayName: string | null;
  roles: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** Letzter authentifizierter Request dieser Person. Hoechstens stuendlich
   *  fortgeschrieben — siehe _last-seen.ts. */
  lastSeenAt?: string;
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
 * - Hub-Admins (isHubAdmin === true) bekommen immer ["admin"] — unconditional override,
 *   unabhaengig von einem eventuell vorhandenen Store-Eintrag.
 * - Bootstrap-Admins (MEXP_BOOTSTRAP_ADMINS, siehe isBootstrapAdmin) durchlaufen denselben
 *   Registrierungspfad wie ein unbekannter Nutzer, nur mit "admin" in den Rollen — bei
 *   einem bereits bekannten Nutzer wird "admin" ergaenzt, nicht die vorhandenen Rollen
 *   ersetzt (mEXP-Rollen sind additiv, siehe Befund K2/G6). So landet die Person im Store,
 *   taucht in GET /admin/users auf und kann sich eine dauerhafte Rolle geben.
 * - Unbekannte Hub-User werden beim ersten Request automatisch mit Rolle "participant" registriert.
 */
export function resolveMexpRoles(c: Context): string[] {
  const hub = getHubUser(c);

  if (hub.isHubAdmin) {
    touchLastSeenIfKnown(hub.id);
    return ["admin"];
  }

  // Notausgang, solange im Hub niemand AppHub.Admin hat.
  const bootstrap = isBootstrapAdmin(hub.email);
  if (bootstrap) logBootstrapGrantOnce(hub.id);

  const known = mexpUserStore.get(hub.id);
  if (known) {
    const now = Date.now();
    const grantsAdmin = bootstrap && !known.roles.includes("admin");
    const touch = shouldTouchLastSeen(known.lastSeenAt, now);

    if (grantsAdmin) {
      const updated: MexpUser = {
        ...known,
        roles: [...known.roles, "admin"],
        updatedAt: new Date(now).toISOString(),
      };
      // exactOptionalPropertyTypes: lastSeenAt nur bei Bedarf setzen, sonst bleibt der
      // vorhandene Wert (oder das Fehlen) unangetastet statt explizit auf undefined.
      if (touch) updated.lastSeenAt = new Date(now).toISOString();
      mexpUserStore.set(hub.id, updated);
      return updated.roles;
    }

    if (touch) {
      mexpUserStore.set(hub.id, { ...known, lastSeenAt: new Date(now).toISOString() });
    }
    return known.roles;
  }

  const now = new Date().toISOString();
  const fresh: MexpUser = {
    id: hub.id,
    email: hub.email,
    displayName: hub.name,
    roles: bootstrap ? ["admin"] : ["participant"],
    isActive: true,
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
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
