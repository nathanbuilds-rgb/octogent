import { type ReactNode, useEffect, useRef, useState } from "react";

import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { Terminal } from "../Terminal";

export type ShellTab = { terminalId: string; label: string };

export type ShellTerminalPanelProps = {
  tabs: ShellTab[];
  activeTabId: string | null;
  collapsed: boolean;
  onActivate: (terminalId: string) => void;
  onNewTab: () => void;
  onCloseTab: (terminalId: string) => void;
  onToggleCollapsed: () => void;
  onRenameTab?: ((terminalId: string, label: string) => void) | undefined;
  renderBody?: ((terminalId: string) => ReactNode) | undefined;
};

export const ShellTerminalPanel = ({
  tabs,
  activeTabId,
  collapsed,
  onActivate,
  onNewTab,
  onCloseTab,
  onToggleCollapsed,
  onRenameTab,
  renderBody,
}: ShellTerminalPanelProps) => {
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editingTabId) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editingTabId]);

  const beginRename = (tab: ShellTab) => {
    if (!onRenameTab) {
      return;
    }
    setEditingTabId(tab.terminalId);
    setDraft(tab.label);
  };

  const commitRename = (terminalId: string) => {
    const trimmed = draft.trim();
    if (trimmed.length > 0) {
      onRenameTab?.(terminalId, trimmed);
    }
    setEditingTabId(null);
  };

  const cancelRename = () => {
    setEditingTabId(null);
  };

  const activeTab = tabs.find((tab) => tab.terminalId === activeTabId) ?? null;
  const renderBodyContent = (tab: ShellTab): ReactNode =>
    renderBody ? renderBody(tab.terminalId) : defaultRenderBody(tab);

  return (
    <div className="shell-terminal-panel" data-collapsed={collapsed ? "true" : "false"}>
      <div className="shell-terminal-tabstrip" role="tablist" aria-label="Shell terminals">
        {tabs.map((tab) => {
          const isActive = tab.terminalId === activeTabId;
          const isEditing = tab.terminalId === editingTabId;
          return (
            <div
              key={tab.terminalId}
              className="shell-terminal-tab"
              data-active={isActive ? "true" : "false"}
            >
              {isEditing ? (
                <input
                  ref={inputRef}
                  className="shell-terminal-tab-input"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={() => commitRename(tab.terminalId)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitRename(tab.terminalId);
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      cancelRename();
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className="shell-terminal-tab-label"
                  onClick={() => onActivate(tab.terminalId)}
                  onDoubleClick={() => beginRename(tab)}
                >
                  {tab.label}
                </button>
              )}
              <button
                type="button"
                className="shell-terminal-tab-close"
                aria-label={`Close ${tab.label}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseTab(tab.terminalId);
                }}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
        <div className="shell-terminal-tabstrip-spacer" />
        <button
          type="button"
          className="shell-terminal-new"
          aria-label="New terminal"
          onClick={onNewTab}
        >
          <Plus size={14} />
        </button>
        <button
          type="button"
          className="shell-terminal-collapse"
          aria-label={collapsed ? "Expand terminal panel" : "Collapse terminal panel"}
          onClick={onToggleCollapsed}
        >
          {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>
      {!collapsed && activeTab && (
        <div className="shell-terminal-body">{renderBodyContent(activeTab)}</div>
      )}
    </div>
  );
};

const defaultRenderBody = (tab: ShellTab) => (
  <Terminal terminalId={tab.terminalId} terminalLabel={tab.label} isSelected hidePromptPicker />
);
