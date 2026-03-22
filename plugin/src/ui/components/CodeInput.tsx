import type { DragEvent } from 'react';
import { useMemo, useRef, useState } from 'react';
import { parse } from '@babel/parser';
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

function isPascalCase(value: string): boolean {
  return /^[A-Z][A-Za-z0-9_]*$/.test(value);
}

function collectJsxLikeReturn(node: unknown): boolean {
  if (!node || typeof node !== 'object') {
    return false;
  }

  const candidate = node as { type?: string; body?: unknown };

  if (
    candidate.type === 'JSXElement' ||
    candidate.type === 'JSXFragment' ||
    candidate.type === 'CallExpression'
  ) {
    return true;
  }

  if (candidate.type === 'BlockStatement' && Array.isArray(candidate.body)) {
    return candidate.body.some((statement) => {
      if (!statement || typeof statement !== 'object') {
        return false;
      }

      const typedStatement = statement as { type?: string; argument?: unknown };
      return typedStatement.type === 'ReturnStatement' && collectJsxLikeReturn(typedStatement.argument);
    });
  }

  return false;
}

function detectReactSections(source: string): DetectedSection[] {
  const sections: DetectedSection[] = [];
  let ast: any;

  try {
    ast = parse(source, {
      sourceType: 'unambiguous',
      errorRecovery: true,
      plugins: ['jsx', 'typescript'],
    });
  } catch {
    return sections;
  }

  const pushComponent = (name: string, node: { start?: number | null; end?: number | null }, bodyNode?: unknown) => {
    if (!isPascalCase(name) || !collectJsxLikeReturn(bodyNode)) {
      return;
    }

    const start = typeof node.start === 'number' ? node.start : null;
    const end = typeof node.end === 'number' ? node.end : null;

    if (start === null || end === null || end <= start) {
      return;
    }

    const content = source.slice(start, end).trim();
    if (content.length < 80) {
      return;
    }

    sections.push({
      id: `component-${name}-${sections.length}`,
      label: name,
      content,
    });
  };

  const visit = (node: any) => {
    if (!node || typeof node !== 'object' || sections.length >= 8) {
      return;
    }

    if (node.type === 'FunctionDeclaration' && node.id?.name) {
      pushComponent(node.id.name, node, node.body);
    }

    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && node.init) {
      const initType = node.init.type;
      if (initType === 'ArrowFunctionExpression' || initType === 'FunctionExpression') {
        pushComponent(node.id.name, node, node.init.body);
      }
    }

    if (node.type === 'ExportDefaultDeclaration' && node.declaration) {
      const declaration = node.declaration;
      if (declaration.type === 'FunctionDeclaration' && declaration.id?.name) {
        pushComponent(declaration.id.name, node, declaration.body);
      }
      if (
        declaration.type === 'ArrowFunctionExpression' ||
        declaration.type === 'FunctionExpression'
      ) {
        pushComponent('DefaultExport', node, declaration.body);
      }
    }

    Object.keys(node).forEach((key) => {
      const value = node[key];
      if (Array.isArray(value)) {
        value.forEach((item) => visit(item));
        return;
      }

      if (value && typeof value === 'object' && key !== 'loc') {
        visit(value);
      }
    });
  };

  visit(ast.program);
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
  const [loadedFiles, setLoadedFiles] = useState<LoadedCodeFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const detectedSections = useMemo(() => detectSections(value), [value]);
  const selectedSectionId =
    selectedValue && detectedSections.find((section) => section.content === selectedValue)?.id;
  const prioritizedFiles = useMemo(() => sortLoadedFiles(loadedFiles).slice(0, 8), [loadedFiles]);
  const selectedFilePath =
    selectedValue && prioritizedFiles.find((file) => file.content === selectedValue)?.path;

  const handleSourceChange = (nextValue: string) => {
    onChange(nextValue);
    onSelectValue(null);
    setLoadedFiles([]);
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
      setLoadedFiles(loadedFiles);
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

      {prioritizedFiles.length > 0 ? (
        <div className="section-picker">
          <div className="section-picker-header">
            <span className="field-label">Candidate files</span>
            <button
              className={selectedFilePath ? 'ghost-chip active' : 'ghost-chip'}
              onClick={() => onSelectValue(null)}
              type="button"
            >
              Use combined source
            </button>
          </div>
          <div className="section-chip-row">
            {prioritizedFiles.map((file) => (
              <button
                className={selectedFilePath === file.path ? 'section-chip active' : 'section-chip'}
                key={file.path}
                onClick={() => onSelectValue(file.content)}
                type="button"
              >
                {file.name}
              </button>
            ))}
          </div>
          <p className="helper-text">
            Click a file to import only that file, or keep the combined source for broader context.
          </p>
        </div>
      ) : null}

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
