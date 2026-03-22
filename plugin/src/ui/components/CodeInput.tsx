import type { DragEvent } from 'react';
import { useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';

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

const PRIORITY_PATTERNS = [
  /(^|\/)(app|src)\/page\.(tsx|jsx|ts|js)$/i,
  /(^|\/)(app|src)\/layout\.(tsx|jsx|ts|js)$/i,
  /(^|\/)(app|src)\/index\.(tsx|jsx|ts|js)$/i,
  /(^|\/)(app|src)\/main\.(tsx|jsx|ts|js)$/i,
  /(^|\/)(app|src)\/app\.(tsx|jsx|ts|js)$/i,
  /(^|\/)components\/.+\.(tsx|jsx)$/i,
  /(^|\/).+\.(tsx|jsx)$/i,
  /(^|\/).+\.(html)$/i,
  /(^|\/).+\.(css|scss|sass|less)$/i,
];

interface LoadedCodeFile {
  name: string;
  path: string;
  content: string;
}

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

function extractBalancedBlock(source: string, startIndex: number, openChar: string, closeChar: string): string | null {
  let depth = 0;
  let started = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];

    if (char === openChar) {
      depth += 1;
      started = true;
    } else if (char === closeChar && started) {
      depth -= 1;

      if (depth === 0) {
        return source.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function detectReactSections(source: string): DetectedSection[] {
  const sections: DetectedSection[] = [];
  const patterns = [
    /export\s+default\s+function\s+([A-Z][A-Za-z0-9_]*)\s*\(/g,
    /export\s+function\s+([A-Z][A-Za-z0-9_]*)\s*\(/g,
    /function\s+([A-Z][A-Za-z0-9_]*)\s*\(/g,
    /const\s+([A-Z][A-Za-z0-9_]*)\s*=\s*\([^)]*\)\s*=>\s*{/g,
    /const\s+([A-Z][A-Za-z0-9_]*)\s*=\s*\([^)]*\)\s*=>\s*\(/g,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(source)) && sections.length < 8) {
      const componentName = match[1];
      const declarationIndex = match.index;
      const bodyStart = source.indexOf('{', declarationIndex);
      const jsxStart = source.indexOf('(', declarationIndex + match[0].length - 1);

      let content = '';

      if (bodyStart !== -1 && (jsxStart === -1 || bodyStart < jsxStart)) {
        content = extractBalancedBlock(source, bodyStart, '{', '}') || '';
        if (content) {
          content = source.slice(declarationIndex, bodyStart) + content;
        }
      } else if (jsxStart !== -1) {
        const jsxBlock = extractBalancedBlock(source, jsxStart, '(', ')') || '';
        if (jsxBlock) {
          content = source.slice(declarationIndex, jsxStart) + jsxBlock;
        }
      }

      const trimmed = content.trim();
      if (trimmed.length < 80) {
        continue;
      }

      sections.push({
        id: `component-${componentName}-${sections.length}`,
        label: componentName,
        content: trimmed,
      });
    }
  }

  return sections;
}

function detectSections(source: string): DetectedSection[] {
  const reactSections = detectReactSections(source);
  const htmlSections = detectHtmlSections(source);
  const merged = [...reactSections, ...htmlSections];
  const seen = new Set<string>();

  return merged.filter((section) => {
    if (seen.has(section.content)) {
      return false;
    }

    seen.add(section.content);
    return true;
  }).slice(0, 10);
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

function scoreFilePath(filePath: string): number {
  const normalized = filePath.replace(/\\/g, '/');
  let score = 0;

  PRIORITY_PATTERNS.forEach((pattern, index) => {
    if (pattern.test(normalized)) {
      score += 100 - index * 10;
    }
  });

  if (normalized.includes('/node_modules/')) {
    score -= 200;
  }
  if (normalized.includes('/dist/') || normalized.includes('/build/')) {
    score -= 120;
  }
  if (normalized.includes('/public/')) {
    score -= 25;
  }

  return score;
}

function sortLoadedFiles(files: LoadedCodeFile[]): LoadedCodeFile[] {
  return [...files].sort((left, right) => {
    const scoreDiff = scoreFilePath(right.path) - scoreFilePath(left.path);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }

    return left.path.localeCompare(right.path);
  });
}

async function readRegularFiles(files: File[]): Promise<LoadedCodeFile[]> {
  const supportedFiles = files.filter((file) => isSupportedFile(file.name));

  if (supportedFiles.length === 0) {
    throw new Error('No supported code files found. Use HTML, CSS, JS, JSX, TS, or TSX files.');
  }

  return Promise.all(
    supportedFiles.map(async (file) => {
      const content = await file.text();
      const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      return {
        name: file.name,
        path,
        content: content.trim(),
      };
    }),
  );
}

async function readZipFile(file: File): Promise<LoadedCodeFile[]> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const entries = Object.values(zip.files);
  const supportedEntries = entries.filter(
    (entry) => !entry.dir && isSupportedFile(entry.name),
  );

  if (supportedEntries.length === 0) {
    throw new Error('The zip file does not contain supported code files.');
  }

  return Promise.all(
    supportedEntries.map(async (entry) => ({
      name: entry.name.split('/').pop() || entry.name,
      path: entry.name,
      content: (await entry.async('text')).trim(),
    })),
  );
}

async function loadFiles(files: File[]): Promise<LoadedCodeFile[]> {
  if (files.length === 1 && files[0].name.toLowerCase().endsWith('.zip')) {
    return readZipFile(files[0]);
  }

  return readRegularFiles(files);
}

function buildCombinedSource(files: LoadedCodeFile[]): string {
  return sortLoadedFiles(files)
    .slice(0, 30)
    .map((file) => `// File: ${file.path}\n${file.content}`)
    .join('\n\n');
}

function buildSummary(files: LoadedCodeFile[], originalFiles: File[]): string {
  if (originalFiles.length === 1 && originalFiles[0].name.toLowerCase().endsWith('.zip')) {
    return `${files.length} code files extracted from ${originalFiles[0].name}`;
  }

  return formatFileSummary(originalFiles);
}

export default function CodeInput({
  value,
  selectedValue,
  onChange,
  onSelectValue,
}: CodeInputProps) {
  const [fileSummary, setFileSummary] = useState('No files loaded yet.');
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const detectedSections = useMemo(() => detectSections(value), [value]);
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
      const loadedFiles = await loadFiles(files);
      onChange(buildCombinedSource(loadedFiles));
      onSelectValue(null);
      setFileSummary(buildSummary(loadedFiles, files));
      setPickerError(null);
    } catch (error) {
      setPickerError(error instanceof Error ? error.message : 'Could not read the selected files.');
    }
  };

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    await handleFilesChosen(event.dataTransfer.files);
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

      <div
        className={dragActive ? 'picker-card drag-active' : 'picker-card'}
        onDragEnter={() => setDragActive(true)}
        onDragLeave={() => setDragActive(false)}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDrop={(event) => {
          void handleDrop(event);
        }}
      >
        <div className="picker-title">Local files and folders</div>
        <p className="helper-text">
          Pick or drop a folder, zip, or a set of files and Mintay will combine supported frontend files automatically.
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
            Click a section to import just that part instead of the whole file. React components and large HTML regions are both detected.
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
