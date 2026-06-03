import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DeckPrimaryView } from "../src/components/DeckPrimaryView";

const installFetchStub = () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => [] }) as unknown as Response),
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
});
