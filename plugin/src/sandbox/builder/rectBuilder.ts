import type { MintayNode } from '../../../../shared/types/mintaySchema';
import { applyCornerRadius, buildEffects, buildSolidOrGradientFills, buildStrokePaints } from '../utils/colorUtils';

export async function buildRectangleNode(node: MintayNode): Promise<RectangleNode> {
  const rect = figma.createRectangle();
  rect.name = node.name;
  rect.x = node.x;
  rect.y = node.y;
  rect.resize(Math.max(node.width, 1), Math.max(node.height, 1));
  rect.fills = node.fills?.length ? buildSolidOrGradientFills(node.fills) : [];
  rect.strokes = node.strokes?.length ? buildStrokePaints(node.strokes) : [];

  if (node.strokes?.length) {
    rect.strokeWeight = node.strokes[0].width;
    rect.strokeAlign = node.strokes[0].position === 'OUTSIDE' ? 'OUTSIDE' : node.strokes[0].position === 'CENTER' ? 'CENTER' : 'INSIDE';
  }

  if (node.shadows?.length) {
    rect.effects = buildEffects(node.shadows);
  }

  if (node.opacity !== undefined) {
    rect.opacity = node.opacity;
  }

  applyCornerRadius(rect, node.cornerRadius, node.cornerRadii);

  return rect;
}

export async function buildEllipseNode(node: MintayNode): Promise<EllipseNode> {
  const ellipse = figma.createEllipse();
  ellipse.name = node.name;
  ellipse.x = node.x;
  ellipse.y = node.y;
  ellipse.resize(Math.max(node.width, 1), Math.max(node.height, 1));
  ellipse.fills = node.fills?.length ? buildSolidOrGradientFills(node.fills) : [];
  ellipse.strokes = node.strokes?.length ? buildStrokePaints(node.strokes) : [];

  if (node.strokes?.length) {
    ellipse.strokeWeight = node.strokes[0].width;
    ellipse.strokeAlign = node.strokes[0].position === 'OUTSIDE' ? 'OUTSIDE' : node.strokes[0].position === 'CENTER' ? 'CENTER' : 'INSIDE';
  }

  if (node.shadows?.length) {
    ellipse.effects = buildEffects(node.shadows);
  }

  if (node.opacity !== undefined) {
    ellipse.opacity = node.opacity;
  }

  return ellipse;
}
