import { useEffect, useRef, useState } from "react";

import type { DeckAvailableSkill } from "@octogent/core";
import type { OctopusAccessory, OctopusAnimation, OctopusExpression } from "../EmptyOctopus";
import { OctopusGlyph } from "../EmptyOctopus";
import { TodoChecklistEditor } from "./TodoChecklistEditor";
import { ACCESSORIES, ANIMATIONS, EXPRESSIONS, OCTOPUS_COLORS } from "./octopusVisuals";

// ─── Add tentacle form ───────────────────────────────────────────────────────

export type OctopusAppearancePayload = {
  animation: string;
  expression: string;
  accessory: string;
  hairColor: string;
};

export type AddTentacleFormProps = {
  onSubmit: (
    name: string,
    description: string,
    color: string,
    octopus: OctopusAppearancePayload,
    suggestedSkills: string[],
    todos: string[],
  ) => void;
  onCancel: () => void;
  onGenerateTodos: (name: string, description: string) => Promise<string[]>;
  isSubmitting: boolean;
  error: string | null;
  availableSkills: DeckAvailableSkill[];
};

export const EXPRESSION_OPTIONS: { value: OctopusExpression; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "happy", label: "Happy" },
  { value: "angry", label: "Angry" },
  { value: "surprised", label: "Surprised" },
];

export const ACCESSORY_OPTIONS: { value: OctopusAccessory; label: string }[] = [
  { value: "none", label: "None" },
  { value: "long", label: "Long" },
  { value: "mohawk", label: "Mohawk" },
  { value: "side-sweep", label: "Side Sweep" },
  { value: "curly", label: "Curly" },
];

export const HAIR_COLORS = [
  "#4a2c0a",
  "#1a1a1a",
  "#c8a04a",
  "#e04020",
  "#f5f5f5",
  "#6b3fa0",
  "#2a6e3f",
  "#1e90ff",
];

export const AddTentacleForm = ({
  onSubmit,
  onCancel,
  onGenerateTodos,
  isSubmitting,
  error,
  availableSkills,
}: AddTentacleFormProps) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedColor, setSelectedColor] = useState(
    () => OCTOPUS_COLORS[Math.floor(Math.random() * OCTOPUS_COLORS.length)] as string,
  );
  const [selectedExpression, setSelectedExpression] = useState<OctopusExpression>(() => {
    const pick = EXPRESSIONS[Math.floor(Math.random() * EXPRESSIONS.length)] as OctopusExpression;
    return pick;
  });
  const [selectedAccessory, setSelectedAccessory] = useState<OctopusAccessory>(() => {
    const pick = ACCESSORIES[Math.floor(Math.random() * ACCESSORIES.length)] as OctopusAccessory;
    return pick;
  });
  const [selectedAnimation] = useState<OctopusAnimation>(() => {
    const pick = ANIMATIONS[Math.floor(Math.random() * ANIMATIONS.length)] as OctopusAnimation;
    return pick;
  });
  const [selectedHairColor, setSelectedHairColor] = useState(
    () => HAIR_COLORS[Math.floor(Math.random() * HAIR_COLORS.length)] as string,
  );
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [todos, setTodos] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const trimmedTodos = () => todos.map((t) => t.trim()).filter((t) => t.length > 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length === 0) {
      setStep(1);
      return;
    }
    onSubmit(
      name.trim(),
      description.trim(),
      selectedColor,
      {
        animation: selectedAnimation,
        expression: selectedExpression,
        accessory: selectedAccessory,
        hairColor: selectedHairColor,
      },
      selectedSkills,
      trimmedTodos(),
    );
  };

  const goNext = () => {
    if (step === 1 && name.trim().length === 0) return;
    setStep((s) => (s === 1 ? 2 : 3));
  };

  const goBack = () => {
    if (step === 1) {
      onCancel();
      return;
    }
    setStep((s) => (s === 3 ? 2 : 1));
  };

  const handleGenerate = async () => {
    if (name.trim().length === 0 && description.trim().length === 0) return;
    setIsGenerating(true);
    setGenerateError(null);
    try {
      const generated = await onGenerateTodos(name.trim(), description.trim());
      if (generated.length === 0) {
        setGenerateError("Couldn't generate todos — add them manually below.");
        return;
      }
      setTodos(generated);
    } catch {
      setGenerateError("Couldn't generate todos — add them manually below.");
    } finally {
      setIsGenerating(false);
    }
  };

  const toggleSkill = (skillName: string) => {
    setSelectedSkills((current) =>
      current.includes(skillName)
        ? current.filter((skill) => skill !== skillName)
        : [...current, skillName].sort((a, b) => a.localeCompare(b)),
    );
  };

  return (
    <form className="deck-add-form" onSubmit={handleSubmit}>
      <div className="deck-add-form-header">
        <button type="button" className="deck-add-form-back" onClick={goBack}>
          ← Back
        </button>
        <span className="deck-add-form-title">New Tentacle</span>
        <span className="deck-add-form-step-indicator">Step {step} of 3</span>
      </div>

      <div className="deck-add-form-body">
        {step === 1 && (
          <div className="deck-add-form-step">
            <div className="deck-add-form-preview">
              <OctopusGlyph
                color={selectedColor}
                animation={selectedAnimation}
                expression={selectedExpression}
                accessory={selectedAccessory}
                hairColor={selectedHairColor}
                scale={8}
              />
            </div>

            <label className="deck-add-form-label">
              Name
              <input
                ref={nameRef}
                type="text"
                className="deck-add-form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Database Layer"
              />
            </label>

            <label className="deck-add-form-label">
              Description
              <textarea
                className="deck-add-form-textarea"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this tentacle is responsible for..."
                rows={3}
              />
            </label>

            <details className="deck-add-form-appearance">
              <summary>Appearance</summary>
              <div className="deck-add-form-label">
                Color
                <div className="deck-add-form-colors">
                  {OCTOPUS_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className="deck-add-form-color-swatch"
                      data-selected={c === selectedColor ? "true" : "false"}
                      style={{ backgroundColor: c }}
                      onClick={() => setSelectedColor(c)}
                      aria-label={`Select color ${c}`}
                    />
                  ))}
                </div>
              </div>

              <div className="deck-add-form-row">
                <div className="deck-add-form-label">
                  Expression
                  <div className="deck-add-form-chips">
                    {EXPRESSION_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className="deck-add-form-chip"
                        data-selected={opt.value === selectedExpression ? "true" : "false"}
                        onClick={() => setSelectedExpression(opt.value)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="deck-add-form-label">
                  Hair Style
                  <div className="deck-add-form-chips">
                    {ACCESSORY_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className="deck-add-form-chip"
                        data-selected={opt.value === selectedAccessory ? "true" : "false"}
                        onClick={() => setSelectedAccessory(opt.value)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="deck-add-form-label">
                  Hair Color
                  <div className="deck-add-form-colors">
                    {HAIR_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className="deck-add-form-color-swatch deck-add-form-color-swatch--small"
                        data-selected={c === selectedHairColor ? "true" : "false"}
                        style={{ backgroundColor: c }}
                        onClick={() => setSelectedHairColor(c)}
                        aria-label={`Select hair color ${c}`}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </details>
          </div>
        )}

        {step === 2 && (
          <div className="deck-add-form-step">
            <div className="deck-add-form-label">
              Todos
              <button
                type="button"
                className="deck-add-form-generate"
                onClick={handleGenerate}
                disabled={isGenerating}
              >
                {isGenerating ? "Generating…" : "Generate from description"}
              </button>
            </div>
            {generateError && <div className="deck-add-form-error">{generateError}</div>}
            <TodoChecklistEditor items={todos} onChange={setTodos} />
          </div>
        )}

        {step === 3 && (
          <div className="deck-add-form-step">
            {availableSkills.length > 0 ? (
              <div className="deck-add-form-label">
                Suggested Skills
                <div className="deck-add-form-skills">
                  {availableSkills.map((skill) => {
                    const checked = selectedSkills.includes(skill.name);
                    return (
                      <label
                        key={`${skill.source}:${skill.name}`}
                        className="deck-add-form-skill-option"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSkill(skill.name)}
                        />
                        <span className="deck-add-form-skill-copy">
                          <span className="deck-add-form-skill-name">{skill.name}</span>
                          {skill.description && (
                            <span className="deck-add-form-skill-desc">{skill.description}</span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="deck-add-form-skill-desc">No skills available.</p>
            )}
          </div>
        )}

        {error && <div className="deck-add-form-error">{error}</div>}

        <div className="deck-add-form-nav">
          {step < 3 ? (
            <button
              type="button"
              className="deck-add-form-submit"
              onClick={goNext}
              disabled={step === 1 && name.trim().length === 0}
            >
              Next
            </button>
          ) : (
            <button
              type="submit"
              className="deck-add-form-submit"
              disabled={isSubmitting || name.trim().length === 0}
            >
              {isSubmitting ? "Creating..." : "Create Tentacle"}
            </button>
          )}
        </div>
      </div>
    </form>
  );
};
