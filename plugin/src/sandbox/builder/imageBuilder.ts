import type { MintayNode } from '../../../../shared/types/mintaySchema';
import { applyCornerRadius } from '../utils/colorUtils';
import { resolveFontName } from '../utils/fontUtils';

export async function buildImagePlaceholder(node: MintayNode): Promise<FrameNode> {
  const frame = figma.createFrame();
  frame.name = node.name;
  frame.x = node.x;
  frame.y = node.y;
  frame.resize(Math.max(node.width, 1), Math.max(node.height, 1));
  frame.fills = [{ type: 'SOLID', color: { r: 0.88, g: 0.89, b: 0.92 } }];
  frame.strokes = [{ type: 'SOLID', color: { r: 0.78, g: 0.79, b: 0.84 } }];
  frame.strokeWeight = 1;
  frame.clipsContent = true;
  applyCornerRadius(frame, node.cornerRadius, node.cornerRadii);

  const label = figma.createText();
  const fontName = resolveFontName({ fontFamily: 'Inter', fontWeight: 500 });
  await figma.loadFontAsync(fontName);
  label.fontName = fontName;
  label.characters = 'Image';
  label.fontSize = 12;
  label.fills = [{ type: 'SOLID', color: { r: 0.46, g: 0.49, b: 0.56 } }];
  label.resize(Math.max(Math.min(node.width - 16, 80), 24), 16);
  label.x = Math.max((node.width - label.width) / 2, 8);
  label.y = Math.max((node.height - label.height) / 2, 8);
  frame.appendChild(label);

  return frame;
}
