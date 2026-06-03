import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TodoChecklistEditor } from "../src/components/deck/TodoChecklistEditor";

describe("TodoChecklistEditor", () => {
  it("renders each todo as an editable input", () => {
    render(<TodoChecklistEditor items={["first", "second"]} onChange={() => {}} />);
    expect(screen.getByDisplayValue("first")).toBeInTheDocument();
    expect(screen.getByDisplayValue("second")).toBeInTheDocument();
  });

  it("adds an empty item when Add is clicked", () => {
    const onChange = vi.fn();
    render(<TodoChecklistEditor items={["first"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /add (item|todo)/i }));
    expect(onChange).toHaveBeenCalledWith(["first", ""]);
  });

  it("edits an item in place", () => {
    const onChange = vi.fn();
    render(<TodoChecklistEditor items={["first", "second"]} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue("second"), { target: { value: "second!" } });
    expect(onChange).toHaveBeenCalledWith(["first", "second!"]);
  });

  it("removes an item", () => {
    const onChange = vi.fn();
    render(<TodoChecklistEditor items={["first", "second"]} onChange={onChange} />);
    const removeButtons = screen.getAllByRole("button", { name: /remove/i });
    fireEvent.click(removeButtons[0] as HTMLElement);
    expect(onChange).toHaveBeenCalledWith(["second"]);
  });
});
