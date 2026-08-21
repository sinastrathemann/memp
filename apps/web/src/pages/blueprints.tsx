import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/auth-context";
import {
  EVENT_TYPES,
  EVENT_VISIBILITIES,
  type EventBlueprintDto,
  type EventDto,
  type EventType,
  type EventVisibility,
} from "../events/types";

interface CreateFormState {
  name: string;
  description: string;
  eventType: EventType;
  visibility: EventVisibility;
  defaultDurationMinutes: string;
  defaultCapacity: string;
  defaultLocation: string;
  defaultDescription: string;
}

const initialCreate: CreateFormState = {
  name: "",
  description: "",
  eventType: "team",
  visibility: "internal",
  defaultDurationMinutes: "120",
  defaultCapacity: "",
  defaultLocation: "",
  defaultDescription: "",
};

export default function BlueprintsPage() {
  const { t } = useTranslation();
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canWrite = hasRole("admin", "manager", "event_office");
  // Löschen nur Admin (Sina's Regel: Anlegen/Anwenden dürfen mehr Rollen, Löschen nicht).
  const canDelete = hasRole("admin");
  const [form, setForm] = useState<CreateFormState>(initialCreate);
  const [showForm, setShowForm] = useState(false);
  const [applyFor, setApplyFor] = useState<string | null>(null);
  const [applyTitle, setApplyTitle] = useState("");
  const [applyStart, setApplyStart] = useState("");

  const listQ = useQuery({
    queryKey: ["blueprints"],
    queryFn: () => apiFetch<{ blueprints: EventBlueprintDto[] }>("/blueprints"),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["blueprints"] });

  const createMut = useMutation({
    mutationFn: (body: unknown) =>
      apiFetch<{ blueprint: EventBlueprintDto }>("/blueprints", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setForm(initialCreate);
      setShowForm(false);
      invalidate();
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiFetch(`/blueprints/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });

  const applyMut = useMutation({
    mutationFn: (input: { id: string; title: string; startAt: string }) =>
      apiFetch<{ event: EventDto }>(`/blueprints/${input.id}/apply`, {
        method: "POST",
        body: JSON.stringify({ title: input.title, startAt: input.startAt }),
      }),
    onSuccess: (res) => {
      setApplyFor(null);
      setApplyTitle("");
      setApplyStart("");
      navigate(`/events/${res.event.id}`);
    },
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const duration = Number(form.defaultDurationMinutes);
    if (!Number.isFinite(duration) || duration <= 0) return;
    const capacity = form.defaultCapacity.trim() === "" ? null : Number(form.defaultCapacity);
    createMut.mutate({
      name: form.name,
      description: form.description,
      eventType: form.eventType,
      visibility: form.visibility,
      defaultDurationMinutes: duration,
      defaultCapacity: capacity,
      defaultLocation: form.defaultLocation.trim() === "" ? null : form.defaultLocation,
      defaultDescription: form.defaultDescription,
    });
  };

  const handleApply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!applyFor) return;
    applyMut.mutate({
      id: applyFor,
      title: applyTitle,
      startAt: new Date(applyStart).toISOString(),
    });
  };

  return (
    <>
      <h2 style={{ marginTop: 0 }}>{t("blueprints.sectionTitle")}</h2>
      <div className="row-between" style={{ marginBottom: "var(--space-6)" }}>
        <p className="muted page-subtitle" style={{ marginTop: 0 }}>
          {t("blueprints.intro")}
        </p>
        {canWrite && (
          <button
            type="button"
            onClick={() => setShowForm((s) => !s)}
            className={showForm ? "btn btn-outline btn-sm" : "btn btn-primary btn-sm"}
          >
            {showForm ? t("common.cancel") : `+ ${t("blueprints.create")}`}
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="card">
          <div className="field">
            <label className="label" htmlFor="bp-name">
              {t("blueprints.fieldName")}
            </label>
            <input
              id="bp-name"
              className="input"
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="bp-desc">
              {t("blueprints.fieldDescription")}
            </label>
            <input
              id="bp-desc"
              className="input"
              type="text"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="field-row">
            <div className="field">
              <label className="label" htmlFor="bp-type">
                {t("events.fieldType")}
              </label>
              <select
                id="bp-type"
                className="select"
                value={form.eventType}
                onChange={(e) => setForm({ ...form, eventType: e.target.value as EventType })}
              >
                {EVENT_TYPES.map((x) => (
                  <option key={x} value={x}>
                    {t(`events.type.${x}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="bp-vis">
                {t("events.fieldVisibility")}
              </label>
              <select
                id="bp-vis"
                className="select"
                value={form.visibility}
                onChange={(e) =>
                  setForm({ ...form, visibility: e.target.value as EventVisibility })
                }
              >
                {EVENT_VISIBILITIES.map((x) => (
                  <option key={x} value={x}>
                    {t(`events.visibility.${x}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label className="label" htmlFor="bp-dur">
                {t("blueprints.fieldDuration")}
              </label>
              <input
                id="bp-dur"
                className="input"
                type="number"
                min={1}
                required
                value={form.defaultDurationMinutes}
                onChange={(e) => setForm({ ...form, defaultDurationMinutes: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="bp-cap">
                {t("blueprints.fieldCapacity")}
              </label>
              <input
                id="bp-cap"
                className="input"
                type="number"
                min={1}
                value={form.defaultCapacity}
                onChange={(e) => setForm({ ...form, defaultCapacity: e.target.value })}
              />
            </div>
          </div>
          <div className="field">
            <label className="label" htmlFor="bp-loc">
              {t("blueprints.fieldLocation")}
            </label>
            <input
              id="bp-loc"
              className="input"
              type="text"
              value={form.defaultLocation}
              onChange={(e) => setForm({ ...form, defaultLocation: e.target.value })}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="bp-defdesc">
              {t("blueprints.fieldDefaultDescription")}
            </label>
            <textarea
              id="bp-defdesc"
              className="textarea"
              rows={3}
              value={form.defaultDescription}
              onChange={(e) => setForm({ ...form, defaultDescription: e.target.value })}
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

      {listQ.isLoading ? (
        <div className="card muted">{t("auth.loading")}</div>
      ) : (listQ.data?.blueprints.length ?? 0) === 0 ? (
        <div className="card muted">{t("blueprints.empty")}</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="table">
            <thead>
              <tr>
                <th>{t("blueprints.fieldName")}</th>
                <th>{t("events.fieldType")}</th>
                <th>{t("blueprints.fieldDuration")}</th>
                <th>{t("blueprints.fieldCapacity")}</th>
                <th>{t("blueprints.fieldLocation")}</th>
                <th>{t("blueprints.fieldActions")}</th>
              </tr>
            </thead>
            <tbody>
              {listQ.data?.blueprints.map((bp) => (
                <tr key={bp.id}>
                  <td>
                    <div className="text-bold">{bp.name}</div>
                    {bp.description && (
                      <div className="muted text-xs" style={{ marginTop: 2 }}>
                        {bp.description}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className="badge badge-orange">{t(`events.type.${bp.eventType}`)}</span>
                  </td>
                  <td>{bp.defaultDurationMinutes} min</td>
                  <td>{bp.defaultCapacity ?? "—"}</td>
                  <td>{bp.defaultLocation ?? "—"}</td>
                  <td>
                    {(canWrite || canDelete) && (
                      <div className="row" style={{ gap: "var(--space-2)" }}>
                        {canWrite && (
                          <button
                            type="button"
                            onClick={() => {
                              setApplyFor(bp.id);
                              setApplyTitle(bp.name);
                              setApplyStart("");
                            }}
                            className="btn btn-primary btn-sm"
                          >
                            {t("blueprints.apply")}
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm(t("blueprints.confirmDelete") ?? "Delete?")) {
                                deleteMut.mutate(bp.id);
                              }
                            }}
                            className="btn btn-ghost btn-sm"
                          >
                            {t("blueprints.delete")}
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {applyFor && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setApplyFor(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setApplyFor(null);
          }}
        >
          <form onSubmit={handleApply} className="modal">
            <div className="eyebrow">Vorlage</div>
            <h2 style={{ marginTop: 0 }}>{t("blueprints.applyTitle")}</h2>
            <div className="field">
              <label className="label" htmlFor="ap-title">
                {t("events.fieldTitle")}
              </label>
              <input
                id="ap-title"
                className="input"
                type="text"
                required
                value={applyTitle}
                onChange={(e) => setApplyTitle(e.target.value)}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="ap-start">
                {t("events.fieldStart")}
              </label>
              <input
                id="ap-start"
                className="input"
                type="datetime-local"
                required
                value={applyStart}
                onChange={(e) => setApplyStart(e.target.value)}
              />
            </div>
            <div className="form-actions" style={{ justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setApplyFor(null)} className="btn btn-outline">
                {t("common.cancel")}
              </button>
              <button type="submit" disabled={applyMut.isPending} className="btn btn-primary">
                {t("blueprints.apply")}
              </button>
            </div>
            {applyMut.error instanceof Error && (
              <div className="alert alert-error" style={{ marginTop: "var(--space-3)" }}>
                {applyMut.error.message}
              </div>
            )}
          </form>
        </div>
      )}
    </>
  );
}
