import { useMemo, useRef, useState } from 'react';

interface DetectedSection {
  id: string;
  label: string;
  content: string;
}

interface CodeInputProps {
  value: string;
  selectedValue?: string;
  onChange: (value: string) => void;
  onSelectValue: (value: string | null) => void;
}

const SUPPORTED_EXTENSIONS = [
  '.tsx',
  '.ts',
  '.jsx',
  '.js',
  '.html',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.json',
];

function detectHtmlSections(source: string): DetectedSection[] {
  const pattern = /<(main|section|header|footer|article|nav|aside|form)\b[^>]*>[\s\S]*?<\/\1>/gi;
  const sections: DetectedSection[] = [];
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(source)) && sections.length < 8) {
    const tagName = match[1].toLowerCase();
    const content = match[0].trim();
    const label = `${tagName[0].toUpperCase()}${tagName.slice(1)} ${index + 1}`;

    if (content.length < 80) {
      continue;
    }

    sections.push({
      id: `${tagName}-${index}`,
      label,
      content,
    });
    index += 1;
  }

  return sections;
}

function formatFileSummary(files: File[]): string {
  if (files.length === 0) {
    return 'No files loaded yet.';
  }

  if (files.length === 1) {
    return files[0].name;
  }

  return `${files.length} files loaded`;
}

function isSupportedFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

async function readFile(file: File): Promise<string> {
  return file.text();
}

async function combineFiles(files: File[]): Promise<string> {
  const supportedFiles = files.filter((file) => isSupportedFile(file.name)).slice(0, 30);

  if (supportedFiles.length === 0) {
    throw new Error('No supported code files found. Use HTML, CSS, JS, JSX, TS, or TSX files.');
  }

  const parts = await Promise.all(
    supportedFiles.map(async (file) => {
      const content = await readFile(file);
      const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      return `// File: ${path}\n${content.trim()}`;
    }),
  );

  return parts.join('\n\n');
}

export default function CodeInput({
  value,
  selectedValue,
  onChange,
  onSelectValue,
}: CodeInputProps) {
  const [fileSummary, setFileSummary] = useState('No files loaded yet.');
  const [pickerError, setPickerError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const detectedSections = useMemo(() => detectHtmlSections(value), [value]);
  const selectedSectionId =
    selectedValue && detectedSections.find((section) => section.content === selectedValue)?.id;

  const handleSourceChange = (nextValue: string) => {
    onChange(nextValue);
    onSelectValue(null);
    setPickerError(null);
  };

  const handleFilesChosen = async (fileList: FileList | null) => {
    const files = fileList ? Array.from(fileList) : [];
    setFileSummary(formatFileSummary(files));

    if (files.length === 0) {
      return;
    }

    try {
      const combined = await combineFiles(files);
      onChange(combined);
      onSelectValue(null);
      setPickerError(null);
    } catch (error) {
      setPickerError(error instanceof Error ? error.message : 'Could not read the selected files.');
    }
  };

  return (
    <div className="input-panel">
      <div className="code-toolbar">
        <span className="field-label">Source code</span>
        <div className="code-actions">
          <button
            className="secondary-button compact"
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            Pick files
          </button>
          <button
            className="secondary-button compact"
            onClick={() => folderInputRef.current?.click()}
            type="button"
          >
            Pick folder
          </button>
        </div>
      </div>

      <input
        hidden
        multiple
        onChange={(event) => {
          void handleFilesChosen(event.target.files);
          event.currentTarget.value = '';
        }}
        ref={fileInputRef}
        type="file"
      />

      <input
        hidden
        multiple
        onChange={(event) => {
          void handleFilesChosen(event.target.files);
          event.currentTarget.value = '';
        }}
        ref={folderInputRef}
        type="file"
        {...({
          webkitdirectory: '',
          directory: '',
        } as React.InputHTMLAttributes<HTMLInputElement>)}
      />

      <div className="picker-card">
        <div className="picker-title">Local files and folders</div>
        <p className="helper-text">
          Pick a folder or a set of files and Mintay will combine supported frontend files automatically.
        </p>
        <p className="picker-summary">{fileSummary}</p>
        {pickerError ? <p className="picker-error">{pickerError}</p> : null}
      </div>

      {detectedSections.length > 0 ? (
        <div className="section-picker">
          <div className="section-picker-header">
            <span className="field-label">Detected sections</span>
            <button
              className={selectedValue ? 'ghost-chip active' : 'ghost-chip'}
              onClick={() => onSelectValue(null)}
              type="button"
            >
              Use full source
            </button>
          </div>
          <div className="section-chip-row">
            {detectedSections.map((section) => (
              <button
                className={selectedSectionId === section.id ? 'section-chip active' : 'section-chip'}
                key={section.id}
                onClick={() => onSelectValue(section.content)}
                type="button"
              >
                {section.label}
              </button>
            ))}
          </div>
          <p className="helper-text">
            Click a section to import just that part instead of the whole file.
          </p>
        </div>
      ) : null}

      <textarea
        className="code-textarea"
        onChange={(event) => handleSourceChange(event.target.value)}
        placeholder="// Paste your React component, page, or HTML here..."
        spellCheck={false}
        value={value}
      />
    </div>
  );
}
