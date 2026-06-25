import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type ShellTab, ShellTerminalPanel } from "../src/components/canvas/ShellTerminalPanel";

const tabs: ShellTab[] = [
  { terminalId: "term-1", label: "shell-one" },
  { terminalId: "term-2", label: "shell-two" },
];

const baseProps = {
  tabs,
  activeTabId: "term-1",
  collapsed: false,
  onActivate: vi.fn(),
  onNewTab: vi.fn(),
  onCloseTab: vi.fn(),
  onToggleCollapsed: vi.fn(),
  renderBody: (terminalId: string) => <div>body:{terminalId}</div>,
};

describe("ShellTerminalPanel", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders one tab per entry showing its label", () => {
    render(<ShellTerminalPanel {...baseProps} />);

    expect(screen.getByText("shell-one")).toBeInTheDocument();
    expect(screen.getByText("shell-two")).toBeInTheDocument();
  });

  it("calls onActivate when a tab is clicked", () => {
    const onActivate = vi.fn();
    render(<ShellTerminalPanel {...baseProps} onActivate={onActivate} />);

    fireEvent.click(screen.getByText("shell-two"));

    expect(onActivate).toHaveBeenCalledWith("term-2");
  });

  it("calls onNewTab when the new-terminal control is clicked", () => {
    const onNewTab = vi.fn();
    render(<ShellTerminalPanel {...baseProps} onNewTab={onNewTab} />);

    fireEvent.click(screen.getByLabelText("New terminal"));

    expect(onNewTab).toHaveBeenCalledTimes(1);
  });

  it("closes a tab without activating it", () => {
    const onActivate = vi.fn();
    const onCloseTab = vi.fn();
    render(<ShellTerminalPanel {...baseProps} onActivate={onActivate} onCloseTab={onCloseTab} />);

    fireEvent.click(screen.getByLabelText("Close shell-two"));

    expect(onCloseTab).toHaveBeenCalledWith("term-2");
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("toggles the collapsed state", () => {
    const onToggleCollapsed = vi.fn();
    const { rerender } = render(
      <ShellTerminalPanel {...baseProps} onToggleCollapsed={onToggleCollapsed} />,
    );

    fireEvent.click(screen.getByLabelText("Collapse terminal panel"));
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);

    rerender(<ShellTerminalPanel {...baseProps} collapsed onToggleCollapsed={onToggleCollapsed} />);
    expect(screen.getByLabelText("Expand terminal panel")).toBeInTheDocument();
  });

  it("renders the body for the active tab when expanded", () => {
    render(
      <ShellTerminalPanel
        {...baseProps}
        renderBody={(terminalId) => <div>body:{terminalId}</div>}
      />,
    );

    expect(screen.getByText("body:term-1")).toBeInTheDocument();
  });

  it("does not render the body when collapsed", () => {
    render(
      <ShellTerminalPanel
        {...baseProps}
        collapsed
        renderBody={(terminalId) => <div>body:{terminalId}</div>}
      />,
    );

    expect(screen.queryByText("body:term-1")).not.toBeInTheDocument();
    expect(screen.getByText("shell-one")).toBeInTheDocument();
  });

  it("renames a tab via double-click and Enter", () => {
    const onRenameTab = vi.fn();
    render(<ShellTerminalPanel {...baseProps} onRenameTab={onRenameTab} />);

    fireEvent.doubleClick(screen.getByText("shell-one"));
    const input = screen.getByDisplayValue("shell-one");
    fireEvent.change(input, { target: { value: "renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onRenameTab).toHaveBeenCalledWith("term-1", "renamed");
  });

  it("cancels a rename on Escape without committing", () => {
    const onRenameTab = vi.fn();
    render(<ShellTerminalPanel {...baseProps} onRenameTab={onRenameTab} />);

    fireEvent.doubleClick(screen.getByText("shell-one"));
    const input = screen.getByDisplayValue("shell-one");
    fireEvent.change(input, { target: { value: "renamed" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onRenameTab).not.toHaveBeenCalled();
    expect(screen.getByText("shell-one")).toBeInTheDocument();
  });
});
