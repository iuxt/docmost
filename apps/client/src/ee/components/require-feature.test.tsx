import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, act } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { capabilitiesAtom } from "@/features/workspace/capabilities/capabilities-atom";
import { RequireFeature } from "./require-feature";
import { Feature } from "@/ee/features";

vi.mock("@/components/ui/error-404", () => ({
  Error404: () => <div>Page not found</div>,
}));
afterEach(cleanup);

describe("feature routes", () => {
  it("never mounts an unavailable feature, including while capabilities load", () => {
    const store = createStore();
    const mount = vi.fn(() => <div>AI settings</div>);
    const FeaturePage = mount;
    render(
      <Provider store={store}>
        <RequireFeature feature={Feature.AI}>
          <FeaturePage />
        </RequireFeature>
      </Provider>,
    );
    expect(mount).not.toHaveBeenCalled();
    act(() => store.set(capabilitiesAtom, { features: [] }));
    expect(screen.getByText("Page not found")).toBeTruthy();
    expect(mount).not.toHaveBeenCalled();
  });

  it("keeps supported features accessible and removes them when capability changes", () => {
    const store = createStore();
    store.set(capabilitiesAtom, { features: [Feature.SECURITY_SETTINGS] });
    render(
      <Provider store={store}>
        <RequireFeature feature={Feature.SECURITY_SETTINGS}>
          <div>Security settings</div>
        </RequireFeature>
      </Provider>,
    );
    expect(screen.getByText("Security settings")).toBeTruthy();
    act(() => store.set(capabilitiesAtom, { features: [] }));
    expect(screen.queryByText("Security settings")).toBeNull();
    expect(screen.getByText("Page not found")).toBeTruthy();
  });
});
