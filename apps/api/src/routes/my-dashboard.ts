import { getHubUser } from "@mexp/auth";
import { Hono } from "hono";
import { env } from "../deps.js";
import { devBudgetStore } from "./budget.js";
import { devLiveParticipantsStore } from "./registration-form.js";

export const myDashboardRoutes = new Hono();

/**
 * Liefert für den eingeloggten User:
 *  - upcoming: Events bei denen er angemeldet ist und die noch nicht zu Ende sind
 *  - past: Events bei denen er angemeldet ist und die schon vorbei sind
 *  - totalCostCents: Summe seiner Anteile (Σ Netto / Σ Teilnehmer) über past-Events
 *  - registeredCount, attendedCount
 */
myDashboardRoutes.get("/dashboard", (c) => {
  const userId = getHubUser(c).id;

  if (env.DATABASE_URL) {
    return c.json({
      upcoming: [],
      past: [],
      totalCostCents: 0,
      registeredCount: 0,
      attendedCount: 0,
    });
  }

  // Mock-Events synchron mit events.ts: ID, title, eventType, startAt, endAt, location, capacity, status
  const now = new Date();
  const inDays = (d: number) => new Date(now.getTime() + d * 86400000).toISOString();
  const baseEvents = [
    {
      id: "evt-001",
      title: "Code & Pizza — Frontend Night",
      eventType: "team",
      status: "open",
      startAt: inDays(7),
      endAt: inDays(7),
      location: "Bielefeld HQ",
    },
    {
      id: "evt-002",
      title: "Sommerfest 2026",
      eventType: "mindsquare",
      status: "planned",
      startAt: inDays(45),
      endAt: inDays(45),
      location: "Heidewald",
    },
    {
      id: "evt-003",
      title: "Q2 Strategie-Tag",
      eventType: "strategy",
      status: "running",
      startAt: inDays(-1),
      endAt: inDays(2),
      location: "Online",
    },
    {
      id: "evt-004",
      title: "Onboarding Welcome Day",
      eventType: "office",
      status: "open",
      startAt: inDays(14),
      endAt: inDays(14),
      location: "Bielefeld HQ",
    },
    {
      id: "evt-005",
      title: "Padel & Pizza Evening",
      eventType: "feelgood",
      status: "open",
      startAt: inDays(21),
      endAt: inDays(21),
      location: "Padelhaus Bielefeld",
    },
    {
      id: "evt-006",
      title: "SAP Bereich All-Hands",
      eventType: "division",
      status: "planned",
      startAt: inDays(28),
      endAt: inDays(28),
      location: "Online",
    },
    {
      id: "evt-007",
      title: "Brauerei-Tour Bielefeld",
      eventType: "local_experience",
      status: "draft",
      startAt: inDays(60),
      endAt: inDays(60),
      location: "Brauerei Joh. Albrecht",
    },
  ];

  // Welche Events ist der User angemeldet?
  const myEventIds = new Set<string>();
  for (const [eventId, participants] of devLiveParticipantsStore.entries()) {
    if (participants.some((p) => p.userId === userId)) {
      myEventIds.add(eventId);
    }
  }

  const upcoming: typeof baseEvents = [];
  const past: typeof baseEvents = [];
  const nowMs = Date.now();
  for (const e of baseEvents) {
    if (!myEventIds.has(e.id)) continue;
    const endMs = new Date(e.endAt).getTime();
    if (endMs < nowMs) past.push(e);
    else upcoming.push(e);
  }
  upcoming.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
  past.sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime());

  // Kosten für mich: für jedes Event meiner past+upcoming-Liste den Netto-Anteil berechnen
  let totalCostCents = 0;
  const costByEvent: { eventId: string; title: string; eventType: string; shareCents: number }[] =
    [];
  for (const e of [...upcoming, ...past]) {
    let totalNet = 0;
    for (const item of devBudgetStore.values()) {
      if (item.eventId === e.id) totalNet += item.actualNetCents ?? 0;
    }
    const participants = devLiveParticipantsStore.get(e.id) ?? [];
    // Divisor sind ausschliesslich die tatsaechlichen Teilnehmenden. Frueher wurden
    // hier +2 aufgeschlagen (Static-Mocks "Anna"/"Tim"), die es seit dem Pilot-
    // Aufraeumen nicht mehr gibt — der Pro-Kopf-Anteil war dadurch immer zu niedrig.
    // Ohne Teilnehmende ist der Anteil fachlich nicht berechenbar: weder 0 noch der
    // Gesamtbetrag waeren richtig, deshalb faellt das Event aus der Aufstellung.
    const headcount = participants.length;
    if (headcount === 0) continue;
    const share = Math.round(totalNet / headcount);
    if (share > 0) {
      totalCostCents += share;
      costByEvent.push({
        eventId: e.id,
        title: e.title,
        eventType: e.eventType,
        shareCents: share,
      });
    }
  }

  return c.json({
    upcoming,
    past,
    totalCostCents,
    costByEvent: costByEvent.sort((a, b) => b.shareCents - a.shareCents),
    registeredCount: upcoming.length,
    attendedCount: past.length,
  });
});
