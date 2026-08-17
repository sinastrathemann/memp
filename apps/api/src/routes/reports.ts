import { Hono } from "hono";
import { env } from "../deps.js";
import { persistentMap } from "../dev-persistence.js";
import { mexpUserStore, requireMexpRole } from "./_user-resolution.js";

const MANAGE_ROLES = ["admin", "manager", "event_office"] as const;

// ─── Eigene Store-Handles (nur lesend) ─────────────────────────────
// Reports mutiert nichts — analog zu dashboard.ts::computeDevStats() greifen wir
// über eigene persistentMap()-Instanzen auf dieselben persistierten Dateien zu wie
// events.ts (created-events, event-overrides, participation-overrides) und
// registration-form.ts (live-participants). mexpUserStore ist bereits exportiert
// und wird direkt wiederverwendet (eine einzige geteilte Instanz).
const devCreatedEventsStore = persistentMap<Record<string, unknown>>("created-events");
const devEventOverrideStore = persistentMap<Record<string, unknown>>("event-overrides");
const devLiveParticipantsStore = persistentMap<ReportParticipant[]>("live-participants");
const devParticipationOverrideStore =
  persistentMap<Record<string, unknown>>("participation-overrides");

// ─── Typen ──────────────────────────────────────────────────────────
interface ReportEvent {
  id: string;
  title: string;
  eventType: string;
  status: string;
  startAt: string;
  endAt: string;
  location: string | null;
  capacity: number | null;
}

interface ReportParticipant {
  id: string;
  eventId: string;
  userId: string;
  userDisplayName: string;
  userEmail: string;
  status: string;
  waitlistPosition: number | null;
  registeredAt: string;
}

// ─── Seed-Events (Basisliste, synchron mit events.ts::buildMockEventList) ──
// Eigenständige Kopie, damit Reports unabhängig von events.ts bleibt (siehe
// dasselbe Pattern im ursprünglichen reports.ts). OneNote-Importe + neue Events
// kommen zusätzlich aus devCreatedEventsStore.
function buildSeedEventList(): ReportEvent[] {
  const now = new Date();
  const inDays = (d: number) => new Date(now.getTime() + d * 86400000).toISOString();
  const addHours = (iso: string, h: number) =>
    new Date(new Date(iso).getTime() + h * 3600000).toISOString();
  return [
    {
      id: "evt-001",
      title: "Code & Pizza — Frontend Night",
      eventType: "team",
      status: "open",
      startAt: inDays(7),
      endAt: addHours(inDays(7), 3),
      location: "Bielefeld HQ",
      capacity: 20,
    },
    {
      id: "evt-002",
      title: "Sommerfest 2026",
      eventType: "mindsquare",
      status: "planned",
      startAt: inDays(45),
      endAt: addHours(inDays(45), 6),
      location: "Heidewald",
      capacity: 150,
    },
    {
      id: "evt-003",
      title: "Q2 Strategie-Tag",
      eventType: "strategy",
      status: "running",
      startAt: inDays(-1),
      endAt: inDays(2),
      location: "Online",
      capacity: 30,
    },
    {
      id: "evt-004",
      title: "Onboarding Welcome Day",
      eventType: "office",
      status: "open",
      startAt: inDays(14),
      endAt: addHours(inDays(14), 8),
      location: "Bielefeld HQ",
      capacity: 12,
    },
    {
      id: "evt-005",
      title: "Padel & Pizza Evening",
      eventType: "feelgood",
      status: "open",
      startAt: inDays(21),
      endAt: addHours(inDays(21), 3),
      location: "Padelhaus Bielefeld",
      capacity: 24,
    },
    {
      id: "evt-006",
      title: "SAP Bereich All-Hands",
      eventType: "division",
      status: "planned",
      startAt: inDays(28),
      endAt: addHours(inDays(28), 2),
      location: "Online",
      capacity: 80,
    },
    {
      id: "evt-007",
      title: "Brauerei-Tour Bielefeld",
      eventType: "local_experience",
      status: "draft",
      startAt: inDays(60),
      endAt: addHours(inDays(60), 4),
      location: "Brauerei Joh. Albrecht",
      capacity: 18,
    },
  ];
}

function applyEventOverride(e: ReportEvent): ReportEvent & { _deleted?: boolean } {
  const ov = devEventOverrideStore.get(e.id) as
    | (Partial<ReportEvent> & { _deleted?: boolean })
    | undefined;
  if (!ov) return e;
  return { ...e, ...ov };
}

// Alle Events (Seeds + per POST angelegte, inkl. OneNote-Importe), Overrides gemergt,
// gelöschte rausgefiltert. Gleiches Verhalten wie events.ts::listDevBaseEvents() +
// applyOverride(), nur read-only und ohne dessen Rollen-/Sichtbarkeits-Filterung —
// Reports sehen den vollen Bestand (nur admin/manager/event_office dürfen ohnehin rein).
function listReportEvents(): ReportEvent[] {
  const seeds = buildSeedEventList();
  const created = Array.from(devCreatedEventsStore.values()) as unknown as ReportEvent[];
  return [...seeds, ...created].map(applyEventOverride).filter((e) => !e._deleted);
}

function applyParticipationOverride(p: ReportParticipant): ReportParticipant {
  const ov = devParticipationOverrideStore.get(p.id) as Partial<ReportParticipant> | undefined;
  if (!ov) return p;
  return { ...p, ...ov };
}

// Alle Teilnahmen quer über alle Events, Status-Overrides (Check-in/No-Show/
// Warteliste-Beförderung aus events.ts) gemergt. Withdraw entfernt Einträge direkt
// aus dem Live-Store, daher tauchen "cancelled"-Teilnahmen hier nicht auf.
function listAllParticipants(): ReportParticipant[] {
  const all: ReportParticipant[] = [];
  for (const list of devLiveParticipantsStore.values()) {
    for (const p of list) {
      all.push(applyParticipationOverride(p));
    }
  }
  return all;
}

function participantCountsByEvent(
  participants: ReportParticipant[],
): Map<string, { registered: number; waitlisted: number; attended: number }> {
  const map = new Map<string, { registered: number; waitlisted: number; attended: number }>();
  for (const p of participants) {
    const acc = map.get(p.eventId) ?? { registered: 0, waitlisted: 0, attended: 0 };
    if (p.status === "registered") acc.registered++;
    else if (p.status === "waitlisted") acc.waitlisted++;
    else if (p.status === "attended") acc.attended++;
    map.set(p.eventId, acc);
  }
  return map;
}

// ─── Aggregation ────────────────────────────────────────────────────
function computeReportSummary() {
  const events = listReportEvents();
  const participants = listAllParticipants();

  const eventsByType: Record<string, number> = {};
  const eventsByStatus: Record<string, number> = {};
  for (const e of events) {
    eventsByType[e.eventType] = (eventsByType[e.eventType] ?? 0) + 1;
    eventsByStatus[e.status] = (eventsByStatus[e.status] ?? 0) + 1;
  }

  let totalCheckedIn = 0;
  let totalWaitlisted = 0;
  // Aggregation je Teilnahme (nicht je Event) — beantwortet "aus welchem Bereich/Team
  // kommen die Teilnahmen", gejoint über mexpUserStore.department/.team.
  const eventsByDepartment: Record<string, number> = {};
  const eventsByTeam: Record<string, number> = {};

  for (const p of participants) {
    if (p.status === "attended") totalCheckedIn++;
    if (p.status === "waitlisted") totalWaitlisted++;

    const user = mexpUserStore.get(p.userId);
    const dept = user?.department?.trim() || "Unbekannt";
    const team = user?.team?.trim() || "Unbekannt";
    eventsByDepartment[dept] = (eventsByDepartment[dept] ?? 0) + 1;
    eventsByTeam[team] = (eventsByTeam[team] ?? 0) + 1;
  }

  const totalEvents = events.length;
  const totalParticipations = participants.length;
  const avgParticipantsPerEvent = totalEvents > 0 ? totalParticipations / totalEvents : 0;

  const topEventTypes = Object.entries(eventsByType)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    totalEvents,
    eventsByType,
    eventsByStatus,
    totalParticipations,
    totalCheckedIn,
    totalWaitlisted,
    avgParticipantsPerEvent,
    topEventTypes,
    eventsByDepartment,
    eventsByTeam,
  };
}

// ─── CSV-Helfer ─────────────────────────────────────────────────────
// Semikolon-Delimiter + UTF-8-BOM: Excel-DE öffnet das ohne Encoding-Dialog korrekt.
function csvCell(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? "" : String(value);
  // Zellen, die mit = + - @ Tab oder CR beginnen, fuehrt Excel/LibreOffice beim
  // Oeffnen als Formel aus statt sie als Text anzuzeigen (CSV Injection, SEC-19).
  // Diese Exporte werden typischerweise von privilegierten Personen geoeffnet —
  // der Angriff wuerde also die Vertrauensgrenze Teilnehmer -> Admin ueberschreiten.
  const s = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  if (/[";\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsvBody(header: string[], rows: string[][]): string {
  const lines = [header.join(";"), ...rows.map((r) => r.map(csvCell).join(";"))];
  return `﻿${lines.join("\n")}\n`; // BOM für Excel-DE
}

export const reportRoutes = new Hono();

// Overview-Kacheln (Events, Teilnahmen, Typ-/Bereichs-/Team-Verteilung)
reportRoutes.get("/summary", requireMexpRole(...MANAGE_ROLES), (c) => {
  if (env.DATABASE_URL) {
    return c.json({ error: { code: "NOT_IMPLEMENTED", message: "Reports nur im Dev-Mode" } }, 501);
  }
  return c.json(computeReportSummary());
});

// CSV-Export: alle Events
reportRoutes.get("/events.csv", requireMexpRole(...MANAGE_ROLES), (c) => {
  if (env.DATABASE_URL) {
    return c.text("Not implemented", 501);
  }
  const events = listReportEvents();
  const counts = participantCountsByEvent(listAllParticipants());
  const rows = events.map((e) => {
    const cnt = counts.get(e.id) ?? { registered: 0, waitlisted: 0, attended: 0 };
    return [
      e.id,
      e.title,
      e.eventType,
      e.status,
      e.startAt,
      e.endAt,
      e.location ?? "",
      e.capacity !== null ? String(e.capacity) : "",
      String(cnt.registered),
      String(cnt.waitlisted),
      String(cnt.attended),
    ];
  });
  const csv = toCsvBody(
    [
      "id",
      "title",
      "eventType",
      "status",
      "startAt",
      "endAt",
      "location",
      "capacity",
      "registeredCount",
      "waitlistedCount",
      "attendedCount",
    ],
    rows,
  );
  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", 'attachment; filename="mexp-events.csv"');
  return c.body(csv);
});

// CSV-Export: alle Teilnahmen quer über Events
reportRoutes.get("/participants.csv", requireMexpRole(...MANAGE_ROLES), (c) => {
  if (env.DATABASE_URL) {
    return c.text("Not implemented", 501);
  }
  const events = listReportEvents();
  const titleById = new Map(events.map((e) => [e.id, e.title]));
  const rows = listAllParticipants().map((p) => {
    const user = mexpUserStore.get(p.userId);
    return [
      p.eventId,
      titleById.get(p.eventId) ?? p.eventId,
      p.userDisplayName,
      p.userEmail,
      user?.department ?? "",
      user?.team ?? "",
      p.status,
      p.registeredAt,
    ];
  });
  const csv = toCsvBody(
    [
      "eventId",
      "eventTitle",
      "userDisplayName",
      "userEmail",
      "userDepartment",
      "userTeam",
      "status",
      "registeredAt",
    ],
    rows,
  );
  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", 'attachment; filename="mexp-participants.csv"');
  return c.body(csv);
});
