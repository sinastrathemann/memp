import { useTranslation } from "react-i18next";
import { ROLE_EXPLANATION_ORDER } from "./role-order";

/**
 * Erklaert, was die Rollen duerfen. Bewusst als Aufzaehlung, nicht als
 * Rangfolge: mEXP-Rollen sind additiv.
 */
export function RoleLegend() {
  const { t } = useTranslation();
  return (
    <details className="card" style={{ marginBottom: "var(--space-4)" }}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>{t("admin.roleLegendTitle")}</summary>
      <ul style={{ marginTop: "var(--space-2)" }}>
        {ROLE_EXPLANATION_ORDER.map((role) => (
          <li key={role}>
            <code>{role}</code> — {t(`admin.roleDesc.${role}`)}
          </li>
        ))}
      </ul>
    </details>
  );
}
