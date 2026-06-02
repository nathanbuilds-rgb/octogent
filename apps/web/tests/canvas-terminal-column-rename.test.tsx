import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CanvasTerminalColumn } from "../src/components/canvas/CanvasTerminalColumn";

const baseNode = {
  sessionId: "terminal-1",
  tentacleId: "auth",
  color: "#abc",
  label: "auth",
} as never;
const terminals = [
  { terminalId: "terminal-1", tentacleName: "Old Name", workspaceMode: "shared" },
] as never;

const baseProps = {
  node: baseNode,
  terminals,
  onMinimize: vi.fn(),
  onClose: vi.fn(),
  isEditingName: false,
  nameDraft: "",
  onBeginNameEdit: vi.fn(),
  onNameDraftChange: vi.fn(),
  onSubmitNameEdit: vi.fn(),
  onCancelNameEdit: vi.fn(),
};

describe("CanvasTerminalColumn rename", () => {
  it("enters edit mode on double-click of the title", () => {
    const onBeginNameEdit = vi.fn();
    render(<CanvasTerminalColumn {...baseProps} onBeginNameEdit={onBeginNameEdit} />);
    fireEvent.doubleClick(screen.getByText("Old Name"));
    expect(onBeginNameEdit).toHaveBeenCalledWith("terminal-1", "Old Name");
  });

  it("submits on Enter and cancels on Escape", () => {
    const onSubmitNameEdit = vi.fn();
    const onCancelNameEdit = vi.fn();
    render(
      <CanvasTerminalColumn
        {...baseProps}
        isEditingName
        nameDraft="New Name"
        onSubmitNameEdit={onSubmitNameEdit}
        onCancelNameEdit={onCancelNameEdit}
      />,
    );
    const input = screen.getByRole("textbox");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmitNameEdit).toHaveBeenCalledWith("terminal-1", "Old Name");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCancelNameEdit).toHaveBeenCalled();
  });
});
