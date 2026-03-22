import { parse } from '@babel/parser';

export interface DetectedSection {
  id: string;
  label: string;
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

export const analysisService = {
  detectSections(source: string): DetectedSection[] {
    const reactSections = detectReactSections(source);
    const htmlSections = detectHtmlSections(source);
    const merged = [...reactSections, ...htmlSections];
    const seen = new Set<string>();

    return merged
      .filter((section) => {
        if (seen.has(section.content)) {
          return false;
        }

        seen.add(section.content);
        return true;
      })
      .slice(0, 10);
  },
};
