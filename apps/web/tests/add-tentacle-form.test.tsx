import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AddTentacleForm } from "../src/components/deck/AddTentacleForm";

const SKILLS = [
  {
    name: "docs-writer",
    description: "Keeps docs aligned with the product.",
    source: "project" as const,
  },
  {
    name: "release-helper",
    description: "Helps with release coordination.",
    source: "user" as const,
  },
];

const renderForm = (overrides: Partial<React.ComponentProps<typeof AddTentacleForm>> = {}) =>
  render(
    <AddTentacleForm
      onSubmit={overrides.onSubmit ?? (() => {})}
      onCancel={overrides.onCancel ?? (() => {})}
      onGenerateTodos={overrides.onGenerateTodos ?? (async () => [])}
      isSubmitting={overrides.isSubmitting ?? false}
      error={overrides.error ?? null}
      availableSkills={overrides.availableSkills ?? SKILLS}
    />,
  );

const goToToolsStep = (name = "docs") => {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: /next/i })); // -> Todos
  fireEvent.click(screen.getByRole("button", { name: /next/i })); // -> Tools
};

describe("AddTentacleForm wizard", () => {
  it("does not advance past Details without a name", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /generate/i })).not.toBeInTheDocument();
  });

  it("treats Enter (implicit submit) on step 1 as Next, not create", () => {
    const onSubmit = vi.fn();
    renderForm({ onSubmit });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "auth" } });
    // Pressing Enter in a step-1 field submits the <form>; it must advance, never create.
    fireEvent.submit(screen.getByLabelText("Name").closest("form") as HTMLFormElement);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /generate/i })).toBeInTheDocument();
  });

  it("submits selected skills and todos through all three steps", () => {
    const onSubmit = vi.fn();
    renderForm({ onSubmit });
    goToToolsStep("docs");
    fireEvent.click(screen.getByLabelText(/docs-writer/i));
    fireEvent.click(screen.getByRole("button", { name: /create tentacle/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      "docs",
      "",
      expect.any(String),
      expect.objectContaining({
        animation: expect.any(String),
        expression: expect.any(String),
        accessory: expect.any(String),
        hairColor: expect.any(String),
      }),
      ["docs-writer"],
      [],
    );
  });

  it("pre-fills the checklist from onGenerateTodos", async () => {
    const onGenerateTodos = vi.fn(async () => ["write tests", "wire route"]);
    renderForm({ onGenerateTodos });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "auth" } });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "add password reset" },
    });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("button", { name: /generate/i }));

    await waitFor(() => expect(screen.getByDisplayValue("write tests")).toBeInTheDocument());
    expect(screen.getByDisplayValue("wire route")).toBeInTheDocument();
    expect(onGenerateTodos).toHaveBeenCalledWith("auth", "add password reset");
  });

  it("includes generated todos in the submit payload", async () => {
    const onSubmit = vi.fn();
    const onGenerateTodos = vi.fn(async () => ["task one"]);
    renderForm({ onSubmit, onGenerateTodos });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "auth" } });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("button", { name: /generate/i }));
    await waitFor(() => expect(screen.getByDisplayValue("task one")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("button", { name: /create tentacle/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      "auth",
      "",
      expect.any(String),
      expect.any(Object),
      [],
      ["task one"],
    );
  });
});
