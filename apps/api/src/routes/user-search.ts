/**
 * Read-only Live-Suche über alle mEXP-User (Personio-synced + manuell angelegt), für
 * Admin/Manager-Workflows wie "Teilnehmer manuell zu Event hinzufügen" (siehe events.ts
 * POST /:id/participants). Getrennt von admin-users.ts, weil dort admin-only CRUD auf
 * Rollen/Aktiv-Status lebt — diese Route ist bewusst nur Suche, für alle WRITE_ROLES.
 */
import { Hono } from "hono";
import { mexpUserStore, requireMexpRole } from "./_user-resolution.js";

// Gleiche Schreibrechte wie in events.ts (Anmeldungen verwalten ist kein Delete).
const WRITE_ROLES = ["admin", "manager", "event_office", "werkstudent"] as const;

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;
const MIN_QUERY_LENGTH = 2;

export interface UserSearchResult {
  id: string;
  displayName: string;
  email: string | null;
  department: string | null;
  team: string | null;
  position: string | null;
  isActive: boolean;
}

export const userSearchRoutes = new Hono();

// GET /api/users/search?q=<query>&limit=20
// Durchsucht displayName + email case-insensitive (contains). Deaktivierte User werden
// übersprungen. Sortierung: Prefix-Treffer auf den Namen zuerst, dann alphabetisch.
userSearchRoutes.get("/search", requireMexpRole(...WRITE_ROLES), (c) => {
  const query = (c.req.query("q") ?? "").trim().toLowerCase();
  const limitParam = Number(c.req.query("limit") ?? DEFAULT_LIMIT);
  const limit = Math.min(
    Number.isFinite(limitParam) && limitParam > 0 ? limitParam : DEFAULT_LIMIT,
    MAX_LIMIT,
  );

  if (query.length < MIN_QUERY_LENGTH) {
    return c.json({ users: [] });
  }

  const results: UserSearchResult[] = [];
  for (const user of mexpUserStore.values()) {
    if (user.isActive === false) continue;
    const name = (user.displayName ?? "").toLowerCase();
    const email = (user.email ?? "").toLowerCase();
    if (!name.includes(query) && !email.includes(query)) continue;
    results.push({
      id: user.id,
      displayName: user.displayName ?? user.id,
      email: user.email,
      department: user.department ?? null,
      team: user.team ?? null,
      position: user.position ?? null,
      isActive: user.isActive,
    });
  }

  results.sort((a, b) => {
    const aStarts = a.displayName.toLowerCase().startsWith(query) ? 0 : 1;
    const bStarts = b.displayName.toLowerCase().startsWith(query) ? 0 : 1;
    if (aStarts !== bStarts) return aStarts - bStarts;
    return a.displayName.localeCompare(b.displayName);
  });

  return c.json({ users: results.slice(0, limit) });
});

// GET /api/users/facets → eindeutige Teams + Departments aus mexpUserStore (Personio-Sync),
// für die audienceScope-Dropdowns "Nur bestimmte Teams" / "Nur bestimmte Bereiche" bei
// Event-Anlegen/-Bearbeiten (siehe events.ts). Deaktivierte User werden übersprungen.
userSearchRoutes.get("/facets", requireMexpRole(...WRITE_ROLES), (c) => {
  const teams = new Set<string>();
  const departments = new Set<string>();
  for (const u of mexpUserStore.values()) {
    if (u.isActive === false) continue;
    if (u.team) teams.add(u.team);
    if (u.department) departments.add(u.department);
  }
  return c.json({
    teams: [...teams].sort((a, b) => a.localeCompare(b, "de")),
    departments: [...departments].sort((a, b) => a.localeCompare(b, "de")),
  });
});
