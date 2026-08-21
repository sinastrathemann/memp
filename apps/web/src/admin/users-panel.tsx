import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "../api/client";
import { ROLE_NAMES } from "../auth/types";
import type { AdminUserRow, RoleName } from "../auth/types";
import { RoleLegend } from "./role-legend";

export function UsersPanel() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => apiFetch<{ users: AdminUserRow[] }>("/admin/users"),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin", "users"] });

  const createMut = useMutation({
    mutationFn: (input: {
      email: string;
      password: string;
      displayName: string;
      roles: RoleName[];
    }) =>
      apiFetch("/admin/users", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });

  const toggleActiveMut = useMutation({
    mutationFn: (input: { id: string; isActive: boolean }) =>
      apiFetch(`/admin/users/${input.id}/active`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: input.isActive }),
      }),
    onSuccess: invalidate,
  });

  const addRoleMut = useMutation({
    mutationFn: (input: { id: string; role: RoleName }) =>
      apiFetch(`/admin/users/${input.id}/roles`, {
        method: "POST",
        body: JSON.stringify({ role: input.role }),
      }),
    onSuccess: invalidate,
  });

  const removeRoleMut = useMutation({
    mutationFn: (input: { id: string; role: RoleName }) =>
      apiFetch(`/admin/users/${input.id}/roles/${input.role}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });

  const resetPwMut = useMutation({
    mutationFn: (input: { id: string; newPassword: string }) =>
      apiFetch(`/admin/users/${input.id}/password`, {
        method: "POST",
        body: JSON.stringify({ newPassword: input.newPassword }),
      }),
  });

  return (
    <>
      <h2 style={{ marginTop: 0 }}>{t("admin.usersListTitle")}</h2>
      <CreateUserForm
        onSubmit={(v) => createMut.mutateAsync(v).catch(() => undefined)}
        pending={createMut.isPending}
        error={createMut.error}
      />

      <RoleLegend />
      {isLoading && <div className="card muted">{t("auth.loading")}</div>}
      {data && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="table">
            <thead>
              <tr>
                <th>{t("admin.colEmail")}</th>
                <th>{t("admin.colDisplayName")}</th>
                <th>{t("admin.colRoles")}</th>
                <th>{t("admin.colStatus")}</th>
                <th>{t("admin.colLastSeen")}</th>
                <th>{t("admin.colActions")}</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.id}>
                  <td className="text-bold">{u.email}</td>
                  <td>
                    {u.displayName}
                    {u.personioId && (
                      <div className="row" style={{ gap: 6, marginTop: 4 }}>
                        <span className="badge badge-cobalt">{t("admin.personioBadge")}</span>
                        {u.department && (
                          <span className="badge badge-outline">{u.department}</span>
                        )}
                      </div>
                    )}
                    {u.sharepointStudiId && (
                      <div className="row" style={{ gap: 6, marginTop: 4 }}>
                        <span className="badge badge-cobalt">{t("admin.sharepointBadge")}</span>
                        {u.team && <span className="badge badge-outline">{u.team}</span>}
                      </div>
                    )}
                    {u.csvImportedAt && (
                      <div className="row" style={{ gap: 6, marginTop: 4 }}>
                        <span className="badge badge-cobalt">{t("admin.csvBadge")}</span>
                      </div>
                    )}
                  </td>
                  <td>
                    <RoleEditor
                      currentRoles={u.roles}
                      onAdd={(role) => addRoleMut.mutate({ id: u.id, role })}
                      onRemove={(role) => removeRoleMut.mutate({ id: u.id, role })}
                    />
                  </td>
                  <td>
                    <span className={u.isActive ? "badge badge-success" : "badge badge-muted"}>
                      {u.isActive ? t("admin.active") : t("admin.inactive")}
                    </span>
                  </td>
                  <td>
                    {u.lastSeenAt
                      ? new Date(u.lastSeenAt).toLocaleString(i18n.language)
                      : t("admin.neverSeen")}
                  </td>
                  <td>
                    <div className="row" style={{ gap: "var(--space-2)" }}>
                      <button
                        type="button"
                        onClick={() => toggleActiveMut.mutate({ id: u.id, isActive: !u.isActive })}
                        className="btn btn-outline btn-sm"
                      >
                        {u.isActive ? t("admin.deactivate") : t("admin.activate")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const pw = window.prompt(t("admin.newPasswordPrompt") ?? "New password");
                          if (pw && pw.length >= 8) {
                            resetPwMut.mutate({ id: u.id, newPassword: pw });
                          }
                        }}
                        className="btn btn-ghost btn-sm"
                      >
                        {t("admin.resetPassword")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function CreateUserForm(props: {
  onSubmit: (v: {
    email: string;
    password: string;
    displayName: string;
    roles: RoleName[];
  }) => void;
  pending: boolean;
  error: unknown;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<RoleName>("participant");

  function submit(e: FormEvent) {
    e.preventDefault();
    props.onSubmit({ email, password, displayName, roles: [role] });
    setEmail("");
    setDisplayName("");
    setPassword("");
  }

  return (
    <form onSubmit={submit} className="card">
      <h2 className="card-title" style={{ marginTop: 0 }}>
        {t("admin.create")}
      </h2>
      <div className="field-row">
        <div className="field">
          <label className="label" htmlFor="adm-email">
            {t("admin.colEmail")}
          </label>
          <input
            id="adm-email"
            className="input"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="adm-name">
            {t("admin.colDisplayName")}
          </label>
          <input
            id="adm-name"
            className="input"
            type="text"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label className="label" htmlFor="adm-pw">
            {t("auth.passwordLabel")}
          </label>
          <input
            id="adm-pw"
            className="input"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="adm-role">
            {t("admin.colRoles")}
          </label>
          <select
            id="adm-role"
            className="select"
            value={role}
            onChange={(e) => setRole(e.target.value as RoleName)}
          >
            {ROLE_NAMES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-actions">
        <button type="submit" disabled={props.pending} className="btn btn-primary">
          {props.pending ? t("admin.creating") : t("admin.create")}
        </button>
      </div>
      {props.error instanceof Error && (
        <div className="alert alert-error">{props.error.message}</div>
      )}
    </form>
  );
}

function RoleEditor(props: {
  currentRoles: RoleName[];
  onAdd: (role: RoleName) => void;
  onRemove: (role: RoleName) => void;
}) {
  const available = ROLE_NAMES.filter((r) => !props.currentRoles.includes(r));
  return (
    <div className="row" style={{ gap: "var(--space-2)" }}>
      {props.currentRoles.map((r) => (
        <span key={r} className="badge badge-orange" style={{ gap: 4 }}>
          {r}
          <button
            type="button"
            onClick={() => props.onRemove(r)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
              color: "inherit",
              marginLeft: 4,
            }}
            aria-label={`remove ${r}`}
          >
            ×
          </button>
        </span>
      ))}
      {available.length > 0 && (
        <select
          className="select"
          defaultValue=""
          style={{ width: "auto", fontSize: "var(--text-xs)", padding: "2px 8px" }}
          onChange={(e) => {
            const value = e.target.value;
            if (value) {
              props.onAdd(value as RoleName);
              e.target.value = "";
            }
          }}
        >
          <option value="">+</option>
          {available.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
