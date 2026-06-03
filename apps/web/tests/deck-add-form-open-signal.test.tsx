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
  pendingAddTentacle: false,
  onPendingAddTentacleConsumed: () => {},
} as unknown as React.ComponentProps<typeof DeckPrimaryView>;

describe("DeckPrimaryView pending-add-tentacle intent", () => {
  beforeEach(installFetchStub);
  afterEach(() => vi.unstubAllGlobals());

  it("opens the wizard and acks when pendingAddTentacle becomes true", async () => {
    const onPendingAddTentacleConsumed = vi.fn();
    const { rerender } = render(<DeckPrimaryView {...baseProps} pendingAddTentacle={false} />);
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    rerender(
      <DeckPrimaryView
        {...baseProps}
        pendingAddTentacle={true}
        onPendingAddTentacleConsumed={onPendingAddTentacleConsumed}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeInTheDocument());
    // The intent is consumed exactly once so it can be reset by the parent.
    expect(onPendingAddTentacleConsumed).toHaveBeenCalledTimes(1);
  });

  it("opens the wizard even when tentacles already exist (populated overlay)", async () => {
    vi.unstubAllGlobals();
    installPopulatedFetchStub();
    const { rerender } = render(<DeckPrimaryView {...baseProps} pendingAddTentacle={false} />);
    await waitFor(() => expect(screen.getByText("Existing")).toBeInTheDocument());
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    rerender(<DeckPrimaryView {...baseProps} pendingAddTentacle={true} />);
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeInTheDocument());
  });

  it("does NOT auto-open on a fresh mount when the intent is already false (remount safety)", async () => {
    // Simulates returning to the deck tab (DeckPrimaryView remounts) after the
    // intent was already consumed+reset by the parent. The wizard must stay closed.
    render(<DeckPrimaryView {...baseProps} pendingAddTentacle={false} />);
    // Give mount effects a tick; the wizard must never appear.
    await waitFor(() => expect(screen.queryByLabelText("Name")).not.toBeInTheDocument());
  });
});
