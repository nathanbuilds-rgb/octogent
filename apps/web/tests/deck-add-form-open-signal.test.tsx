import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DeckPrimaryView } from "../src/components/DeckPrimaryView";

const installFetchStub = () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => [] }) as unknown as Response),
  );
};

// A fetch stub where the tentacles list is non-empty (skills stays empty), so the
// component renders its populated branch rather than the empty state.
const EXISTING_TENTACLE = {
  tentacleId: "t1",
  displayName: "Existing",
  description: "",
  status: "idle",
  color: null,
  octopus: { animation: null, expression: null, accessory: null, hairColor: null },
  scope: { paths: [], tags: [] },
  vaultFiles: [],
  todoTotal: 0,
  todoDone: 0,
  todoItems: [],
  suggestedSkills: [],
};

const installPopulatedFetchStub = () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      const body = url.includes("/skills") ? [] : [EXISTING_TENTACLE];
      return { ok: true, json: async () => body } as unknown as Response;
    }),
  );
};

const baseProps = {
  workspaceSetup: null,
  isWorkspaceSetupLoading: false,
  workspaceSetupError: null,
  onRefreshWorkspaceSetup: async () => null,
  onRunWorkspaceSetupStep: async () => null,
  openAddFormSignal: 0,
} as unknown as React.ComponentProps<typeof DeckPrimaryView>;

describe("DeckPrimaryView open-add-form signal", () => {
  beforeEach(installFetchStub);
  afterEach(() => vi.unstubAllGlobals());

  it("opens the wizard when openAddFormSignal increments", async () => {
    const { rerender } = render(<DeckPrimaryView {...baseProps} openAddFormSignal={0} />);
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    rerender(<DeckPrimaryView {...baseProps} openAddFormSignal={1} />);
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeInTheDocument());
  });

  it("opens the wizard on signal even when tentacles already exist", async () => {
    vi.unstubAllGlobals();
    installPopulatedFetchStub();
    const { rerender } = render(<DeckPrimaryView {...baseProps} openAddFormSignal={0} />);
    // Wait for the populated branch (the existing tentacle) to render.
    await waitFor(() => expect(screen.getByText("Existing")).toBeInTheDocument());
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    rerender(<DeckPrimaryView {...baseProps} openAddFormSignal={1} />);
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeInTheDocument());
  });
});
