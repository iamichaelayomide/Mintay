import type { MintayColor, MintayFill, MintayNode, MintayParseResult, MintayScreen } from '../types/mintayTypes';

const PLAYWRIGHT = require('playwright') as {
  chromium: {
    launch(options: { headless: boolean; args?: string[] }): Promise<{
      newPage(options: { viewport: { width: number; height: number } }): Promise<{
        goto(url: string, options: { waitUntil: 'networkidle'; timeout: number }): Promise<void>;
        waitForTimeout(timeout: number): Promise<void>;
        title(): Promise<string>;
        evaluate<T>(pageFunction: () => T): Promise<T>;
        close(): Promise<void>;
      }>;
      close(): Promise<void>;
    }>;
  };
};

type ExtractedNode = {
  id: string;
  tag: string;
  name: string;
  nodeType: MintayNode['type'];
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  backgroundColor?: string;
  color?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number;
  textAlign?: string;
  borderRadius?: number;
  borderColor?: string;
  borderWidth?: number;
  children: ExtractedNode[];
};

type ExtractedPage = {
  title: string;
  width: number;
  height: number;
  backgroundColor: string;
  nodes: ExtractedNode[];
};

const VIEWPORTS = {
  AUTO: { width: 1440, height: 1200, componentType: 'DESKTOP' as const },
  DESKTOP: { width: 1440, height: 1200, componentType: 'DESKTOP' as const },
  TABLET: { width: 834, height: 1112, componentType: 'TABLET' as const },
  MOBILE: { width: 390, height: 844, componentType: 'MOBILE' as const },
};

function rgbaStringToColor(input?: string): MintayColor | null {
  if (!input || input === 'transparent' || input === 'rgba(0, 0, 0, 0)') {
    return null;
  }

  const rgbMatch = input.match(/rgba?\(([^)]+)\)/i);
  if (!rgbMatch) {
    return null;
  }

  const parts = rgbMatch[1].split(',').map((part) => part.trim());
  const r = Number(parts[0]);
  const g = Number(parts[1]);
  const b = Number(parts[2]);
  const a = parts[3] !== undefined ? Number(parts[3]) : 1;

  if ([r, g, b, a].some((value) => Number.isNaN(value))) {
    return null;
  }

  return {
    r: Math.min(1, Math.max(0, r / 255)),
    g: Math.min(1, Math.max(0, g / 255)),
    b: Math.min(1, Math.max(0, b / 255)),
    a: Math.min(1, Math.max(0, a)),
  };
}

function colorFillFromString(input?: string): MintayFill[] | undefined {
  const color = rgbaStringToColor(input);
  if (!color) {
    return undefined;
  }

  return [
    {
      type: 'SOLID',
      color,
      opacity: color.a,
    },
  ];
}

function borderFromExtracted(node: ExtractedNode) {
  const color = rgbaStringToColor(node.borderColor);
  if (!color || !node.borderWidth || node.borderWidth <= 0) {
    return undefined;
  }

  return [
    {
      color,
      width: node.borderWidth,
      style: 'SOLID' as const,
      position: 'INSIDE' as const,
    },
  ];
}

function normalizeChildren(children: MintayNode[]): MintayNode[] {
  return children.map((child) => ({
    ...child,
    children: child.children ? normalizeChildren(child.children) : undefined,
  }));
}

function toMintayNode(node: ExtractedNode): MintayNode | null {
  if (node.width < 2 || node.height < 2) {
    return null;
  }

  if (node.nodeType === 'TEXT') {
    return {
      id: node.id,
      type: 'TEXT',
      name: node.name,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      content: node.text || '',
      fontSize: node.fontSize || 16,
      fontFamily: node.fontFamily || 'Inter',
      fontWeight: (node.fontWeight as MintayNode['fontWeight']) || 400,
      textAlign:
        node.textAlign === 'center'
          ? 'CENTER'
          : node.textAlign === 'right'
            ? 'RIGHT'
            : 'LEFT',
      textColor: rgbaStringToColor(node.color) || { r: 0.1, g: 0.1, b: 0.1, a: 1 },
    };
  }

  const children = normalizeChildren(
    node.children
      .map((child) => toMintayNode(child))
      .filter((child): child is MintayNode => Boolean(child)),
  );

  return {
    id: node.id,
    type: node.nodeType,
    name: node.name,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    fills: node.nodeType === 'IMAGE'
      ? [
          {
            type: 'IMAGE',
          },
        ]
      : colorFillFromString(node.backgroundColor),
    strokes: borderFromExtracted(node),
    cornerRadius: node.borderRadius,
    children: children.length > 0 ? children : undefined,
  };
}

function buildScreenFromPage(page: ExtractedPage, mode?: string): MintayScreen {
  const viewport = VIEWPORTS[(mode as keyof typeof VIEWPORTS) || 'AUTO'] || VIEWPORTS.AUTO;

  return {
    name: page.title || 'Rendered Page',
    width: Math.max(320, Math.round(page.width)),
    height: Math.max(400, Math.round(page.height)),
    background: {
      type: 'SOLID',
      color: rgbaStringToColor(page.backgroundColor) || { r: 1, g: 1, b: 1, a: 1 },
    },
    nodes: page.nodes
      .map((node) => toMintayNode(node))
      .filter((node): node is MintayNode => Boolean(node)),
    componentType: viewport.componentType,
  };
}

export const runtimeExtractService = {
  async extractFromUrl(url: string, mode?: string, routePath?: string): Promise<MintayParseResult> {
    const viewport = VIEWPORTS[(mode as keyof typeof VIEWPORTS) || 'AUTO'] || VIEWPORTS.AUTO;
    const targetUrl = routePath ? new URL(routePath, `${url.replace(/\/$/, '')}/`).toString() : url;
    const browser = await PLAYWRIGHT.chromium.launch({
      headless: true,
      args: ['--disable-dev-shm-usage', '--no-sandbox'],
    });

    try {
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
      });

      try {
        await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 120000 });
        await page.waitForTimeout(1200);

        const title = await page.title();
        const extracted = await page.evaluate(() => {
          const MAX_DEPTH = 6;
          const MAX_CHILDREN = 24;

          function isVisible(element: Element, style: CSSStyleDeclaration, rect: DOMRect) {
            if (!(element instanceof HTMLElement)) {
              return false;
            }

            if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') === 0) {
              return false;
            }

            if (rect.width < 2 || rect.height < 2) {
              return false;
            }

            return true;
          }

          function onlyTextualChildren(element: Element) {
            return Array.from(element.childNodes).every((node) => {
              if (node.nodeType === Node.TEXT_NODE) {
                return true;
              }

              return node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'BR';
            });
          }

          function nodeTypeFor(element: Element, style: CSSStyleDeclaration, hasChildren: boolean) {
            const tag = element.tagName.toLowerCase();

            if (tag === 'img' || style.backgroundImage.includes('url(')) {
              return 'IMAGE';
            }

            if (tag === 'svg' || tag === 'path') {
              return 'VECTOR';
            }

            if (!hasChildren && onlyTextualChildren(element) && element.textContent?.trim()) {
              return 'TEXT';
            }

            return 'FRAME';
          }

          function extractNode(element: Element, rootRect: DOMRect, depth: number, indexPath: string): any | null {
            if (depth > MAX_DEPTH) {
              return null;
            }

            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            if (!isVisible(element, style, rect)) {
              return null;
            }

            const children = Array.from(element.children)
              .slice(0, MAX_CHILDREN)
              .map((child, index) => extractNode(child, rootRect, depth + 1, `${indexPath}-${index}`))
              .filter(Boolean);

            const nodeType = nodeTypeFor(element, style, children.length > 0);
            const text = nodeType === 'TEXT' ? element.textContent?.replace(/\s+/g, ' ').trim() || '' : '';

            return {
              id: `dom-${indexPath}`,
              tag: element.tagName.toLowerCase(),
              name:
                element.getAttribute('aria-label') ||
                element.getAttribute('data-testid') ||
                element.getAttribute('id') ||
                element.tagName,
              nodeType,
              x: Math.max(0, Math.round(rect.left - rootRect.left)),
              y: Math.max(0, Math.round(rect.top - rootRect.top)),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              text,
              backgroundColor: style.backgroundColor,
              color: style.color,
              fontSize: Number.parseFloat(style.fontSize || '16'),
              fontFamily: style.fontFamily?.split(',')[0]?.replace(/['"]/g, '') || 'Inter',
              fontWeight: Number.parseInt(style.fontWeight || '400', 10) || 400,
              textAlign: style.textAlign,
              borderRadius: Number.parseFloat(style.borderTopLeftRadius || '0') || 0,
              borderColor: style.borderTopColor,
              borderWidth: Number.parseFloat(style.borderTopWidth || '0') || 0,
              children,
            };
          }

          const body = document.body;
          const rootRect = body.getBoundingClientRect();
          const bodyStyle = window.getComputedStyle(body);
          const nodes = Array.from(body.children)
            .slice(0, MAX_CHILDREN)
            .map((child, index) => extractNode(child, rootRect, 0, `${index}`))
            .filter(Boolean);

          return {
            title: document.title || 'Rendered Page',
            width: Math.max(document.documentElement.scrollWidth, body.scrollWidth, rootRect.width),
            height: Math.max(document.documentElement.scrollHeight, body.scrollHeight, rootRect.height),
            backgroundColor: bodyStyle.backgroundColor || 'rgb(255, 255, 255)',
            nodes,
          };
        });

        await page.close();

        const screen = buildScreenFromPage(
          {
            title,
            width: extracted.width,
            height: extracted.height,
            backgroundColor: extracted.backgroundColor,
            nodes: extracted.nodes as ExtractedNode[],
          },
          mode,
        );

        return {
          success: true,
          screens: [screen],
          warnings: [
            `Runtime DOM extraction used ${targetUrl}. This should be closer to the rendered app than source-only reconstruction.`,
          ],
        };
      } catch (error) {
        await page.close();
        throw error;
      }
    } finally {
      await browser.close();
    }
  },
};
