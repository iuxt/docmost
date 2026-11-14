import { MantineProvider } from "@mantine/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchSpotlight } from "./search-spotlight";
import { searchSpotlight } from "../constants";
import { useUnifiedSearch } from "../hooks/use-unified-search";

const ai = vi.hoisted(() => ({ reset: vi.fn(), clearStreaming: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../hooks/use-unified-search", () => ({ useUnifiedSearch: vi.fn() }));
vi.mock("./search-spotlight-filters", () => ({
  SearchSpotlightFilters: () => null,
}));
vi.mock("./search-result-item", () => ({ SearchResultItem: () => null }));
vi.mock("@/ee/hooks/use-feature", () => ({ useHasFeature: () => false }));
vi.mock("@/ee/ai/hooks/use-ai-search", () => ({ useAiSearch: () => ai }));
vi.mock("@/ee/ai/components/ai-search-result", () => ({
  AiSearchResult: () => null,
}));
vi.mock("@/ee/ai/services/ai-search-service", () => ({
  hintVectorCache: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn(() => ({
      matches: false,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
    })),
  });
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  act(() => searchSpotlight.close());
  cleanup();
});

async function open() {
  render(
    <MantineProvider>
      <SearchSpotlight />
    </MantineProvider>,
  );
  act(() => searchSpotlight.open());
  const input = await screen.findByRole("textbox", { name: "Search" });
  fireEvent.change(input, { target: { value: "handbook" } });
  return input;
}

describe("Search failure feedback", () => {
  it("explains an offline pause rather than showing an empty result", async () => {
    vi.mocked(useUnifiedSearch).mockReturnValue({
      isError: false,
      isPaused: true,
      isFetching: false,
      refetch: vi.fn(),
    } as any);
    await open();
    expect(screen.getByRole("alert").textContent).toContain(
      "You are offline. Check your connection and try again.",
    );
    expect(screen.queryByText("No results found...")).toBeNull();
  });
  it("shows a retryable error instead of claiming that the request found no matches", async () => {
    const refetch = vi.fn();
    vi.mocked(useUnifiedSearch).mockReturnValue({
      isError: true,
      error: new Error("offline"),
      isFetching: false,
      refetch,
    } as any);
    const input = await open();
    expect(input.getAttribute("maxlength")).toBe("200");
    expect(screen.getByRole("alert").textContent).toContain(
      "Search failed. Please try again.",
    );
    expect(screen.queryByText("No results found...")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("still shows the empty result state after a successful search", async () => {
    vi.mocked(useUnifiedSearch).mockReturnValue({
      data: [],
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    } as any);
    await open();
    await waitFor(() =>
      expect(screen.getByText("No results found...")).toBeTruthy(),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
