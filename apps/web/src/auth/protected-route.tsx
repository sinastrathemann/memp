import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "./auth-context";
import type { RoleName } from "./types";

interface Props {
  children: ReactNode;
  roles?: readonly RoleName[];
}

export function ProtectedRoute({ children, roles }: Props) {
  const { user, isLoading, isError, hasRole } = useAuth();
  const { t } = useTranslation();

  if (isLoading) {
    return <p style={{ padding: "2rem" }}>{t("auth.loading")}</p>;
  }
  if (isError) {
    return (
      <div style={{ padding: "2rem" }}>
        <h2>{t("auth.errorTitle")}</h2>
        <p>{t("auth.errorBody")}</p>
      </div>
    );
  }
  if (!user) {
    // 401 → fetchMe() hat den Browser bereits zu /auth/logout umgeleitet (Hub-SSO).
    // Bis die Navigation greift, zeigen wir denselben Ladezustand statt kurz auf
    // eine App-eigene Login-Seite umzuschalten, die es nicht mehr gibt.
    return <p style={{ padding: "2rem" }}>{t("auth.loading")}</p>;
  }
  if (roles && roles.length > 0 && !hasRole(...roles)) {
    return (
      <div style={{ padding: "2rem" }}>
        <h2>{t("auth.forbiddenTitle")}</h2>
        <p>{t("auth.forbiddenBody")}</p>
      </div>
    );
  }
  return <>{children}</>;
}
