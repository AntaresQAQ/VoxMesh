// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "../../api.js";
import { unknownReadiness } from "../../test/readiness.js";
import { renderWithProviders } from "../../test/render.js";
import {
  AppearanceSettingsCard,
  LanguageSettingsCard
} from "./PreferenceCards.js";
import { SettingsPage } from "./SettingsPage.js";

vi.mock("@tanstack/react-router", () => ({
  Link: (props: {
    children: ReactNode;
    search: { section: string };
    className?: string;
  }) => (
    <a
      href={`/settings?section=${props.search.section}`}
      className={props.className}
    >
      {props.children}
    </a>
  )
}));

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(apiClient, "runtimeRouting").mockResolvedValue({
    connections: [],
    models: [],
    routes: [
      {
        id: "system-route-composed",
        displayName: "Default Composed Voice",
        mode: "composed",
        sttModelDeploymentId: null,
        chatModelDeploymentId: null,
        ttsModelDeploymentId: null,
        nativeModelDeploymentId: null,
        fallbackRouteId: null,
        sttStreamingEnabled: false,
        ttsStreamingEnabled: false,
        enabled: true,
        readiness: unknownReadiness
      }
    ],
    activeRouteId: "system-route-composed"
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("settings components", () => {
  it("renders language and appearance preference cards", () => {
    renderWithProviders(
      <>
        <LanguageSettingsCard />
        <AppearanceSettingsCard />
      </>
    );

    expect(
      screen.getByRole("heading", { name: "Display language" })
    ).toBeVisible();
    expect(screen.getByLabelText("Language")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Appearance" })).toBeVisible();
    expect(screen.getByLabelText("Theme")).toBeVisible();
  });

  it("composes General, AI Providers, and Security sections", async () => {
    const view = renderWithProviders(
      <SettingsPage section="general" onSessionEnded={vi.fn()} />
    );
    expect(
      await screen.findByRole("heading", { name: "Settings" })
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "AI Providers" })).toHaveAttribute(
      "href",
      "/settings?section=providers"
    );
    expect(
      screen.getByRole("heading", { name: "Display language" })
    ).toBeVisible();

    view.unmount();
    const providerView = renderWithProviders(
      <SettingsPage section="providers" onSessionEnded={vi.fn()} />
    );
    expect(
      await screen.findByRole("heading", { name: "Runtime routing" })
    ).toBeVisible();

    providerView.unmount();
    renderWithProviders(
      <SettingsPage section="security" onSessionEnded={vi.fn()} />
    );
    expect(
      screen.getByRole("heading", { name: "Administrator password" })
    ).toBeVisible();
  });
});
