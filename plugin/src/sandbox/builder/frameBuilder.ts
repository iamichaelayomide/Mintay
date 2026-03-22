import type { MintayNode } from '../../../../shared/types/mintaySchema';
import { applyAutoLayout } from './autoLayout';
import { buildNode } from './nodeBuilder';
import { buildEffects, buildStrokePaints, buildSolidOrGradientFills, applyCornerRadius } from '../utils/colorUtils';

function hasVisualStyling(node: MintayNode): boolean {
  return Boolean(
    (node.fills && node.fills.length) ||
      (node.strokes && node.strokes.length) ||
      (node.shadows && node.shadows.length) ||
      node.cornerRadius !== undefined ||
      (node.cornerRadii && node.cornerRadii.length),
  );
}

export async function buildFrameNode(node: MintayNode): Promise<FrameNode> {
  const frame = figma.createFrame();
  frame.name = node.name;
  frame.x = node.x;
  frame.y = node.y;
  frame.resize(Math.max(node.width, 1), Math.max(node.height, 1));
  frame.fills = node.fills && node.fills.length ? buildSolidOrGradientFills(node.fills) : [];

  if (node.strokes && node.strokes.length) {
    frame.strokes = buildStrokePaints(node.strokes);
    frame.strokeWeight = node.strokes[0].width;
    frame.strokeAlign = node.strokes[0].position === 'OUTSIDE' ? 'OUTSIDE' : node.strokes[0].position === 'CENTER' ? 'CENTER' : 'INSIDE';
    frame.dashPattern =
      node.strokes[0].style === 'DASHED'
        ? [6, 4]
        : node.strokes[0].style === 'DOTTED'
          ? [1, 3]
          : [];
  } else {
    frame.strokes = [];
  }

  if (node.shadows && node.shadows.length) {
    frame.effects = buildEffects(node.shadows);
  }

  if (node.opacity !== undefined) {
    frame.opacity = node.opacity;
  }

  if (node.clipsContent !== undefined) {
    frame.clipsContent = node.clipsContent;
  }

  if (node.type === 'GROUP' && !hasVisualStyling(node)) {
    frame.fills = [];
    frame.strokes = [];
    frame.effects = [];
    frame.clipsContent = false;
  }

  applyCornerRadius(frame, node.cornerRadius, node.cornerRadii);

  if (node.layoutMode && node.layoutMode !== 'NONE') {
    applyAutoLayout(frame, node);
  }

  for (const child of node.children || []) {
    try {
      const childNode = await buildNode(child);
      if (!childNode) {
        continue;
      }

      frame.appendChild(childNode);

      if (node.layoutMode && node.layoutMode !== 'NONE') {
        childNode.x = 0;
        childNode.y = 0;
        if ('layoutPositioning' in childNode) {
          childNode.layoutPositioning = 'AUTO';
        }
      }
    } catch (error) {
      console.warn(`Failed to build child node ${child.id}:`, error);
    }
  }

  return frame;
}
