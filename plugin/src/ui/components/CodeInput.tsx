import type { DragEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';

interface DetectedSection {
  id: string;
  label: string;
  content: string;
}

interface CodeInputProps {
  backendUrl: string;
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
const IGNORED_PATH_SEGMENTS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.cache',
  '.vercel',
]);
const MAX_LOCAL_FILES = 400;

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

function normalizePickedPath(file: File): string {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
}

function shouldIgnorePath(filePath: string): boolean {
  const segments = filePath
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.toLowerCase());

  return segments.some((segment) => IGNORED_PATH_SEGMENTS.has(segment));
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
  const supportedFiles = files
    .filter((file) => !shouldIgnorePath(normalizePickedPath(file)))
    .filter((file) => isSupportedFile(file.name))
    .slice(0, MAX_LOCAL_FILES);

  if (supportedFiles.length === 0) {
    throw new Error('No supported source files found after skipping ignored folders like node_modules, .git, dist, and build.');
  }

  return Promise.all(
    supportedFiles.map(async (file) => {
      const content = await file.text();
      const path = normalizePickedPath(file);
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
    (entry) => !entry.dir && !shouldIgnorePath(entry.name) && isSupportedFile(entry.name),
  );

  if (supportedEntries.length === 0) {
    throw new Error('The zip file does not contain supported source files after skipping ignored folders.');
  }

  return Promise.all(
    supportedEntries.slice(0, MAX_LOCAL_FILES).map(async (entry) => ({
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

  if (originalFiles.length > MAX_LOCAL_FILES) {
    return `${files.length} source files loaded after skipping ignored folders`;
  }

  return formatFileSummary(originalFiles);
}

export default function CodeInput({
  backendUrl,
  value,
  selectedValue,
  onChange,
  onSelectValue,
}: CodeInputProps) {
  const [fileSummary, setFileSummary] = useState('No files loaded yet.');
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [loadedFiles, setLoadedFiles] = useState<LoadedCodeFile[]>([]);
  const [detectedSections, setDetectedSections] = useState<DetectedSection[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const selectedSectionId =
    selectedValue && detectedSections.find((section) => section.content === selectedValue)?.id;
  const prioritizedFiles = useMemo(() => sortLoadedFiles(loadedFiles).slice(0, 8), [loadedFiles]);
  const selectedFilePath =
    selectedValue && prioritizedFiles.find((file) => file.content === selectedValue)?.path;

  useEffect(() => {
    const trimmedValue = value.trim();

    if (trimmedValue.length < 80) {
      setDetectedSections([]);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch(`${backendUrl.replace(/\/$/, '')}/analyze`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ code: trimmedValue }),
          signal: controller.signal,
        });

        const result = await response.json();

        if (!response.ok || !result.success || !Array.isArray(result.sections)) {
          setDetectedSections([]);
          return;
        }

        setDetectedSections(result.sections as DetectedSection[]);
      } catch {
        if (!controller.signal.aborted) {
          setDetectedSections([]);
        }
      }
    }, 350);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [backendUrl, value]);

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
            Click a section to import just that part instead of the whole file. Section analysis now runs on the backend so the plugin stays lighter.
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
