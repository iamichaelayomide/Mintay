import type { MintayNode, MintayScreen } from '../../../../shared/types/mintaySchema';
import { buildFrameNode } from './frameBuilder';
import { buildImagePlaceholder } from './imageBuilder';
import { buildEllipseNode, buildRectangleNode } from './rectBuilder';
import { buildTextNode } from './textBuilder';
import { buildSolidOrGradientFills } from '../utils/colorUtils';
import { loadRequiredFonts } from '../utils/fontUtils';

export async function buildScreen(screen: MintayScreen): Promise<{ frame: FrameNode; warnings: string[] }> {
  const warnings: string[] = [];
  await loadRequiredFonts(screen);

  const frame = figma.createFrame();
  frame.name = screen.name;
  frame.resize(screen.width, screen.height);
  frame.clipsContent = false;
  frame.fills = buildSolidOrGradientFills([screen.background]);

  for (const node of screen.nodes) {
    try {
      const child = await buildNode(node);
      if (child) {
        frame.appendChild(child);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown node build error';
      warnings.push(`Skipped node "${node.name}" (${node.id}): ${message}`);
    }
  }

  return { frame, warnings };
}

export async function buildNode(node: MintayNode): Promise<SceneNode | null> {
  switch (node.type) {
    case 'FRAME':
    case 'GROUP':
    case 'COMPONENT':
      return buildFrameNode(node);
    case 'TEXT':
      return buildTextNode(node);
    case 'RECTANGLE':
    case 'VECTOR':
      return buildRectangleNode(node);
    case 'ELLIPSE':
      return buildEllipseNode(node);
    case 'IMAGE':
      return buildImagePlaceholder(node);
    default:
      return buildRectangleNode(node);
  }
}
