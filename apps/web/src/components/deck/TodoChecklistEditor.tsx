export type TodoChecklistEditorProps = {
  items: string[];
  onChange: (items: string[]) => void;
};

export const TodoChecklistEditor = ({ items, onChange }: TodoChecklistEditorProps) => {
  const updateAt = (index: number, value: string) => {
    onChange(items.map((item, i) => (i === index ? value : item)));
  };

  const removeAt = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const addItem = () => {
    onChange([...items, ""]);
  };

  return (
    <div className="deck-todo-editor">
      {items.length === 0 ? (
        <p className="deck-todo-editor-empty">
          No todos yet. Generate from the description or add them manually.
        </p>
      ) : (
        <ul className="deck-todo-editor-list">
          {items.map((item, index) => (
            // Index key is acceptable here: the list is short, fully controlled, and
            // reorder is not supported in this editor.
            // biome-ignore lint/suspicious/noArrayIndexKey: stable ids aren't available for plain strings; list is short, fully controlled, reorder unsupported
            <li key={index} className="deck-todo-editor-row">
              <input
                type="text"
                className="deck-todo-editor-input"
                value={item}
                onChange={(e) => updateAt(index, e.target.value)}
                placeholder="Describe a task..."
              />
              <button
                type="button"
                className="deck-todo-editor-remove"
                onClick={() => removeAt(index)}
                aria-label={`Remove todo ${index + 1}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="deck-todo-editor-add" onClick={addItem}>
        + Add item
      </button>
    </div>
  );
};
