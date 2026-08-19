import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/auth-context";
import { withBasePath } from "../base-path";
import {
  BUDGET_CATEGORIES,
  type BudgetCategory,
  type BudgetItemDto,
  type EventDto,
  type ParticipantDto,
} from "./types";

interface BudgetPanelProps {
  event: EventDto;
}

interface FormState {
  category: BudgetCategory;
  description: string;
  plannedAmountEuros: string;
  currency: string;
  taxNote: string;
  notes: string;
}

const initialForm: FormState = {
  category: "venue",
  description: "",
  plannedAmountEuros: "",
  currency: "EUR",
  taxNote: "",
  notes: "",
};

const STATUS_BADGE: Record<string, string> = {
  draft: "badge badge-outline",
  submitted: "badge badge-yellow",
  approved: "badge badge-success",
  rejected: "badge badge-orange",
};

interface InvoiceDraft {
  fileName: string;
  netEuros: string;
}

export function BudgetPanel({ event }: BudgetPanelProps) {
  const { t, i18n } = useTranslation();
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const canView = hasRole("admin", "manager", "event_office", "budget_owner");
  const canApprove = hasRole("admin", "manager", "budget_owner");
  const [form, setForm] = useState<FormState>(initialForm);
  const [showForm, setShowForm] = useState(false);
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});
  const [invoiceDraft, setInvoiceDraft] = useState<Record<string, InvoiceDraft>>({});
  const [openInvoice, setOpenInvoice] = useState<Record<string, boolean>>({});
  const [extractedById, setExtractedById] = useState<
    Record<
      string,
      {
        netCents: number | null;
        grossCents: number | null;
        vatPercent: number | null;
        confidence: "high" | "medium" | "low" | "none";
        reasoning: string;
      }
    >
  >({});

  const itemsQ = useQuery({
    queryKey: ["events", event.id, "budget"],
    queryFn: () => apiFetch<{ items: BudgetItemDto[] }>(`/events/${event.id}/budget`),
    enabled: canView,
  });

  // Teilnehmer für "Netto pro Person" — angemeldete + anwesende
  const participantsQ = useQuery({
    queryKey: ["events", event.id, "participants"],
    queryFn: () => apiFetch<{ participants: ParticipantDto[] }>(`/events/${event.id}/participants`),
    enabled: canView,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["events", event.id, "budget"] });

  const createMut = useMutation({
    mutationFn: (body: unknown) =>
      apiFetch<{ item: BudgetItemDto }>(`/events/${event.id}/budget`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setForm(initialForm);
      setShowForm(false);
      invalidate();
    },
  });

  const submitMut = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ item: BudgetItemDto }>(`/budget/${id}/submit`, { method: "POST" }),
    onSuccess: invalidate,
  });

  const approveMut = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ item: BudgetItemDto }>(`/budget/${id}/approve`, { method: "POST" }),
    onSuccess: invalidate,
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiFetch<{ item: BudgetItemDto }>(`/budget/${id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    onSuccess: (_d, vars) => {
      setRejectReason((s) => ({ ...s, [vars.id]: "" }));
      invalidate();
    },
  });

  const reopenMut = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ item: BudgetItemDto }>(`/budget/${id}/reopen`, { method: "POST" }),
    onSuccess: invalidate,
  });

  const invoiceMut = useMutation({
    mutationFn: ({
      id,
      body,
    }: { id: string; body: { actualNetCents: number; invoiceFileName: string } }) =>
      apiFetch<{ item: BudgetItemDto }>(`/budget/${id}/invoice`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (_d, vars) => {
      setOpenInvoice((s) => ({ ...s, [vars.id]: false }));
      setInvoiceDraft((s) => {
        const next = { ...s };
        delete next[vars.id];
        return next;
      });
      invalidate();
    },
  });

  // Yokoy-light: echter PDF-Upload mit Auto-Extraktion des Netto-Betrags
  const uploadMut = useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(withBasePath(`/api/budget/${id}/invoice/upload`), {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      const text = await res.text();
      const body = text ? JSON.parse(text) : null;
      if (!res.ok) {
        throw new Error(
          (body as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${res.status}`,
        );
      }
      return body as {
        item: BudgetItemDto;
        extraction: {
          netCents: number | null;
          grossCents: number | null;
          vatPercent: number | null;
          confidence: "high" | "medium" | "low" | "none";
          reasoning: string;
        };
      };
    },
    onSuccess: (data, vars) => {
      setExtractedById((s) => ({ ...s, [vars.id]: data.extraction }));
      setOpenInvoice((s) => ({ ...s, [vars.id]: false }));
      invalidate();
    },
  });

  const removeInvoiceMut = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ item: BudgetItemDto }>(`/budget/${id}/invoice`, { method: "DELETE" }),
    onSuccess: (_d, id) => {
      setExtractedById((s) => {
        const next = { ...s };
        delete next[id];
        return next;
      });
      invalidate();
    },
  });

  if (!canView) return null;

  const items = itemsQ.data?.items ?? [];
  const totalPlanned = items.reduce((sum, i) => sum + i.plannedAmountCents, 0);
  const totalNet = items.reduce((sum, i) => sum + (i.actualNetCents ?? 0), 0);

  const participants = participantsQ.data?.participants ?? [];
  // angemeldete = aktiv beteiligte (registered + attended); ohne Warteliste, Storno, No-Show
  const activeCount = participants.filter(
    (p) => p.status === "registered" || p.status === "attended",
  ).length;
  const netPerPerson = activeCount > 0 ? totalNet / activeCount : null;

  const fmtMoney = (cents: number, currency = "EUR") =>
    new Intl.NumberFormat(i18n.language === "de" ? "de-DE" : "en-US", {
      style: "currency",
      currency,
    }).format(cents / 100);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const cents = Math.round(Number(form.plannedAmountEuros.replace(",", ".")) * 100);
    if (!Number.isFinite(cents) || cents < 0) return;
    createMut.mutate({
      category: form.category,
      description: form.description,
      plannedAmountCents: cents,
      currency: form.currency || "EUR",
      taxNote: form.taxNote || null,
      notes: form.notes || null,
    });
  };

  const handleInvoiceSubmit = (id: string) => {
    const draft = invoiceDraft[id];
    if (!draft || !draft.fileName) return;
    const cents = Math.round(Number(draft.netEuros.replace(",", ".")) * 100);
    if (!Number.isFinite(cents) || cents < 0) return;
    invoiceMut.mutate({
      id,
      body: { actualNetCents: cents, invoiceFileName: draft.fileName },
    });
  };

  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">{t("budget.title")}</h2>
        <button
          type="button"
          onClick={() => setShowForm((s) => !s)}
          className={showForm ? "btn btn-outline btn-sm" : "btn btn-primary btn-sm"}
        >
          {showForm ? t("common.cancel") : `+ ${t("budget.addItem")}`}
        </button>
      </div>

      {(() => {
        // Restbudget = Geplant − Netto-Ist. Positiv = gespart, negativ = überzogen.
        const remaining = totalPlanned - totalNet;
        const overrun = remaining < 0;
        const hasNet = totalNet > 0;
        const remainingTone = !hasNet ? "stat" : overrun ? "stat stat-orange" : "stat";
        const remainingLabel = !hasNet
          ? "Restbudget"
          : overrun
            ? `Überzogen um ${fmtMoney(Math.abs(remaining))}`
            : `Gespart · noch ${fmtMoney(remaining)} übrig`;

        return (
          <div
            className="stat-grid"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}
          >
            <div className="stat">
              <div className="stat-value" style={{ fontSize: "var(--text-2xl)" }}>
                {fmtMoney(totalPlanned)}
              </div>
              <div className="stat-label">{t("budget.kpiPlanned")}</div>
            </div>
            <div className="stat stat-orange">
              <div className="stat-value" style={{ fontSize: "var(--text-2xl)" }}>
                {fmtMoney(totalNet)}
              </div>
              <div className="stat-label">Σ Netto-Ist (aus Rechnungen)</div>
            </div>
            <div className={remainingTone}>
              <div
                className="stat-value"
                style={{
                  fontSize: "var(--text-2xl)",
                  color: overrun ? "var(--brand-orange)" : hasNet ? "var(--brand-lime)" : undefined,
                }}
              >
                {fmtMoney(remaining)}
              </div>
              <div className="stat-label">{remainingLabel}</div>
            </div>
            <div className="stat stat-ink">
              <div className="stat-value" style={{ fontSize: "var(--text-2xl)" }}>
                {netPerPerson === null ? "—" : fmtMoney(Math.round(netPerPerson))}
              </div>
              <div className="stat-label">
                Netto / Person · {activeCount} {activeCount === 1 ? "Teiln." : "Teiln."}
              </div>
            </div>
          </div>
        );
      })()}

      {showForm && (
        <form onSubmit={handleCreate} className="card-flat">
          <div className="field-row">
            <div className="field">
              <label className="label" htmlFor="bud-cat">
                {t("budget.fieldCategory")}
              </label>
              <select
                id="bud-cat"
                className="select"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value as BudgetCategory })}
              >
                {BUDGET_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`budget.category.${c}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="bud-amt">
                Geplant ({form.currency})
              </label>
              <input
                id="bud-amt"
                className="input"
                type="text"
                inputMode="decimal"
                value={form.plannedAmountEuros}
                onChange={(e) => setForm({ ...form, plannedAmountEuros: e.target.value })}
                required
              />
            </div>
          </div>
          <div className="field">
            <label className="label" htmlFor="bud-desc">
              {t("budget.fieldDescription")}
            </label>
            <input
              id="bud-desc"
              className="input"
              type="text"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              required
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="bud-tax">
              {t("budget.fieldTaxNote")}
            </label>
            <input
              id="bud-tax"
              className="input"
              type="text"
              value={form.taxNote}
              onChange={(e) => setForm({ ...form, taxNote: e.target.value })}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="bud-notes">
              {t("budget.fieldNotes")}
            </label>
            <textarea
              id="bud-notes"
              className="textarea"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
            />
          </div>
          <div className="form-actions">
            <button type="submit" disabled={createMut.isPending} className="btn btn-primary">
              {t("common.save")}
            </button>
            {createMut.error instanceof Error && (
              <span className="err-msg">{createMut.error.message}</span>
            )}
          </div>
        </form>
      )}

      {itemsQ.isLoading ? (
        <p className="muted">{t("auth.loading")}</p>
      ) : items.length === 0 ? (
        <p className="muted">{t("budget.empty")}</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{t("budget.fieldCategory")}</th>
              <th>{t("budget.fieldDescription")}</th>
              <th style={{ textAlign: "right" }}>Geplant</th>
              <th style={{ textAlign: "right" }}>Netto-Ist</th>
              <th>Rechnung</th>
              <th>{t("budget.fieldStatus")}</th>
              <th>{t("budget.fieldActions")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const draft = invoiceDraft[item.id] ?? { fileName: "", netEuros: "" };
              const isOpen = openInvoice[item.id] ?? false;
              return (
                <Fragment key={item.id}>
                  <tr>
                    <td className="text-bold">{t(`budget.category.${item.category}`)}</td>
                    <td>
                      {item.description}
                      {item.taxNote && (
                        <div className="muted text-xs" style={{ marginTop: 2 }}>
                          {t("budget.fieldTaxNote")}: {item.taxNote}
                        </div>
                      )}
                      {item.status === "rejected" && item.rejectedReason && (
                        <div className="err-msg">
                          {t("budget.rejectedReason")}: {item.rejectedReason}
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }} className="text-mono">
                      {fmtMoney(item.plannedAmountCents, item.currency)}
                    </td>
                    <td style={{ textAlign: "right" }} className="text-mono text-bold">
                      {item.actualNetCents === null
                        ? "—"
                        : fmtMoney(item.actualNetCents, item.currency)}
                    </td>
                    <td>
                      {item.invoiceFileName ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <div className="row" style={{ gap: 6, alignItems: "center" }}>
                            <span
                              className="badge badge-success"
                              style={{ maxWidth: 220 }}
                              title={item.invoiceFileName}
                            >
                              📄{" "}
                              {item.invoiceFileName.length > 22
                                ? `${item.invoiceFileName.slice(0, 20)}…`
                                : item.invoiceFileName}
                            </span>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => removeInvoiceMut.mutate(item.id)}
                              disabled={removeInvoiceMut.isPending}
                              title="Rechnung entfernen"
                            >
                              ×
                            </button>
                          </div>
                          {extractedById[item.id] && (
                            <span
                              className="text-mono text-xs muted"
                              style={{ fontSize: 10 }}
                              title={extractedById[item.id]?.reasoning ?? ""}
                            >
                              🤖 Auto-erkannt · {extractedById[item.id]?.confidence ?? "?"}
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="row" style={{ gap: 6 }}>
                          <label
                            className={`btn btn-primary btn-sm${uploadMut.isPending ? " disabled" : ""}`}
                            style={{
                              cursor: uploadMut.isPending ? "not-allowed" : "pointer",
                              margin: 0,
                            }}
                            title="PDF hochladen — Netto wird automatisch erkannt"
                          >
                            {uploadMut.isPending && uploadMut.variables?.id === item.id
                              ? "⏳ Analysiere…"
                              : "🤖 PDF auto"}
                            <input
                              type="file"
                              accept="application/pdf,.pdf"
                              style={{ display: "none" }}
                              disabled={uploadMut.isPending}
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) uploadMut.mutate({ id: item.id, file: f });
                                e.target.value = "";
                              }}
                            />
                          </label>
                          <button
                            type="button"
                            className="btn btn-outline-orange btn-sm"
                            onClick={() => setOpenInvoice((s) => ({ ...s, [item.id]: !isOpen }))}
                          >
                            {isOpen ? "Abbrechen" : "manuell"}
                          </button>
                        </div>
                      )}
                      {uploadMut.error instanceof Error && uploadMut.variables?.id === item.id && (
                        <div className="err-msg" style={{ marginTop: 4 }}>
                          {uploadMut.error.message}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={STATUS_BADGE[item.status] ?? "badge badge-muted"}>
                        {t(`budget.status.${item.status}`)}
                      </span>
                    </td>
                    <td>
                      <div className="row" style={{ gap: "var(--space-2)" }}>
                        {item.status === "draft" && (
                          <button
                            type="button"
                            onClick={() => submitMut.mutate(item.id)}
                            disabled={submitMut.isPending}
                            className="btn btn-outline-orange btn-sm"
                          >
                            {t("budget.submit")}
                          </button>
                        )}
                        {item.status === "submitted" && canApprove && (
                          <>
                            <button
                              type="button"
                              onClick={() => approveMut.mutate(item.id)}
                              disabled={approveMut.isPending}
                              className="btn btn-primary btn-sm"
                            >
                              {t("budget.approve")}
                            </button>
                            <input
                              className="input"
                              type="text"
                              placeholder={t("budget.rejectReasonPlaceholder")}
                              value={rejectReason[item.id] ?? ""}
                              onChange={(e) =>
                                setRejectReason((s) => ({ ...s, [item.id]: e.target.value }))
                              }
                              style={{ width: 160 }}
                            />
                            <button
                              type="button"
                              onClick={() =>
                                rejectMut.mutate({
                                  id: item.id,
                                  reason: rejectReason[item.id] ?? "",
                                })
                              }
                              disabled={
                                rejectMut.isPending || !(rejectReason[item.id] ?? "").trim()
                              }
                              className="btn btn-outline btn-sm"
                            >
                              {t("budget.reject")}
                            </button>
                          </>
                        )}
                        {item.status === "rejected" && (
                          <button
                            type="button"
                            onClick={() => reopenMut.mutate(item.id)}
                            disabled={reopenMut.isPending}
                            className="btn btn-ghost btn-sm"
                          >
                            {t("budget.reopen")}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {isOpen && !item.invoiceFileName && (
                    <tr key={`${item.id}-invoice`}>
                      <td colSpan={7} style={{ background: "var(--bg-subtle)" }}>
                        <div
                          style={{
                            display: "flex",
                            gap: "var(--space-3)",
                            alignItems: "flex-end",
                            flexWrap: "wrap",
                            padding: "var(--space-2) 0",
                          }}
                        >
                          <div className="field" style={{ margin: 0, flex: "1 1 240px" }}>
                            <label className="label" htmlFor="invoice-file">
                              Rechnungs-Datei
                            </label>
                            <input
                              id="invoice-file"
                              type="file"
                              accept=".pdf,.png,.jpg,.jpeg"
                              className="input"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) {
                                  setInvoiceDraft((s) => ({
                                    ...s,
                                    [item.id]: { ...draft, fileName: f.name },
                                  }));
                                }
                              }}
                            />
                          </div>
                          <div className="field" style={{ margin: 0, flex: "0 1 180px" }}>
                            <label className="label" htmlFor="net-amount">
                              Netto-Betrag (€)
                            </label>
                            <input
                              id="net-amount"
                              className="input"
                              type="text"
                              inputMode="decimal"
                              placeholder="0,00"
                              value={draft.netEuros}
                              onChange={(e) =>
                                setInvoiceDraft((s) => ({
                                  ...s,
                                  [item.id]: { ...draft, netEuros: e.target.value },
                                }))
                              }
                            />
                          </div>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => handleInvoiceSubmit(item.id)}
                            disabled={invoiceMut.isPending || !draft.fileName || !draft.netEuros}
                          >
                            Speichern
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
