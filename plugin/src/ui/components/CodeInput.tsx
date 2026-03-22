interface CodeInputProps {
  value: string;
  onChange: (value: string) => void;
}

export default function CodeInput({ value, onChange }: CodeInputProps) {
  return (
    <label className="input-panel">
      <span className="field-label">Source code</span>
      <textarea
        className="code-textarea"
        onChange={(event) => onChange(event.target.value)}
        placeholder="// Paste your React component, page, or HTML here..."
        spellCheck={false}
        value={value}
      />
    </label>
  );
}
