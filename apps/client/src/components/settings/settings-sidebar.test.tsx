import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import { createStore, Provider } from "jotai";
import { capabilitiesAtom } from "@/features/workspace/capabilities/capabilities-atom";
import { Feature } from "@/ee/features";
import SettingsSidebar from "./settings-sidebar";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/config.ts", () => ({ isCloud: () => false }));
vi.mock("@/hooks/use-user-role.tsx", () => ({
  default: () => ({ isAdmin: true, isOwner: true }),
}));
vi.mock("./app-version.tsx", () => ({ default: () => null }));
vi.mock("./settings-queries.tsx", () => ({
  prefetchApiKeyManagement: vi.fn(),
  prefetchApiKeys: vi.fn(),
  prefetchBilling: vi.fn(),
  prefetchGroups: vi.fn(),
  prefetchScimTokens: vi.fn(),
  prefetchShares: vi.fn(),
  prefetchSpaces: vi.fn(),
  prefetchSsoProviders: vi.fn(),
  prefetchWorkspaceMembers: vi.fn(),
  prefetchAuditLogs: vi.fn(),
  prefetchVerifiedPages: vi.fn(),
}));
vi.mock("@/features/integration/queries/integration-query", () => ({
  useInstalledIntegrations: () => ({ data: [] }),
}));

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderSidebar(features: string[]) {
  const store = createStore();
  store.set(capabilitiesAtom, { features });
  render(
    <Provider store={store}>
      <MantineProvider env="test">
        <MemoryRouter>
          <SettingsSidebar />
        </MemoryRouter>
      </MantineProvider>
    </Provider>,
  );
}

describe("settings navigation", () => {
  it("removes every unsupported feature while keeping implemented settings", () => {
    renderSidebar([
      Feature.SECURITY_SETTINGS,
      Feature.RETENTION,
      Feature.SHARING_CONTROLS,
      Feature.VIEWER_COMMENTS,
      Feature.PUBLIC_SPACE_APPEARANCE,
    ]);
    for (const label of [
      "API keys",
      "API management",
      "AI settings",
      "Integrations",
      "Audit logs & SIEM",
      "Announcements",
      "Verified pages",
      "Connections",
      "Security & SSO",
    ]) {
      expect(screen.queryByText(label)).toBeNull();
    }
    expect(
      screen.getByRole("link", { name: "Security" }).getAttribute("href"),
    ).toBe("/settings/security");
    expect(screen.getByRole("link", { name: "Public sharing" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Profile" })).toBeTruthy();
  });

  it("keeps the link when its capability is available", () => {
    renderSidebar([Feature.AI]);
    expect(
      screen.getByRole("link", { name: "AI settings" }).getAttribute("href"),
    ).toBe("/settings/ai");
  });
});
