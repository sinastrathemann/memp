// Dev-mode persistence enabled
import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import {
  checkInParticipant,
  createEvent,
  getEvent,
  getOwnParticipation,
  listEvents,
  listParticipants,
  markNoShow,
  promoteFromWaitlist,
  registerForEvent,
  transitionEventStatus,
  updateEvent,
  withdrawFromEvent,
} from "@mexp/application";
import { getHubUser } from "@mexp/auth";
import {
  EVENT_STATUSES,
  EVENT_TYPES,
  EVENT_VISIBILITIES,
  InvalidEventDatesError,
} from "@mexp/domain";
import { Hono } from "hono";
import { z } from "zod";
import { events, audit, env, participations } from "../deps.js";
import { persistentMap } from "../dev-persistence.js";
import { mexpUserStore, requireMexpRole, resolveMexpRoles } from "./_user-resolution.js";
import {
  devAnswerStore,
  devFormStore,
  devLiveParticipantsStore,
  validateAnswers,
} from "./registration-form.js";

const eventTypeSchema = z.enum(EVENT_TYPES);
const eventVisibilitySchema = z.enum(EVENT_VISIBILITIES);
const eventStatusSchema = z.enum(EVENT_STATUSES);
const isoDateSchema = z.string().datetime({ offset: true });

const createEventSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).default(""),
  eventType: eventTypeSchema,
  visibility: eventVisibilitySchema.default("internal"),
  startAt: isoDateSchema,
  endAt: isoDateSchema,
  location: z.string().max(500).nullable().default(null),
  locationDetails: z.string().max(5000).nullable().default(null),
  capacity: z.number().int().positive().nullable().default(null),
  registrationDeadline: isoDateSchema.nullable().optional(),
  audienceScope: z.enum(["all", "roles", "emails", "teams", "departments"]).default("all"),
  audienceRoles: z.array(z.string().max(64)).max(20).default([]),
  audienceEmails: z.array(z.string().email()).max(200).default([]),
  audienceTeams: z.array(z.string().max(200)).max(100).default([]),
  audienceDepartments: z.array(z.string().max(200)).max(100).default([]),
});

const updateEventSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).optional(),
    eventType: eventTypeSchema.optional(),
    visibility: eventVisibilitySchema.optional(),
    startAt: isoDateSchema.optional(),
    endAt: isoDateSchema.optional(),
    location: z.string().max(500).nullable().optional(),
    locationDetails: z.string().max(5000).nullable().optional(),
    capacity: z.number().int().positive().nullable().optional(),
    registrationDeadline: isoDateSchema.nullable().optional(),
    audienceScope: z.enum(["all", "roles", "emails", "teams", "departments"]).optional(),
    audienceRoles: z.array(z.string().max(64)).max(20).optional(),
    audienceEmails: z.array(z.string().email()).max(200).optional(),
    audienceTeams: z.array(z.string().max(200)).max(100).optional(),
    audienceDepartments: z.array(z.string().max(200)).max(100).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Mindestens ein Feld muss gesetzt sein" });

const transitionSchema = z.object({ status: eventStatusSchema });

const listQuerySchema = z.object({
  status: eventStatusSchema.optional(),
  mine: z.enum(["true", "false"]).optional(),
});

// Schreibrechte: anlegen + bearbeiten. Werkstudent dürfen mitarbeiten, aber NICHT löschen.
const WRITE_ROLES = ["admin", "manager", "event_office", "werkstudent"] as const;

// Dev-Mode: Override-Store für Events (eventId → Patch)
// Persistiert in apps/api/data/event-overrides.json — bleibt bei Neustarts erhalten
// Exportiert, damit lesende Routen (z. B. dashboard.ts) DIESELBE Instanz benutzen.
// Eine zweite persistentMap auf dieselbe Datei liest nur beim Prozessstart und
// friert danach ein — siehe Audit-Finding FUN-08.
export const devEventOverrideStore = persistentMap<Record<string, unknown>>("event-overrides");

function applyOverride<T extends { id: string }>(event: T): T {
  const ov = devEventOverrideStore.get(event.id);
  if (!ov) return event;
  return { ...event, ...ov };
}

// Dev-Mode (file-store — Design-Spec §3.4): Store für neu angelegte Events.
// Persistiert in apps/api/data/created-events.json — bleibt bei Neustarts erhalten.
// Ergänzt die statische Mock-Liste um "echte" per POST /api/events angelegte Events,
// damit Create/Update/Delete/Status-Transition ohne DATABASE_URL vollständig funktionieren.
export interface DevEventRecord {
  id: string;
  [key: string]: unknown;
}

// Exportiert — gleiche Begruendung wie bei devEventOverrideStore (FUN-08).
export const devCreatedEventsStore = persistentMap<DevEventRecord>("created-events");

function listDevBaseEvents(): DevEventRecord[] {
  return [
    ...(buildMockEventList() as unknown as DevEventRecord[]),
    ...Array.from(devCreatedEventsStore.values()),
  ];
}

function findDevBaseEvent(id: string): DevEventRecord | undefined {
  return devCreatedEventsStore.get(id) ?? listDevBaseEvents().find((e) => e.id === id);
}

export interface DevEventCreateInput {
  title: string;
  description: string;
  eventType: string;
  visibility: string;
  startAt: string;
  endAt: string;
  location: string | null;
  locationDetails?: string | null;
  capacity: number | null;
  registrationDeadline?: string | null;
  ownerId: string;
  audienceScope?: string;
  audienceRoles?: string[];
  audienceEmails?: string[];
  audienceTeams?: string[];
  audienceDepartments?: string[];
}

// Exportiert für Wiederverwendung durch blueprints.ts (Blueprint → Event im Dev-Mode).
export function createDevEvent(input: DevEventCreateInput): DevEventRecord {
  if (new Date(input.endAt).getTime() <= new Date(input.startAt).getTime()) {
    throw new InvalidEventDatesError();
  }
  const now = new Date().toISOString();
  const event: DevEventRecord = {
    id: randomUUID(),
    title: input.title,
    description: input.description,
    eventType: input.eventType,
    visibility: input.visibility,
    status: "draft",
    startAt: input.startAt,
    endAt: input.endAt,
    location: input.location,
    locationDetails: input.locationDetails ?? null,
    capacity: input.capacity,
    registrationDeadline: input.registrationDeadline ?? null,
    ownerId: input.ownerId,
    audienceScope: input.audienceScope ?? "all",
    audienceRoles: input.audienceRoles ?? [],
    audienceEmails: input.audienceEmails ?? [],
    audienceTeams: input.audienceTeams ?? [],
    audienceDepartments: input.audienceDepartments ?? [],
    createdAt: now,
    updatedAt: now,
  };
  devCreatedEventsStore.set(event.id, event);
  return event;
}

function buildMockEventList() {
  const now = new Date();
  const inDays = (d: number) => new Date(now.getTime() + d * 86400000).toISOString();
  const addHours = (iso: string, h: number) =>
    new Date(new Date(iso).getTime() + h * 3600000).toISOString();
  const ownerId = "550e8400-e29b-41d4-a716-446655440000";
  return [
    {
      id: "evt-001",
      title: "Code & Pizza — Frontend Night",
      description: "Lockerer Code-Abend rund um React, Vite und neue UI-Pattern.",
      eventType: "team",
      visibility: "internal",
      status: "open",
      startAt: inDays(7),
      endAt: addHours(inDays(7), 3),
      location: "Bielefeld HQ",
      capacity: 20,
      ownerId,
      createdAt: inDays(-14),
      updatedAt: inDays(-1),
    },
    {
      id: "evt-002",
      title: "Sommerfest 2026",
      description: "Unser jährliches Betriebsfest — alle Standorte, ein Abend.",
      eventType: "mindsquare",
      visibility: "internal",
      status: "planned",
      startAt: inDays(45),
      endAt: addHours(inDays(45), 6),
      location: "Heidewald",
      capacity: 150,
      ownerId,
      createdAt: inDays(-30),
      updatedAt: inDays(-3),
    },
    {
      id: "evt-003",
      title: "Q2 Strategie-Tag",
      description: "Strategieklausur der Geschäftsführung für die Q2-Planung.",
      eventType: "strategy",
      visibility: "internal",
      status: "running",
      startAt: inDays(-1),
      endAt: inDays(2),
      location: "Online",
      capacity: 30,
      ownerId,
      createdAt: inDays(-21),
      updatedAt: inDays(-1),
    },
    {
      id: "evt-004",
      title: "Onboarding Welcome Day",
      description: "Willkommenstag für neue Kolleg:innen — Tour, Tools, Team.",
      eventType: "office",
      visibility: "internal",
      status: "open",
      startAt: inDays(14),
      endAt: addHours(inDays(14), 8),
      location: "Bielefeld HQ",
      capacity: 12,
      ownerId,
      createdAt: inDays(-10),
      updatedAt: inDays(-1),
    },
    {
      id: "evt-005",
      title: "Padel & Pizza Evening",
      description: "Feelgood-Abend: Padel-Plätze, Pizza und gute Laune.",
      eventType: "feelgood",
      visibility: "internal",
      status: "open",
      startAt: inDays(21),
      endAt: addHours(inDays(21), 3),
      location: "Padelhaus Bielefeld",
      capacity: 24,
      ownerId,
      createdAt: inDays(-7),
      updatedAt: inDays(-1),
    },
    {
      id: "evt-006",
      title: "SAP Bereich All-Hands",
      description: "Quartalsupdate des SAP-Bereichs: Roadmap, Wins, Lessons Learned.",
      eventType: "division",
      visibility: "internal",
      status: "planned",
      startAt: inDays(28),
      endAt: addHours(inDays(28), 2),
      location: "Online",
      capacity: 80,
      ownerId,
      createdAt: inDays(-12),
      updatedAt: inDays(-2),
    },
    {
      id: "evt-007",
      title: "Brauerei-Tour Bielefeld",
      description: "Local Experience: Führung durch eine ostwestfälische Hausbrauerei.",
      eventType: "local_experience",
      visibility: "internal",
      status: "draft",
      startAt: inDays(60),
      endAt: addHours(inDays(60), 4),
      location: "Brauerei Joh. Albrecht",
      capacity: 18,
      ownerId,
      createdAt: inDays(-2),
      updatedAt: inDays(-1),
    },
  ];
}

export const eventRoutes = new Hono();

eventRoutes.get("/", zValidator("query", listQuerySchema), async (c) => {
  if (!env.DATABASE_URL) {
    const baseEvents = listDevBaseEvents();
    const user = getHubUser(c);
    const userRoles = resolveMexpRoles(c);
    const userEmail = (user.email ?? "").toLowerCase();
    // Rollen, die Events managen (alle Status sehen): admin, manager, event_office, budget_owner, werkstudent
    const isPrivilegedRole = userRoles.some((r) =>
      ["admin", "manager", "event_office", "budget_owner", "werkstudent"].includes(r),
    );
    // Nicht-privilegierte User (Teilnehmer/Read-Only) sehen nur diese Status:
    const VISIBLE_STATUSES_FOR_PARTICIPANT = new Set(["planned", "open", "running"]);

    const events = baseEvents
      .map(applyOverride)
      .filter((e) => (e as unknown as { _deleted?: boolean })._deleted !== true)
      // Status-Filter: Teilnehmer sehen nur geplant/anmeldung-offen/läuft
      .filter((e) => {
        if (isPrivilegedRole) return true;
        const status = String((e as unknown as { status?: string }).status ?? "");
        return VISIBLE_STATUSES_FOR_PARTICIPANT.has(status);
      })
      // Teilnehmerkreis-Filter: Admins/Manager etc. sehen immer alles, andere nur ihre Events
      .filter((e) => {
        if (isPrivilegedRole) return true;
        const scope = (e as unknown as { audienceScope?: string }).audienceScope ?? "all";
        if (scope === "all") return true;
        if (scope === "roles") {
          const allowed = (e as unknown as { audienceRoles?: string[] }).audienceRoles ?? [];
          return userRoles.some((r) => allowed.includes(r));
        }
        if (scope === "emails") {
          const allowed = (
            (e as unknown as { audienceEmails?: string[] }).audienceEmails ?? []
          ).map((s) => s.toLowerCase());
          return allowed.includes(userEmail);
        }
        if (scope === "teams") {
          const allowed = (e as unknown as { audienceTeams?: string[] }).audienceTeams ?? [];
          const currentUser = mexpUserStore.get(user.id);
          const userTeam = currentUser?.team;
          return userTeam !== undefined && userTeam !== null && allowed.includes(userTeam);
        }
        if (scope === "departments") {
          const allowed =
            (e as unknown as { audienceDepartments?: string[] }).audienceDepartments ?? [];
          const currentUser = mexpUserStore.get(user.id);
          const userDept = currentUser?.department;
          return userDept !== undefined && userDept !== null && allowed.includes(userDept);
        }
        return true;
      });
    return c.json({ events });
  }

  const q = c.req.valid("query");
  const user = getHubUser(c);
  const filter: { status?: (typeof EVENT_STATUSES)[number]; ownerId?: string } = {};
  if (q.status) filter.status = q.status;
  if (q.mine === "true") filter.ownerId = user.id;
  const list = await listEvents(filter, { events });
  return c.json({ events: list });
});

eventRoutes.post(
  "/",
  requireMexpRole(...WRITE_ROLES),
  zValidator("json", createEventSchema),
  async (c) => {
    const input = c.req.valid("json");
    const actorId = getHubUser(c).id;

    if (!env.DATABASE_URL) {
      const event = createDevEvent({
        title: input.title,
        description: input.description,
        eventType: input.eventType,
        visibility: input.visibility,
        startAt: new Date(input.startAt).toISOString(),
        endAt: new Date(input.endAt).toISOString(),
        location: input.location,
        locationDetails: input.locationDetails,
        capacity: input.capacity,
        registrationDeadline: input.registrationDeadline
          ? new Date(input.registrationDeadline).toISOString()
          : null,
        ownerId: actorId,
        audienceScope: input.audienceScope,
        audienceRoles: input.audienceRoles,
        audienceEmails: input.audienceEmails,
        audienceTeams: input.audienceTeams,
        audienceDepartments: input.audienceDepartments,
      });
      return c.json({ event }, 201);
    }

    const event = await createEvent(
      {
        title: input.title,
        description: input.description,
        eventType: input.eventType,
        visibility: input.visibility,
        startAt: new Date(input.startAt),
        endAt: new Date(input.endAt),
        location: input.location,
        locationDetails: input.locationDetails,
        capacity: input.capacity,
        ownerId: actorId,
      },
      actorId,
      { events, audit },
    );
    return c.json({ event }, 201);
  },
);

const bulkStatusSchema = z.object({
  eventIds: z.array(z.string().min(1)).min(1).max(100),
  status: eventStatusSchema,
});

// Portfolio-Verwaltung: mehrere Events auf einmal auf einen neuen Status setzen
// (z.B. 18 OneNote-Import-Drafts gesammelt auf "planned"/"open" schalten).
// Ändert ausschließlich den Status — keine Seiteneffekte auf andere Felder.
eventRoutes.post(
  "/bulk/status",
  requireMexpRole(...WRITE_ROLES),
  zValidator("json", bulkStatusSchema),
  async (c) => {
    const { eventIds, status } = c.req.valid("json");
    const results: Array<{ id: string; ok: boolean; error?: string }> = [];

    if (!env.DATABASE_URL) {
      for (const id of eventIds) {
        const evt = findDevBaseEvent(id);
        if (!evt) {
          results.push({ id, ok: false, error: "NOT_FOUND" });
          continue;
        }
        const current = devEventOverrideStore.get(id) ?? {};
        devEventOverrideStore.set(id, {
          ...current,
          status,
          updatedAt: new Date().toISOString(),
        });
        results.push({ id, ok: true });
      }
      const ok = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok).length;
      return c.json({ ok: true, updated: ok, failed, results });
    }

    return c.json(
      { error: { code: "NOT_IMPLEMENTED", message: "Bulk-Status nur im Dev-Mode verfügbar" } },
      501,
    );
  },
);

eventRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  if (!env.DATABASE_URL) {
    const now = new Date();
    const inDays = (d: number) => new Date(now.getTime() + d * 86400000).toISOString();
    const addHours = (iso: string, h: number) =>
      new Date(new Date(iso).getTime() + h * 3600000).toISOString();
    const mock: Record<string, ReturnType<typeof JSON.parse>> = {
      "evt-001": {
        id: "evt-001",
        title: "Code & Pizza — Frontend Night",
        description:
          "Lockerer Code-Abend rund um React, Vite und neue UI-Pattern. Kollaboratives Pairing, Demo-Slots, Pizza und Getränke. Ideal zum Netzwerken über Bereiche hinweg.",
        eventType: "team",
        visibility: "internal",
        status: "open",
        startAt: inDays(7),
        endAt: addHours(inDays(7), 3),
        location: "Bielefeld HQ",
        capacity: 20,
        ownerId: "550e8400-e29b-41d4-a716-446655440000",
        createdAt: inDays(-14),
        updatedAt: inDays(-1),
      },
      "evt-002": {
        id: "evt-002",
        title: "Sommerfest 2026",
        description:
          "Unser jährliches Betriebsfest mit allen Standorten. BBQ, Live-Musik, Lawn-Games und Familien-Bereich. Anmeldung bis 4 Wochen vorher.",
        eventType: "mindsquare",
        visibility: "internal",
        status: "planned",
        startAt: inDays(45),
        endAt: addHours(inDays(45), 6),
        location: "Heidewald",
        capacity: 150,
        ownerId: "550e8400-e29b-41d4-a716-446655440000",
        createdAt: inDays(-30),
        updatedAt: inDays(-3),
      },
      "evt-003": {
        id: "evt-003",
        title: "Q2 Strategie-Tag",
        description:
          "Strategieklausur der Geschäftsführung für die Q2-Planung. OKR-Review, Roadmap-Alignment, Investitionsentscheidungen.",
        eventType: "strategy",
        visibility: "internal",
        status: "running",
        startAt: inDays(-1),
        endAt: inDays(2),
        location: "Online",
        capacity: 30,
        ownerId: "550e8400-e29b-41d4-a716-446655440000",
        createdAt: inDays(-21),
        updatedAt: inDays(-1),
      },
      "evt-004": {
        id: "evt-004",
        title: "Onboarding Welcome Day",
        description:
          "Willkommenstag für neue Kolleg:innen — Rundgang durchs HQ, Tools-Setup, Buddy-Match und gemeinsames Mittagessen.",
        eventType: "office",
        visibility: "internal",
        status: "open",
        startAt: inDays(14),
        endAt: addHours(inDays(14), 8),
        location: "Bielefeld HQ",
        capacity: 12,
        ownerId: "550e8400-e29b-41d4-a716-446655440000",
        createdAt: inDays(-10),
        updatedAt: inDays(-1),
      },
      "evt-005": {
        id: "evt-005",
        title: "Padel & Pizza Evening",
        description:
          "Feelgood-Abend: Padel-Plätze für Anfänger und Profis, danach Pizza und kalte Getränke. Schläger werden gestellt.",
        eventType: "feelgood",
        visibility: "internal",
        status: "open",
        startAt: inDays(21),
        endAt: addHours(inDays(21), 3),
        location: "Padelhaus Bielefeld",
        capacity: 24,
        ownerId: "550e8400-e29b-41d4-a716-446655440000",
        createdAt: inDays(-7),
        updatedAt: inDays(-1),
      },
      "evt-006": {
        id: "evt-006",
        title: "SAP Bereich All-Hands",
        description:
          "Quartalsupdate des SAP-Bereichs: Roadmap-Highlights, Wins der letzten 90 Tage, Lessons Learned und offene Fragerunde.",
        eventType: "division",
        visibility: "internal",
        status: "planned",
        startAt: inDays(28),
        endAt: addHours(inDays(28), 2),
        location: "Online",
        capacity: 80,
        ownerId: "550e8400-e29b-41d4-a716-446655440000",
        createdAt: inDays(-12),
        updatedAt: inDays(-2),
      },
      "evt-007": {
        id: "evt-007",
        title: "Brauerei-Tour Bielefeld",
        description:
          "Local Experience: Geführte Tour durch die Hausbrauerei Joh. Albrecht inkl. Verkostung. Begrenzte Plätze.",
        eventType: "local_experience",
        visibility: "internal",
        status: "draft",
        startAt: inDays(60),
        endAt: addHours(inDays(60), 4),
        location: "Brauerei Joh. Albrecht",
        capacity: 18,
        ownerId: "550e8400-e29b-41d4-a716-446655440000",
        createdAt: inDays(-2),
        updatedAt: inDays(-1),
      },
    };
    const event = mock[id] ?? devCreatedEventsStore.get(id);
    if (!event)
      return c.json({ error: { code: "NOT_FOUND", message: "Event nicht gefunden" } }, 404);
    const merged = applyOverride(event);
    if ((merged as { _deleted?: boolean })._deleted) {
      return c.json({ error: { code: "NOT_FOUND", message: "Event nicht gefunden" } }, 404);
    }
    return c.json({ event: merged });
  }
  const event = await getEvent(id, { events });
  return c.json({ event });
});

eventRoutes.patch(
  "/:id",
  requireMexpRole(...WRITE_ROLES),
  zValidator("json", updateEventSchema),
  async (c) => {
    const id = c.req.param("id");
    const input = c.req.valid("json");
    const actorId = getHubUser(c).id;

    if (!env.DATABASE_URL) {
      // Dev-Mode: in den Override-Store schreiben
      const current = devEventOverrideStore.get(id) ?? {};
      const next: Record<string, unknown> = { ...current };
      if (input.title !== undefined) next.title = input.title;
      if (input.description !== undefined) next.description = input.description;
      if (input.eventType !== undefined) next.eventType = input.eventType;
      if (input.visibility !== undefined) next.visibility = input.visibility;
      if (input.startAt !== undefined) next.startAt = new Date(input.startAt).toISOString();
      if (input.endAt !== undefined) next.endAt = new Date(input.endAt).toISOString();
      if (input.location !== undefined) next.location = input.location;
      if (input.locationDetails !== undefined) next.locationDetails = input.locationDetails;
      if (input.capacity !== undefined) next.capacity = input.capacity;
      if (input.registrationDeadline !== undefined) {
        next.registrationDeadline = input.registrationDeadline
          ? new Date(input.registrationDeadline).toISOString()
          : null;
      }
      if (input.audienceScope !== undefined) next.audienceScope = input.audienceScope;
      if (input.audienceRoles !== undefined) next.audienceRoles = input.audienceRoles;
      if (input.audienceEmails !== undefined) next.audienceEmails = input.audienceEmails;
      if (input.audienceTeams !== undefined) next.audienceTeams = input.audienceTeams;
      if (input.audienceDepartments !== undefined)
        next.audienceDepartments = input.audienceDepartments;
      next.updatedAt = new Date().toISOString();
      devEventOverrideStore.set(id, next);

      // Aktuellen Stand zurückgeben — Mock-/Created-Basis + Override mergen
      const base = findDevBaseEvent(id);
      if (!base) {
        return c.json({ error: { code: "NOT_FOUND", message: "Event nicht gefunden" } }, 404);
      }
      return c.json({ event: applyOverride(base) });
    }

    const patch: Parameters<typeof updateEvent>[1] = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) patch.description = input.description;
    if (input.eventType !== undefined) patch.eventType = input.eventType;
    if (input.visibility !== undefined) patch.visibility = input.visibility;
    if (input.startAt !== undefined) patch.startAt = new Date(input.startAt);
    if (input.endAt !== undefined) patch.endAt = new Date(input.endAt);
    if (input.location !== undefined) patch.location = input.location;
    if (input.capacity !== undefined) patch.capacity = input.capacity;
    const event = await updateEvent(id, patch, actorId, { events, audit });
    return c.json({ event });
  },
);

const duplicateEventSchema = z.object({
  // Optionale Overrides fürs Duplicate — meist nur Datum ändern
  startAt: isoDateSchema.optional(),
  endAt: isoDateSchema.optional(),
  title: z.string().min(1).max(200).optional(),
});

// Event duplizieren — für wiederkehrende Coworking-Wochen, Bereichsevents etc.
// Kopiert NICHT: Teilnehmer, Anmeldungen, Budget, Feedback, Deleted-Flag, ID, CreatedAt.
// Neues Event startet immer als "draft" (macht createDevEvent automatisch).
eventRoutes.post(
  "/:id/duplicate",
  requireMexpRole(...WRITE_ROLES),
  zValidator("json", duplicateEventSchema),
  async (c) => {
    const sourceId = c.req.param("id");
    const overrides = c.req.valid("json");
    const actorId = getHubUser(c).id;

    if (!env.DATABASE_URL) {
      const source = findDevBaseEvent(sourceId);
      if (!source) {
        return c.json(
          { error: { code: "NOT_FOUND", message: "Quell-Event nicht gefunden" } },
          404,
        );
      }
      // Quell-Event + Overrides mergen (kein Deleted-Flag/ID/CreatedAt übernehmen)
      const merged = applyOverride(source) as Record<string, unknown>;
      const startAt = overrides.startAt
        ? new Date(overrides.startAt).toISOString()
        : (merged.startAt as string);
      const endAt = overrides.endAt
        ? new Date(overrides.endAt).toISOString()
        : (merged.endAt as string);
      const title = overrides.title ?? `${merged.title as string} (Kopie)`;
      const event = createDevEvent({
        title,
        description: (merged.description as string) ?? "",
        eventType: (merged.eventType as string) ?? "team",
        visibility: (merged.visibility as string) ?? "internal",
        startAt,
        endAt,
        location: (merged.location as string | null) ?? null,
        locationDetails: (merged.locationDetails as string | null | undefined) ?? null,
        capacity: (merged.capacity as number | null) ?? null,
        registrationDeadline: (merged.registrationDeadline as string | null | undefined) ?? null,
        ownerId: actorId,
      });
      return c.json({ event }, 201);
    }

    // Postgres-Pfad: aus getEvent() + createEvent() zusammenbauen — im MVP nicht kritisch
    return c.json(
      { error: { code: "NOT_IMPLEMENTED", message: "Duplizieren nur im Dev-Mode verfügbar" } },
      501,
    );
  },
);

// ICS-Datei für Kalender-Apps (Outlook / Apple Calendar / Google Calendar)
eventRoutes.get("/:id/calendar.ics", async (c) => {
  const id = c.req.param("id");
  let evt: Record<string, unknown> | null = null;

  if (!env.DATABASE_URL) {
    const base = findDevBaseEvent(id);
    if (!base) return c.text("Event nicht gefunden", 404);
    const merged = applyOverride(base) as Record<string, unknown>;
    if ((merged as { _deleted?: boolean })._deleted) {
      return c.text("Event nicht gefunden", 404);
    }
    evt = merged;
  } else {
    const event = await getEvent(id, { events });
    evt = event as unknown as Record<string, unknown>;
  }

  if (!evt) return c.text("Event nicht gefunden", 404);

  const ics = buildIcs({
    id: String(evt.id),
    title: String(evt.title ?? "mEXP Event"),
    description: String(evt.description ?? ""),
    location:
      String(evt.location ?? "") +
      (evt.locationDetails ? `\n\n${String(evt.locationDetails)}` : ""),
    startAt: String(evt.startAt ?? new Date().toISOString()),
    endAt: String(evt.endAt ?? new Date().toISOString()),
  });

  c.header("Content-Type", "text/calendar; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="mexp-${id}.ics"`);
  return c.body(ics);
});

function icsEscape(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function icsDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "00000000T000000Z";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

function buildIcs(input: {
  id: string;
  title: string;
  description: string;
  location: string;
  startAt: string;
  endAt: string;
}): string {
  const now = icsDate(new Date().toISOString());
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//mindsquare AG//mEXP//DE",
    "METHOD:PUBLISH",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${input.id}@mexp.mindsquare.de`,
    `DTSTAMP:${now}`,
    `DTSTART:${icsDate(input.startAt)}`,
    `DTEND:${icsDate(input.endAt)}`,
    `SUMMARY:${icsEscape(input.title)}`,
    `DESCRIPTION:${icsEscape(input.description)}`,
    `LOCATION:${icsEscape(input.location)}`,
    "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

// Event "löschen" — nur Admin. Dev-Mode: in Override-Store als hidden markieren.
eventRoutes.delete("/:id", requireMexpRole("admin"), async (c) => {
  const id = c.req.param("id");
  if (!env.DATABASE_URL) {
    const current = devEventOverrideStore.get(id) ?? {};
    devEventOverrideStore.set(id, {
      ...current,
      _deleted: true,
      updatedAt: new Date().toISOString(),
    });
    return c.json({ ok: true });
  }
  return c.json({ error: { code: "NOT_IMPLEMENTED", message: "Delete nur im Dev-Mode" } }, 501);
});

eventRoutes.patch(
  "/:id/status",
  requireMexpRole(...WRITE_ROLES),
  zValidator("json", transitionSchema),
  async (c) => {
    const id = c.req.param("id");
    const { status } = c.req.valid("json");
    const actorId = getHubUser(c).id;

    if (!env.DATABASE_URL) {
      // Dev-Mode: Status im Override-Store ablegen
      const current = devEventOverrideStore.get(id) ?? {};
      devEventOverrideStore.set(id, {
        ...current,
        status,
        updatedAt: new Date().toISOString(),
      });
      const base = findDevBaseEvent(id);
      if (!base) {
        return c.json({ error: { code: "NOT_FOUND", message: "Event nicht gefunden" } }, 404);
      }
      return c.json({ event: applyOverride(base) });
    }

    const event = await transitionEventStatus(id, status, actorId, { events, audit });
    return c.json({ event });
  },
);

eventRoutes.get("/:id/my-participation", async (c) => {
  const id = c.req.param("id");
  const actorIdSession = getHubUser(c).id;
  if (!env.DATABASE_URL) {
    const live = devLiveParticipantsStore.get(id) ?? [];
    const found = live.find((p) => p.userId === actorIdSession);
    return c.json({ participation: found ?? null });
  }
  const actorId = actorIdSession;
  const participation = await getOwnParticipation(id, actorId, { events, participations });
  return c.json({ participation });
});

// Notiz zur eigenen Anmeldung bearbeiten
eventRoutes.patch("/:id/my-participation", async (c) => {
  const id = c.req.param("id");
  const actorId = getHubUser(c).id;
  if (env.DATABASE_URL) {
    return c.json({ error: { code: "NOT_IMPLEMENTED", message: "Dev-only" } }, 501);
  }
  let personalNote: string | null = null;
  try {
    const body = (await c.req.json()) as { personalNote?: string | null };
    if (typeof body.personalNote === "string") {
      personalNote = body.personalNote.trim() === "" ? null : body.personalNote.trim();
    } else if (body.personalNote === null) {
      personalNote = null;
    }
  } catch {
    return c.json({ error: { code: "INVALID_BODY", message: "Erwarte JSON" } }, 400);
  }

  const live = devLiveParticipantsStore.get(id) ?? [];
  const idx = live.findIndex((p) => p.userId === actorId);
  if (idx === -1) {
    return c.json(
      { error: { code: "NOT_REGISTERED", message: "Du bist nicht für dieses Event angemeldet." } },
      404,
    );
  }
  const existing = live[idx];
  if (!existing) {
    return c.json(
      { error: { code: "NOT_REGISTERED", message: "Du bist nicht für dieses Event angemeldet." } },
      404,
    );
  }
  const updated = { ...existing, personalNote };
  const nextList = [...live];
  nextList[idx] = updated;
  devLiveParticipantsStore.set(id, nextList);
  return c.json({ participation: updated });
});

// Dev-Mode (file-store — Design-Spec §3.4): Override-Store für Teilnahmen
// (participationId → Patch: status, waitlistPosition, checkedInAt, ...). Analog zu
// devEventOverrideStore — macht Check-in/No-Show/Warteliste-Beförderung persistent,
// auch für die statischen Mock-Teilnehmer:innen (p-001..p-003).
// Persistiert in apps/api/data/participation-overrides.json.
const devParticipationOverrideStore =
  persistentMap<Record<string, unknown>>("participation-overrides");

interface DevParticipantRecord {
  id: string;
  eventId: string;
  userId: string;
  userDisplayName: string;
  userEmail: string;
  status: string;
  waitlistPosition: number | null;
  registeredAt: string;
  checkedInAt: string | null;
  cancelledAt: string | null;
  personalNote?: string | null;
}

function applyParticipationOverride(p: DevParticipantRecord): DevParticipantRecord {
  const ov = devParticipationOverrideStore.get(p.id);
  if (!ov) return p;
  return { ...p, ...ov };
}

function buildStaticParticipants(_eventId: string): DevParticipantRecord[] {
  // Nicht mehr verwendet: Sina hat die statischen Testkandidaten (Anna Becker,
  // Tim Hartmann, Lara Weber) für den Pilot entfernt — echte Teilnehmer werden
  // per POST /api/events/:id/register aus dem Personio-synced User-Store
  // angemeldet. Funktion bleibt leerer Platzhalter falls jemand außerhalb noch
  // darauf verweist.
  return [];
}

// Statische Mock-Teilnehmer:innen + Live-Anmeldungen für ein Event, mit Overrides
// (Check-in/No-Show/Warteliste-Beförderung) gemergt.
function getDevParticipants(eventId: string): DevParticipantRecord[] {
  const live = devLiveParticipantsStore.get(eventId) ?? [];
  const merged: DevParticipantRecord[] = [...buildStaticParticipants(eventId), ...live];
  return merged.map(applyParticipationOverride);
}

eventRoutes.get("/:id/participants", requireMexpRole(...WRITE_ROLES), async (c) => {
  const id = c.req.param("id");
  if (!env.DATABASE_URL) {
    const merged = getDevParticipants(id);
    // Antworten aus devAnswerStore nachladen
    const withAnswers = merged.map((p) => ({
      ...p,
      answers: devAnswerStore.get(p.id) ?? [],
    }));
    return c.json({ participants: withAnswers });
  }
  const list = await listParticipants(id, { events, participations });
  return c.json({ participants: list });
});

const addParticipantSchema = z.object({ userId: z.string().min(1) });

// Admin/Manager fügen eine bestimmte Person manuell zu einem Event hinzu (z.B. wenn die
// Anmeldung telefonisch/persönlich reinkam). Getrennt vom Self-Service-Endpoint
// POST /:id/register (der meldet immer den aufrufenden Hub-User selbst an).
eventRoutes.post(
  "/:id/participants",
  requireMexpRole(...WRITE_ROLES),
  zValidator("json", addParticipantSchema),
  async (c) => {
    const eventId = c.req.param("id");
    const { userId: targetUserId } = c.req.valid("json");

    if (!env.DATABASE_URL) {
      const target = mexpUserStore.get(targetUserId);
      if (!target) {
        return c.json(
          { error: { code: "USER_NOT_FOUND", message: `User ${targetUserId} nicht gefunden` } },
          404,
        );
      }

      const existing = devLiveParticipantsStore.get(eventId) ?? [];
      const already = existing.find((p) => p.userId === targetUserId);
      if (already) {
        return c.json({
          ok: true,
          skipped: true,
          message: `${target.displayName ?? targetUserId} ist bereits Teilnehmer`,
        });
      }

      const participationId = `p-${targetUserId.slice(0, 12)}`;
      const registeredAt = new Date().toISOString();
      const participation = {
        id: participationId,
        eventId,
        userId: targetUserId,
        userDisplayName: target.displayName ?? targetUserId,
        userEmail: target.email ?? "—",
        status: "registered" as const,
        waitlistPosition: null,
        registeredAt,
        checkedInAt: null,
        cancelledAt: null,
        personalNote: null,
      };
      devLiveParticipantsStore.set(eventId, [...existing, participation]);

      return c.json({ ok: true, participation }, 201);
    }

    return c.json(
      { error: { code: "NOT_IMPLEMENTED", message: "Nur im Dev-Mode verfügbar" } },
      501,
    );
  },
);

eventRoutes.get("/:id/participants.csv", requireMexpRole(...WRITE_ROLES), async (c) => {
  const id = c.req.param("id");
  const list = await listParticipants(id, { events, participations });
  const header = [
    "userId",
    "displayName",
    "email",
    "status",
    "waitlistPosition",
    "registeredAt",
    "checkedInAt",
    "cancelledAt",
  ].join(",");
  const lines = list.map((p) =>
    [
      p.userId,
      csvEscape(p.userDisplayName),
      csvEscape(p.userEmail),
      p.status,
      p.waitlistPosition ?? "",
      p.registeredAt.toISOString(),
      p.checkedInAt ? p.checkedInAt.toISOString() : "",
      p.cancelledAt ? p.cancelledAt.toISOString() : "",
    ].join(","),
  );
  const csv = `${header}\n${lines.join("\n")}\n`;
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="event-${id}-participants.csv"`,
    },
  });
});

eventRoutes.get("/:id/emergency-list", requireMexpRole(...WRITE_ROLES), async (c) => {
  const id = c.req.param("id");
  const event = await getEvent(id, { events });
  const list = await listParticipants(id, { events, participations });
  const active = list.filter((p) => p.status === "registered" || p.status === "attended");
  return c.json({
    event: {
      id: event.id,
      title: event.title,
      startAt: event.startAt,
      endAt: event.endAt,
      location: event.location,
    },
    generatedAt: new Date().toISOString(),
    count: active.length,
    participants: active.map((p) => ({
      displayName: p.userDisplayName,
      email: p.userEmail,
      status: p.status,
      checkedInAt: p.checkedInAt,
    })),
  });
});

function csvEscape(value: string): string {
  // Zellen, die mit = + - @ Tab oder CR beginnen, fuehrt Excel/LibreOffice beim
  // Oeffnen als Formel aus statt sie als Text anzuzeigen (CSV Injection, SEC-19).
  // Namen und Freitexte stammen aus Personio, SharePoint und CSV-Import — also
  // aus Quellen ausserhalb der Anwendung. Ein Apostroph erzwingt Text.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

eventRoutes.post("/:id/register", async (c) => {
  const id = c.req.param("id");
  const actorId = getHubUser(c).id;
  if (!env.DATABASE_URL) {
    // Anmeldefrist prüfen
    const override = devEventOverrideStore.get(id) ?? {};
    const deadline = (override as { registrationDeadline?: string | null }).registrationDeadline;
    if (deadline) {
      const deadlineMs = new Date(deadline).getTime();
      if (Number.isFinite(deadlineMs) && deadlineMs < Date.now()) {
        return c.json(
          {
            error: {
              code: "REGISTRATION_CLOSED",
              message: "Die Anmeldefrist für dieses Event ist abgelaufen.",
            },
          },
          409,
        );
      }
    }

    // Optional: Antworten + persönliche Notiz lesen
    let answers: { questionId: string; value: boolean | string | string[] | null }[] = [];
    let personalNote: string | null = null;
    try {
      const text = await c.req.text();
      if (text.trim()) {
        const body = JSON.parse(text) as {
          answers?: typeof answers;
          personalNote?: string | null;
        };
        if (Array.isArray(body.answers)) answers = body.answers;
        if (typeof body.personalNote === "string") {
          personalNote = body.personalNote.trim() === "" ? null : body.personalNote.trim();
        }
      }
    } catch {
      // body optional — leerer Body ist OK
    }

    const questions = devFormStore.get(id) ?? [];
    if (questions.length > 0) {
      const validation = validateAnswers(questions, answers);
      if (!validation.ok) {
        return c.json({ error: { code: "INVALID_ANSWERS", message: validation.message } }, 400);
      }
    }

    const participationId = `p-${actorId.slice(0, 8)}`;
    devAnswerStore.set(participationId, answers);

    // Display-Name aus Personio-synced User-Store auflösen (falls verfügbar),
    // sonst aus dem Hub-User-Header, sonst Fallback auf hardcoded Dev-Users.
    const hubUser = getHubUser(c);
    const mexpUser = mexpUserStore.get(actorId);
    const DEV_NAMES: Record<string, { name: string; email: string }> = {
      "550e8400-e29b-41d4-a716-446655440000": {
        name: "Sina Strathemann",
        email: "sina.strathemann@mindsquare.de",
      },
      "550e8400-e29b-41d4-a716-446655440001": {
        name: "Max Mustermann",
        email: "max.mustermann@mindsquare.de",
      },
    };
    const profile = mexpUser
      ? { name: mexpUser.displayName ?? actorId, email: mexpUser.email ?? "—" }
      : hubUser.name
        ? { name: hubUser.name, email: hubUser.email ?? "—" }
        : (DEV_NAMES[actorId] ?? { name: "Unbekannt", email: "—" });
    const registeredAt = new Date().toISOString();

    // Live-Eintrag in den Participant-Store (Duplikate vermeiden)
    const existing = devLiveParticipantsStore.get(id) ?? [];
    const filtered = existing.filter((p) => p.userId !== actorId);
    filtered.push({
      id: participationId,
      eventId: id,
      userId: actorId,
      userDisplayName: profile.name,
      userEmail: profile.email,
      status: "registered",
      waitlistPosition: null,
      registeredAt,
      checkedInAt: null,
      cancelledAt: null,
      personalNote,
    });
    devLiveParticipantsStore.set(id, filtered);

    return c.json(
      {
        participation: {
          id: participationId,
          eventId: id,
          userId: actorId,
          status: "registered",
          waitlistPosition: null,
          registeredAt,
          checkedInAt: null,
          cancelledAt: null,
        },
        answers,
      },
      201,
    );
  }
  const participation = await registerForEvent({ eventId: id, userId: actorId }, actorId, {
    events,
    participations,
    audit,
  });
  return c.json({ participation }, 201);
});

eventRoutes.post("/:id/withdraw", async (c) => {
  const id = c.req.param("id");
  const actorId = getHubUser(c).id;
  if (!env.DATABASE_URL) {
    const participationId = `p-${actorId.slice(0, 8)}`;
    // Aus Live-Store + Answer-Store entfernen
    const existing = devLiveParticipantsStore.get(id) ?? [];
    devLiveParticipantsStore.set(
      id,
      existing.filter((p) => p.userId !== actorId),
    );
    devAnswerStore.delete(participationId);
    return c.json({
      participation: {
        id: participationId,
        eventId: id,
        userId: actorId,
        status: "cancelled",
        waitlistPosition: null,
        registeredAt: new Date(Date.now() - 86400000).toISOString(),
        checkedInAt: null,
        cancelledAt: new Date().toISOString(),
      },
    });
  }
  const participation = await withdrawFromEvent({ eventId: id, userId: actorId }, actorId, {
    events,
    participations,
    audit,
  });
  return c.json({ participation });
});

eventRoutes.post(
  "/:id/participants/promote-waitlist",
  requireMexpRole(...WRITE_ROLES),
  async (c) => {
    const id = c.req.param("id");
    const actorId = getHubUser(c).id;

    if (!env.DATABASE_URL) {
      const list = getDevParticipants(id);
      const waitlisted = list
        .filter((p) => p.status === "waitlisted")
        .sort((a, b) => (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0));
      const next = waitlisted[0];
      if (!next) {
        return c.json(
          { error: { code: "NO_WAITLIST_ENTRY", message: "Keine Personen auf der Warteliste" } },
          404,
        );
      }
      const previousPosition = next.waitlistPosition;
      devParticipationOverrideStore.set(next.id, {
        ...devParticipationOverrideStore.get(next.id),
        status: "registered",
        waitlistPosition: null,
      });
      // Nachrückende Wartelisten-Positionen verschieben
      if (previousPosition !== null) {
        for (const p of list) {
          if (
            p.id !== next.id &&
            p.status === "waitlisted" &&
            (p.waitlistPosition ?? 0) > previousPosition
          ) {
            devParticipationOverrideStore.set(p.id, {
              ...devParticipationOverrideStore.get(p.id),
              waitlistPosition: (p.waitlistPosition ?? 1) - 1,
            });
          }
        }
      }
      const participation = { ...next, status: "registered", waitlistPosition: null };
      return c.json({ participation });
    }

    const participation = await promoteFromWaitlist(id, actorId, {
      events,
      participations,
      audit,
    });
    return c.json({ participation });
  },
);

eventRoutes.post(
  "/:eventId/participants/:participationId/check-in",
  requireMexpRole(...WRITE_ROLES),
  async (c) => {
    const eventId = c.req.param("eventId");
    const participationId = c.req.param("participationId");
    const actorId = getHubUser(c).id;

    if (!env.DATABASE_URL) {
      const participation = getDevParticipants(eventId).find((p) => p.id === participationId);
      if (!participation) {
        return c.json(
          { error: { code: "PARTICIPATION_NOT_FOUND", message: "Keine Anmeldung gefunden" } },
          404,
        );
      }
      if (participation.status !== "registered") {
        return c.json(
          {
            error: {
              code: "PARTICIPATION_STATUS_INVALID",
              message: `Aktion benötigt Teilnehmer-Status 'registered', aktueller Status ist '${participation.status}'`,
            },
          },
          409,
        );
      }
      const patch = { status: "attended", checkedInAt: new Date().toISOString() };
      devParticipationOverrideStore.set(participationId, {
        ...devParticipationOverrideStore.get(participationId),
        ...patch,
      });
      return c.json({ participation: { ...participation, ...patch } });
    }

    const participation = await checkInParticipant(participationId, actorId, {
      events,
      participations,
      audit,
    });
    return c.json({ participation });
  },
);

eventRoutes.post(
  "/:eventId/participants/:participationId/no-show",
  requireMexpRole(...WRITE_ROLES),
  async (c) => {
    const eventId = c.req.param("eventId");
    const participationId = c.req.param("participationId");
    const actorId = getHubUser(c).id;

    if (!env.DATABASE_URL) {
      const participation = getDevParticipants(eventId).find((p) => p.id === participationId);
      if (!participation) {
        return c.json(
          { error: { code: "PARTICIPATION_NOT_FOUND", message: "Keine Anmeldung gefunden" } },
          404,
        );
      }
      if (participation.status !== "registered") {
        return c.json(
          {
            error: {
              code: "PARTICIPATION_STATUS_INVALID",
              message: `Aktion benötigt Teilnehmer-Status 'registered', aktueller Status ist '${participation.status}'`,
            },
          },
          409,
        );
      }
      const patch = { status: "no_show" };
      devParticipationOverrideStore.set(participationId, {
        ...devParticipationOverrideStore.get(participationId),
        ...patch,
      });
      return c.json({ participation: { ...participation, ...patch } });
    }

    const participation = await markNoShow(participationId, actorId, {
      events,
      participations,
      audit,
    });
    return c.json({ participation });
  },
);
