import { MantineProvider } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  currentUserAtom,
  workspaceAtom,
} from "@/features/user/atoms/current-user-atom.ts";
import {
  getTypesenseSettings,
  saveTypesenseSettings,
  testTypesenseSettings,
  updateWorkspace,
} from "@/features/workspace/services/workspace-service.ts";
import { IWorkspace } from "@/features/workspace/types/workspace.types.ts";
import WorkspaceSearchSettings from "./workspace-search-settings";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (value: string) => value }),
}));
vi.mock("@/features/workspace/services/workspace-service.ts", () => ({
  updateWorkspace: vi.fn(),
  getTypesenseSettings: vi.fn(),
  saveTypesenseSettings: vi.fn(),
  testTypesenseSettings: vi.fn(),
}));
vi.mock("@mantine/notifications", () => ({
  notifications: { show: vi.fn() },
}));

function setup(overrides: Partial<IWorkspace> = {}) {
  const workspace = {
    id: "workspace-1",
    settings: {},
    searchDriver: "database",
    typesenseConfigured: true,
    ...overrides,
  } as IWorkspace;
  const store = createStore();
  store.set(currentUserAtom, { user: { id: "user-1" }, workspace } as any);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <MantineProvider>
          <WorkspaceSearchSettings />
        </MantineProvider>
      </QueryClientProvider>
    </Provider>,
  );
  return {
    store,
    workspace,
    queryClient,
    toggle: screen.getByRole("switch", {
      name: "Use Typesense search",
    }) as HTMLInputElement,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getTypesenseSettings).mockResolvedValue({
    locale: "zh",
    configured: true,
  });
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});
afterEach(cleanup);

describe("Workspace search settings", () => {
  it("shows the inherited effective driver", () => {
    const { toggle } = setup({ searchDriver: "typesense" });
    expect(toggle.checked).toBe(true);
  });

  it("prevents enabling Typesense when the server is not configured", () => {
    const { toggle } = setup({ typesenseConfigured: false });
    expect(toggle.disabled).toBe(true);
    expect(
      screen.getByText(
        "Typesense is not configured on this server. Contact your administrator.",
      ),
    ).toBeTruthy();
    expect(updateWorkspace).not.toHaveBeenCalled();
  });

  it("saves enabling and refreshes workspace and search state", async () => {
    const { toggle, store, workspace, queryClient } = setup();
    const updated = { ...workspace, searchDriver: "typesense" as const };
    vi.mocked(updateWorkspace).mockResolvedValue(updated);
    queryClient.setQueryData(
      ["unified-search", "page", { query: "hello" }],
      [],
    );
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.checked).toBe(true));
    expect(updateWorkspace).toHaveBeenCalledWith({ searchDriver: "typesense" });
    expect(store.get(workspaceAtom)).toEqual(updated);
    expect(queryClient.getQueryData(["workspace"])).toEqual(updated);
    expect(
      queryClient.getQueryState(["unified-search", "page", { query: "hello" }])
        ?.isInvalidated,
    ).toBe(true);
  });

  it("allows disabling when Typesense configuration has been removed", async () => {
    const { toggle, workspace } = setup({
      searchDriver: "typesense",
      typesenseConfigured: false,
    });
    expect(toggle.disabled).toBe(false);
    vi.mocked(updateWorkspace).mockResolvedValue({
      ...workspace,
      searchDriver: "database",
    });
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.checked).toBe(false));
    expect(updateWorkspace).toHaveBeenCalledWith({ searchDriver: "database" });
  });

  it("keeps the saved setting on request failure and permits retry", async () => {
    const { toggle, store } = setup();
    vi.mocked(updateWorkspace).mockRejectedValue(new Error("Unavailable"));
    fireEvent.click(toggle);
    expect(toggle.disabled).toBe(true);
    await waitFor(() => expect(notifications.show).toHaveBeenCalled());
    expect(toggle.checked).toBe(false);
    expect(toggle.disabled).toBe(false);
    expect(store.get(workspaceAtom)?.searchDriver).toBe("database");
  });
});

describe("Typesense language and server connection", () => {
  it("shows no address or API key inputs", async () => {
    setup();
    await screen.findByLabelText("Typesense language");
    expect(screen.queryByLabelText("Typesense URL")).toBeNull();
    expect(screen.queryByLabelText("Typesense API key")).toBeNull();
  });

  it("saves only the workspace language and refreshes search", async () => {
    const { store, queryClient } = setup();
    const input = screen.getByLabelText(
      "Typesense language",
    ) as HTMLInputElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.change(input, { target: { value: " EN " } });
    vi.mocked(saveTypesenseSettings).mockResolvedValue({
      locale: "en",
      configured: true,
    });
    queryClient.setQueryData(["page-search", "hello"], []);
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() =>
      expect(saveTypesenseSettings).toHaveBeenCalledWith({ locale: "en" }),
    );
    await waitFor(() => expect(input.value).toBe("en"));
    expect(store.get(workspaceAtom)?.typesenseConfigured).toBe(true);
    expect(
      queryClient.getQueryState(["page-search", "hello"])?.isInvalidated,
    ).toBe(true);
    expect(updateWorkspace).not.toHaveBeenCalled();
  });

  it("tests the server connection without submitting credentials or saving", async () => {
    setup();
    const button = screen.getByRole("button", {
      name: "Test connection",
    }) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    vi.mocked(testTypesenseSettings).mockResolvedValue({ success: true });
    fireEvent.click(button);
    await waitFor(() =>
      expect(testTypesenseSettings).toHaveBeenCalledWith({ locale: "zh" }),
    );
    expect(saveTypesenseSettings).not.toHaveBeenCalled();
  });

  it("disables language, save, test and enablement when server credentials are missing", async () => {
    vi.mocked(getTypesenseSettings).mockResolvedValue({
      locale: "en",
      configured: false,
    });
    const { toggle } = setup();
    const input = screen.getByLabelText(
      "Typesense language",
    ) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe("en"));
    expect(input.disabled).toBe(true);
    expect(toggle.disabled).toBe(true);
    for (const name of ["Test connection", "Save settings"]) {
      expect(
        (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
      ).toBe(true);
    }
  });

  it("preserves the edited language when saving fails", async () => {
    setup();
    const input = screen.getByLabelText(
      "Typesense language",
    ) as HTMLInputElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.change(input, { target: { value: "en" } });
    vi.mocked(saveTypesenseSettings).mockRejectedValue(
      new Error("Unavailable"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(notifications.show).toHaveBeenCalled());
    expect(input.value).toBe("en");
  });
});
