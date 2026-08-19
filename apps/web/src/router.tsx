import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
  useNavigate,
  useRouter,
  useRouterState
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";

import { apiClient } from "./api.js";
import { CenteredCard } from "./components/layout/CenteredCard.js";
import { Console } from "./Console.js";
import { PasswordScreen } from "./features/auth/PasswordScreen.js";
import { ChatPage } from "./features/chat/ChatPage.js";
import { ConversationDetailPage } from "./features/conversations/ConversationDetailPage.js";
import { ConversationsPage } from "./features/conversations/ConversationsPage.js";
import { DashboardPage } from "./features/dashboard/DashboardPage.js";
import { LogsPage } from "./features/logs/LogsPage.js";
import { SettingsPage } from "./features/settings/SettingsPage.js";
import type { SettingsSection } from "./features/settings/SettingsSectionNav.js";
import { useI18n } from "./i18n/i18n.js";
import { queryKeys, sessionQueryOptions, setupQueryOptions } from "./query.js";

interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFoundPage
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: async ({ context }) => {
    const setup = await context.queryClient.fetchQuery(setupQueryOptions());
    if (setup.setupRequired) {
      throw redirect({ to: "/setup" });
    }
    let authenticated = false;
    try {
      await context.queryClient.fetchQuery(sessionQueryOptions());
      authenticated = true;
    } catch {
      authenticated = false;
    }
    if (authenticated) {
      throw redirect({ to: "/dashboard" });
    }
    throw redirect({ to: "/login", search: { redirect: null } });
  }
});

const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/setup",
  beforeLoad: async ({ context }) => {
    const setup = await context.queryClient.fetchQuery(setupQueryOptions());
    if (!setup.setupRequired) {
      throw redirect({ to: "/login", search: { redirect: null } });
    }
  },
  component: SetupRoute
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: (search: Record<string, unknown>) => ({
    redirect:
      typeof search.redirect === "string" ? safeReturnTo(search.redirect) : null
  }),
  beforeLoad: async ({ context }) => {
    const setup = await context.queryClient.fetchQuery(setupQueryOptions());
    if (setup.setupRequired) {
      throw redirect({ to: "/setup" });
    }
    let authenticated = false;
    try {
      await context.queryClient.fetchQuery(sessionQueryOptions());
      authenticated = true;
    } catch {
      authenticated = false;
    }
    if (authenticated) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: LoginRoute
});

const authenticatedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "_authenticated",
  beforeLoad: async ({ context, location }) => {
    const setup = await context.queryClient.fetchQuery(setupQueryOptions());
    if (setup.setupRequired) {
      throw redirect({ to: "/setup" });
    }
    try {
      await context.queryClient.fetchQuery(sessionQueryOptions());
    } catch {
      throw redirect({
        to: "/login",
        search: { redirect: safeReturnTo(location.href) }
      });
    }
  },
  component: Console
});

const dashboardRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/dashboard",
  component: DashboardPage
});
const chatRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/chat",
  component: ChatPage
});
const conversationsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/conversations",
  component: ConversationsPage
});
const conversationDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/conversations/$conversationId",
  component: ConversationDetailPage
});
const logsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/logs",
  component: LogsPage
});
const settingsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/settings",
  validateSearch: (search: Record<string, unknown>) => ({
    section: settingsSection(search.section)
  }),
  component: SettingsRoute
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  setupRoute,
  loginRoute,
  authenticatedRoute.addChildren([
    dashboardRoute,
    chatRoute,
    conversationsRoute,
    conversationDetailRoute,
    logsRoute,
    settingsRoute
  ])
]);

export function createAppRouter(context: RouterContext) {
  return createRouter({
    routeTree,
    context,
    defaultPreload: "intent"
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}

function SetupRoute() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { queryClient } = rootRoute.useRouteContext();
  const setup = useMutation({
    mutationFn: apiClient.setup,
    onSuccess: async () => {
      queryClient.setQueryData(queryKeys.setup, { setupRequired: false });
      await navigate({
        to: "/login",
        search: { redirect: null },
        replace: true
      });
    }
  });
  return (
    <PasswordScreen
      title={t("auth.setupTitle")}
      description={t("auth.setupDescription")}
      submitLabel={t("auth.completeSetup")}
      onSubmit={(password) => setup.mutateAsync(password).then(() => undefined)}
    />
  );
}

function LoginRoute() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const router = useRouter();
  const search = loginRoute.useSearch();
  const { queryClient } = rootRoute.useRouteContext();
  const login = useMutation({
    mutationFn: apiClient.login,
    onSuccess: async (session) => {
      queryClient.setQueryData(queryKeys.session, session);
      if (search.redirect) {
        router.history.replace(search.redirect);
      } else {
        await navigate({ to: "/dashboard", replace: true });
      }
    }
  });
  return (
    <PasswordScreen
      title={t("auth.loginTitle")}
      description={t("auth.loginDescription")}
      submitLabel={t("auth.signIn")}
      onSubmit={(password) => login.mutateAsync(password).then(() => undefined)}
    />
  );
}

function SettingsRoute() {
  const navigate = useNavigate();
  const { section } = settingsRoute.useSearch();
  return (
    <SettingsPage
      section={section}
      onSessionEnded={() => {
        void navigate({
          to: "/login",
          search: { redirect: null },
          replace: true
        });
      }}
    />
  );
}

function NotFoundPage() {
  const { t } = useI18n();
  const pathname = useRouterState({
    select: (state) => state.location.pathname
  });
  return (
    <CenteredCard title={t("common.productName")}>
      <p className="error" role="alert">
        {t("common.routeNotFound", { path: pathname })}
      </p>
    </CenteredCard>
  );
}

function RootLayout() {
  const { t } = useI18n();
  const pathname = useRouterState({
    select: (state) => state.location.pathname
  });
  const title = routeTitle(pathname, t);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>("[data-route-heading]")
        ?.focus({ preventScroll: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  return (
    <>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {title}
      </div>
      <Outlet />
    </>
  );
}

function safeReturnTo(value: string): string {
  return value.startsWith("/") &&
    !value.startsWith("//") &&
    value !== "/login" &&
    value !== "/setup"
    ? value
    : "/dashboard";
}

function settingsSection(value: unknown): SettingsSection {
  return value === "providers" || value === "security" ? value : "general";
}

function routeTitle(pathname: string, t: ReturnType<typeof useI18n>["t"]) {
  if (pathname === "/setup") return t("auth.setupTitle");
  if (pathname === "/login") return t("auth.loginTitle");
  if (pathname === "/dashboard") return t("nav.dashboard");
  if (pathname === "/chat") return t("nav.chat");
  if (pathname.startsWith("/conversations")) return t("nav.conversations");
  if (pathname === "/logs") return t("nav.logs");
  if (pathname === "/settings") return t("nav.settings");
  return t("common.routeNotFound", { path: pathname });
}
