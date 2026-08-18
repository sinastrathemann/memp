import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/auth-context";
import {
  EVENT_STATUSES,
  type EventStatus,
  PARTICIPATION_STATUSES,
  type ParticipationStatus,
} from "../events/types";

interface PortfolioStatsDto {
  eventsByStatus: Record<EventStatus, number>;
  participationByStatus: Record<ParticipationStatus, number>;
  upcomingEventsCount: number;
  attendanceRate: number | null;
  noShowRate: number | null;
  totalEvents: number;
}

const STATUS_FILL: Record<EventStatus, string> = {
  draft: "",
  planned: "fill-yellow",
  open: "fill-orange",
  running: "fill-lime",
  closed: "",
  cancelled: "",
};

const PART_FILL: Record<ParticipationStatus, string> = {
  registered: "fill-cobalt",
  waitlisted: "fill-yellow",
  attended: "fill-lime",
  no_show: "fill-orange",
  cancelled: "",
};

export default function DashboardPage() {
  const { t } = useTranslation();
  const { user, hasRole } = useAuth();
  const canSeeRates = hasRole("admin", "manager", "event_office");
  const firstName = (user?.name ?? "").split(" ")[0] || user?.name || "";
  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard", "portfolio"],
    queryFn: () => apiFetch<{ stats: PortfolioStatsDto }>("/dashboard/portfolio"),
  });

  if (isLoading) return <div className="page">{t("auth.loading")}</div>;
  if (error instanceof Error)
    return (
      <div className="page">
        <div className="alert alert-error">{error.message}</div>
      </div>
    );
  if (!data) return null;

  const s = data.stats;
  const fmtPct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

  const eventMax = Math.max(1, ...EVENT_STATUSES.map((es) => s.eventsByStatus[es] ?? 0));
  const partMax = Math.max(
    1,
    ...PARTICIPATION_STATUSES.map((ps) => s.participationByStatus[ps] ?? 0),
  );

  const runningCount = s.eventsByStatus.running ?? 0;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="eyebrow">Portfolio · Live</div>
          <h1 className="page-title">Hallo{firstName ? `, ${firstName}` : ""}</h1>
          <p className="page-subtitle">Übersicht aller Events, Teilnehmer und Quoten</p>
        </div>
      </div>

      <section className="bento">
        {/* Hero KPI — total events on dark ink */}
        <div className="bento-tile tone-ink span-5 row-2">
          <div className="bento-decorative" />
          <div className="bento-decorative-2" />
          <div className="bento-eyebrow">🗂️ {t("dashboard.totalEvents")}</div>
          <div className="bento-headline" style={{ fontSize: "clamp(4rem, 10vw, 8rem)" }}>
            {s.totalEvents}
          </div>
          <div className="bento-sub" style={{ marginTop: "var(--space-4)" }}>
            Events im aktiven Portfolio
          </div>
        </div>

        {/* Upcoming — orange — prominent, this is the widget that actually matters right now */}
        <div className="bento-tile tone-orange span-4">
          <div className="bento-decorative" />
          <div className="bento-eyebrow">📅 {t("dashboard.upcomingEvents")}</div>
          <div className="bento-headline">
            {s.upcomingEventsCount > 0 ? s.upcomingEventsCount : "–"}
          </div>
          <div className="bento-sub">
            {s.upcomingEventsCount > 0
              ? "in den nächsten 30 Tagen"
              : "Nichts in den nächsten 30 Tagen"}
          </div>
        </div>

        {/* Attendance — yellow (nur für Manager/Admin) */}
        {canSeeRates && (
          <div className="bento-tile tone-yellow span-3">
            <div className="bento-eyebrow">✅ {t("dashboard.attendanceRate")}</div>
            <div className="bento-headline">{fmtPct(s.attendanceRate)}</div>
            <div className="bento-sub">Teilnahmequote</div>
          </div>
        )}

        {/* No show (nur für Manager/Admin) */}
        {canSeeRates && (
          <div className="bento-tile span-4">
            <div className="bento-eyebrow">⚠️ {t("dashboard.noShowRate")}</div>
            <div className="bento-headline size-md" style={{ color: "var(--brand-orange)" }}>
              {fmtPct(s.noShowRate)}
            </div>
            <div className="bento-sub muted">No-Show-Quote</div>
          </div>
        )}

        {/* Events by status — wide bar chart */}
        <div className="bento-tile span-7">
          <div className="bento-eyebrow">📊 {t("dashboard.eventsByStatus")}</div>
          <h3 style={{ marginTop: "var(--space-2)", marginBottom: "var(--space-4)" }}>
            Status-Verteilung
          </h3>
          <div className="bento-bars">
            {EVENT_STATUSES.map((es) => {
              const v = s.eventsByStatus[es] ?? 0;
              const pct = (v / eventMax) * 100;
              return (
                <div key={es} className="bar-row">
                  <span className="bar-label">{t(`events.status.${es}`)}</span>
                  <span className="bar-track">
                    <span
                      className={`bar-fill ${STATUS_FILL[es]}`}
                      style={{ width: `${Math.max(pct, 2)}%` }}
                    />
                  </span>
                  <span className="bar-value">{v}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Participation by status */}
        <div className="bento-tile span-5">
          <div className="bento-eyebrow">👥 {t("dashboard.participationByStatus")}</div>
          <h3 style={{ marginTop: "var(--space-2)", marginBottom: "var(--space-4)" }}>
            Teilnehmer
          </h3>
          <div className="bento-bars">
            {PARTICIPATION_STATUSES.map((ps) => {
              const v = s.participationByStatus[ps] ?? 0;
              const pct = (v / partMax) * 100;
              return (
                <div key={ps} className="bar-row">
                  <span className="bar-label">{t(`participants.status.${ps}`)}</span>
                  <span className="bar-track">
                    <span
                      className={`bar-fill ${PART_FILL[ps]}`}
                      style={{ width: `${Math.max(pct, 2)}%` }}
                    />
                  </span>
                  <span className="bar-value">{v}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Live ticker — de-emphasized, placed last, honest empty state when nothing runs */}
        <div className="bento-tile span-12">
          {runningCount > 0 ? (
            <>
              <div className="bento-eyebrow">
                <span className="badge badge-success badge-live" style={{ padding: "2px 8px" }}>
                  Live
                </span>
              </div>
              <div className="bento-headline size-sm" style={{ marginTop: "var(--space-4)" }}>
                {runningCount} aktiv
              </div>
              <div className="bento-sub muted">Events laufen jetzt</div>
            </>
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-3)",
              }}
            >
              <span className="badge badge-muted" style={{ padding: "2px 10px" }}>
                Live
              </span>
              <span className="muted text-sm">
                💤 Momentan keine laufenden Events — die nächsten Termine stehen oben.
              </span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
