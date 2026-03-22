import type { MintayNode } from '../../../../shared/types/mintaySchema';
import { mintayColorToFigma } from '../utils/colorUtils';
import { resolveFontName } from '../utils/fontUtils';

export async function buildTextNode(node: MintayNode): Promise<TextNode> {
  const text = figma.createText();
  text.name = node.name;
  text.x = node.x;
  text.y = node.y;

  const fontName = resolveFontName(node);

  try {
    await figma.loadFontAsync(fontName);
    text.fontName = fontName;
  } catch {
    const fallback = { family: 'Inter', style: 'Regular' } as FontName;
    await figma.loadFontAsync(fallback);
    text.fontName = fallback;
  }

  text.characters = node.content || '';
  text.fontSize = node.fontSize || 14;
  const requestedWidth = Math.max(node.width, 8);
  const looksMultiline =
    (node.content || '').includes('\n') ||
    requestedWidth >= 160 ||
    (node.lineHeight !== undefined && node.lineHeight > (node.fontSize || 14) * 1.35);

  text.textAutoResize = looksMultiline ? 'HEIGHT' : 'WIDTH_AND_HEIGHT';
  if (looksMultiline) {
    text.resize(requestedWidth, Math.max(node.height, 8));
  }
  text.textAlignHorizontal = node.textAlign || 'LEFT';
  text.textAlignVertical = 'TOP';

  if (node.fontStyle === 'ITALIC') {
    text.fontName = { family: (text.fontName as FontName).family, style: 'Italic' };
  }

  if (node.lineHeight) {
    text.lineHeight = { value: node.lineHeight, unit: 'PIXELS' };
  }

  if (node.letterSpacing !== undefined) {
    text.letterSpacing = { value: node.letterSpacing, unit: 'PIXELS' };
  }

  if (node.textColor) {
    text.fills = [{ type: 'SOLID', color: mintayColorToFigma(node.textColor), opacity: node.textColor.a }];
  }

  if (node.textDecoration === 'UNDERLINE') {
    text.textDecoration = 'UNDERLINE';
  } else if (node.textDecoration === 'STRIKETHROUGH') {
    text.textDecoration = 'STRIKETHROUGH';
  } else {
    text.textDecoration = 'NONE';
  }

  if (node.opacity !== undefined) {
    text.opacity = node.opacity;
  }

  return text;
}
