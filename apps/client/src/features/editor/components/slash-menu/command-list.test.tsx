import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { createStore, Provider } from "jotai";
import { capabilitiesAtom } from "@/features/workspace/capabilities/capabilities-atom";
import { Feature } from "@/ee/features";
import CommandList from "./command-list";
import { SlashMenuGroupedItemsType } from "./types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
const Icon = () => <svg />;
const items: SlashMenuGroupedItemsType = {
  Basic: [
    {
      title: "Paragraph",
      description: "Write text",
      icon: Icon,
      command: vi.fn(),
      searchTerms: [],
    },
  ],
  Bases: [
    {
      title: "Kanban",
      description: "Create a board",
      icon: Icon,
      command: vi.fn(),
      searchTerms: [],
      requiresBases: true,
    },
  ],
};

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
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

function renderCommands(features: string[]) {
  const store = createStore();
  store.set(capabilitiesAtom, { features });
  const command = vi.fn();
  render(
    <Provider store={store}>
      <MantineProvider env="test">
        <CommandList
          items={items}
          command={command}
          editor={null}
          range={null}
        />
      </MantineProvider>
    </Provider>,
  );
  return command;
}

describe("slash commands", () => {
  it("removes unavailable commands and categories from keyboard navigation", () => {
    const command = renderCommands([]);
    expect(screen.queryByText("Kanban")).toBeNull();
    expect(screen.queryByRole("group", { name: "Bases" })).toBeNull();
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(document, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "Enter" });
    expect(command).toHaveBeenCalledWith(items.Basic[0]);
  });

  it("shows and executes commands when the server supports them", () => {
    const command = renderCommands([Feature.BASES]);
    fireEvent.click(screen.getByRole("option", { name: /Kanban/ }));
    expect(command).toHaveBeenCalledWith(items.Bases[0]);
  });
});
