import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiRequestError, apiFetch } from "../api/client";
import { withBasePath } from "../base-path";
import type { TenderDto, VendorDto } from "../events/types";

interface SessionResponse {
  vendor: Pick<VendorDto, "id" | "email" | "companyName" | "contactName">;
  tender: TenderDto;
}

interface VendorQnaItem {
  id: string;
  question: string;
  askedAt: string;
  answer: string | null;
  answeredAt: string | null;
  askerLabel: string;
  askerVendorId: string | null;
}

export default function VendorPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const sessionQ = useQuery({
    queryKey: ["vendor-session", token],
    queryFn: () =>
      apiFetch<SessionResponse>(`/vendors/session?token=${encodeURIComponent(token ?? "")}`),
    enabled: Boolean(token),
    retry: false,
  });

  if (!token) {
    return (
      <div className="page page-narrow">
        <div className="alert alert-error">
          Kein Zugangs-Token in der URL. Bitte verwende den Einladungs-Link aus deiner E-Mail.
        </div>
      </div>
    );
  }

  if (sessionQ.isLoading) {
    return <div className="page page-narrow">Lädt …</div>;
  }

  if (sessionQ.error) {
    const err = sessionQ.error;
    const msg = err instanceof ApiRequestError ? err.message : "Unbekannter Fehler";
    return (
      <div className="page page-narrow">
        <div className="alert alert-error">
          <strong>Zugriff nicht möglich:</strong> {msg}
        </div>
        <p className="muted text-sm" style={{ marginTop: 12 }}>
          Falls du diesen Link von mindsquare bekommen hast und er nicht funktioniert: melde dich
          gerne bei der Person, die dich eingeladen hat — wahrscheinlich muss ein neuer Link
          generiert werden.
        </p>
      </div>
    );
  }

  if (!sessionQ.data) return null;

  const { vendor, tender } = sessionQ.data;
  const deadline = tender.deadline ? new Date(tender.deadline) : null;
  const deadlineExpired = deadline && deadline.getTime() < Date.now();

  return (
    <div className="page page-narrow">
      <div
        style={{
          padding: "var(--space-3) var(--space-4)",
          background: "var(--brand-orange)",
          color: "var(--color-white)",
          borderRadius: "var(--radius-md)",
          marginBottom: "var(--space-4)",
        }}
      >
        <div className="text-mono text-xs" style={{ letterSpacing: "var(--tracking-wider)" }}>
          🤝 ANBIETER-PORTAL · mindsquare AG
        </div>
        <div style={{ fontSize: "var(--text-md)", fontWeight: 700, marginTop: 4 }}>
          Hallo {vendor.contactName || vendor.companyName}!
        </div>
        <div style={{ fontSize: "var(--text-sm)", opacity: 0.9, marginTop: 2 }}>
          Du bist eingeladen, ein Angebot abzugeben. Diese Seite ist nur über deinen persönlichen
          Link erreichbar.
        </div>
      </div>

      <div className="page-header" style={{ borderBottom: "none", marginBottom: "var(--space-4)" }}>
        <div>
          <div className="eyebrow">Ausschreibung</div>
          <h1 className="page-title" style={{ fontSize: "var(--text-2xl)" }}>
            {tender.title}
          </h1>
          {deadline && (
            <p className="page-subtitle">
              Deadline für Angebote:{" "}
              <span
                className="text-bold"
                style={{ color: deadlineExpired ? "var(--brand-orange)" : "var(--fg-strong)" }}
              >
                {deadline.toLocaleString("de-DE", { dateStyle: "long", timeStyle: "short" })}
              </span>{" "}
              {deadlineExpired && <span className="badge badge-orange">abgelaufen</span>}
            </p>
          )}
        </div>
      </div>

      <section className="card">
        <h2 className="card-title">Briefing</h2>
        {tender.briefing ? (
          <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{tender.briefing}</p>
        ) : (
          <p className="muted">Noch keine Briefing-Details hinterlegt.</p>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">Bewertungs-Kriterien</h2>
        <p className="muted text-sm" style={{ margin: "0 0 var(--space-3)" }}>
          Dein Angebot wird anhand dieser Kriterien bewertet.
        </p>
        {tender.criteria.length === 0 ? (
          <p className="muted">Keine Kriterien hinterlegt.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Kriterium</th>
                <th style={{ textAlign: "right" }}>Gewichtung</th>
              </tr>
            </thead>
            <tbody>
              {tender.criteria.map((c, idx) => (
                <tr key={`criterion-${idx}-${c.label}`}>
                  <td className="text-bold">{c.label}</td>
                  <td className="text-mono" style={{ textAlign: "right" }}>
                    {c.weight}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <VendorQnaSection tenderId={tender.id} token={token} />

      <section className="card">
        <h2 className="card-title">Angebot einreichen</h2>
        <p className="muted">Angebots-Upload + KI-Bewertung kommen in den nächsten Phasen.</p>
      </section>

      <div className="muted text-xs" style={{ marginTop: "var(--space-6)" }}>
        Eingeloggt als: {vendor.email} · {vendor.companyName} — bei Fragen wende dich an deine
        Ansprechperson bei mindsquare.
      </div>
    </div>
  );
}

function VendorQnaSection({ tenderId, token }: { tenderId: string; token: string }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");

  const qnaQ = useQuery({
    queryKey: ["vendor-qna", tenderId, token],
    queryFn: () =>
      apiFetch<{ items: VendorQnaItem[] }>(
        `/tenders/${tenderId}/qna?token=${encodeURIComponent(token)}`,
      ),
    refetchInterval: 60_000,
  });

  const askMut = useMutation({
    mutationFn: async (question: string) => {
      const res = await fetch(
        withBasePath(`/api/tenders/${tenderId}/qna?token=${encodeURIComponent(token)}`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (body as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`,
        );
      }
      return body;
    },
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey: ["vendor-qna", tenderId, token] });
    },
  });

  const items = qnaQ.data?.items ?? [];

  return (
    <section className="card">
      <h2 className="card-title">Fragen & Antworten</h2>
      <p className="muted text-sm" style={{ margin: "0 0 var(--space-3)" }}>
        Stelle eine Frage zur Ausschreibung. <strong>Alle Antworten</strong> sind für alle
        eingeladenen Anbieter sichtbar — Fragesteller bleiben anonym ("Anbieter A/B/…").
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {items.length === 0 && <p className="muted">Noch keine Fragen gestellt.</p>}
        {items.map((q) => (
          <div
            key={q.id}
            style={{
              padding: "var(--space-3)",
              background: "var(--bg-subtle)",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-default)",
            }}
          >
            <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
              <span className="text-bold">{q.askerLabel}</span>
              <span className="muted text-xs">
                {new Date(q.askedAt).toLocaleString("de-DE", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </span>
            </div>
            <p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{q.question}</p>
            {q.answer ? (
              <div
                style={{
                  marginTop: 8,
                  padding: "8px 10px",
                  background: "var(--bg-default)",
                  borderLeft: "3px solid var(--brand-lime)",
                  borderRadius: "var(--radius-base)",
                }}
              >
                <div className="text-mono text-xs muted" style={{ marginBottom: 4 }}>
                  ✓ Antwort vom Veranstalter
                </div>
                <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{q.answer}</p>
              </div>
            ) : (
              <div className="muted text-xs" style={{ marginTop: 6, fontStyle: "italic" }}>
                Wird gerade beantwortet …
              </div>
            )}
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: "var(--space-4)",
          padding: "var(--space-3)",
          background: "var(--bg-default)",
          border: "1px solid var(--border-default)",
          borderRadius: "var(--radius-md)",
        }}
      >
        <label className="label" htmlFor="vendor-question">
          Neue Frage stellen
        </label>
        <textarea
          id="vendor-question"
          className="textarea"
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="z. B. Welche Personenzahl ist verbindlich? oder Gibt es Anforderungen an Halal/koscher?"
        />
        {askMut.error instanceof Error && (
          <div className="alert alert-error" style={{ marginTop: 6 }}>
            {askMut.error.message}
          </div>
        )}
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={askMut.isPending || draft.trim().length < 3}
          style={{ marginTop: 8 }}
          onClick={() => askMut.mutate(draft.trim())}
        >
          {askMut.isPending ? "Sende…" : "Frage senden"}
        </button>
      </div>
    </section>
  );
}
