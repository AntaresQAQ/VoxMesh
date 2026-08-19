import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";

import { apiClient } from "./api.js";
import { useI18n } from "./i18n/i18n.js";
import { queryKeys } from "./query.js";

const pages = [
  { to: "/dashboard", key: "nav.dashboard" },
  { to: "/chat", key: "nav.chat" },
  { to: "/conversations", key: "nav.conversations" },
  { to: "/logs", key: "nav.logs" }
] as const;

export function Console() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: apiClient.logout,
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: queryKeys.session });
      await navigate({
        to: "/login",
        search: { redirect: null },
        replace: true
      });
    }
  });

  return (
    <div className="shell">
      <a className="skip-link" href="#main-content">
        {t("common.skipToContent")}
      </a>
      <aside>
        <div>
          <p className="eyebrow">{t("common.consoleTagline")}</p>
          <h1>{t("common.productName")}</h1>
        </div>
        <nav aria-label={t("nav.label")}>
          {pages.map((page) => (
            <Link
              key={page.to}
              to={page.to}
              activeProps={{ className: "active" }}
            >
              {t(page.key)}
            </Link>
          ))}
          <Link
            to="/settings"
            search={{ section: "general" }}
            activeOptions={{ includeSearch: false }}
            activeProps={{ className: "active" }}
          >
            {t("nav.settings")}
          </Link>
        </nav>
        <button className="secondary" onClick={() => logout.mutate()}>
          {t("auth.signOut")}
        </button>
      </aside>
      <main id="main-content" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
