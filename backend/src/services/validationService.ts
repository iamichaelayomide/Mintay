import { MintayBorder, MintayColor, MintayFill, MintayGradient, MintayNode, MintayParseResult, MintayScreen, MintayShadow } from '../../../shared/types/mintaySchema';

const DEFAULT_COLOR: MintayColor = { r: 0.9, g: 0.9, b: 0.9, a: 1 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function safeColor(color?: MintayColor): MintayColor {
  return {
    r: clamp(color?.r ?? DEFAULT_COLOR.r, 0, 1),
    g: clamp(color?.g ?? DEFAULT_COLOR.g, 0, 1),
    b: clamp(color?.b ?? DEFAULT_COLOR.b, 0, 1),
    a: clamp(color?.a ?? DEFAULT_COLOR.a, 0, 1),
  };
}

function validateGradient(gradient?: MintayGradient): MintayGradient | undefined {
  if (!gradient) {
    return undefined;
  }

  return {
    type: gradient.type === 'RADIAL' ? 'RADIAL' : 'LINEAR',
    angle: gradient.angle,
    stops: Array.isArray(gradient.stops)
      ? gradient.stops.map((stop) => ({
          color: safeColor(stop.color),
          position: clamp(stop.position ?? 0, 0, 1),
        }))
      : [],
  };
}

function validateFill(fill: MintayFill): MintayFill {
  return {
    type: fill.type === 'GRADIENT' || fill.type === 'IMAGE' ? fill.type : 'SOLID',
    color: fill.color ? safeColor(fill.color) : undefined,
    gradient: validateGradient(fill.gradient),
    imageUrl: fill.imageUrl,
    opacity: fill.opacity === undefined ? undefined : clamp(fill.opacity, 0, 1),
  };
}

function validateBorder(border: MintayBorder): MintayBorder {
  return {
    color: safeColor(border.color),
    width: Math.max(border.width || 1, 1),
    style: border.style || 'SOLID',
    position: border.position || 'INSIDE',
  };
}

function validateShadow(shadow: MintayShadow): MintayShadow {
  return {
    offsetX: shadow.offsetX || 0,
    offsetY: shadow.offsetY || 0,
    blur: Math.max(shadow.blur || 0, 0),
    spread: Math.max(shadow.spread || 0, 0),
    color: safeColor(shadow.color),
    inner: Boolean(shadow.inner),
  };
}

function generateNodeId(): string {
  return `node_${Math.random().toString(36).slice(2, 9)}`;
}

export const validationService = {
  validate(result: MintayParseResult): MintayParseResult {
    const warnings = [...(result.warnings || [])];
    const screens = Array.isArray(result.screens) ? result.screens : [];

    return {
      success: result.success !== false,
      error: result.error,
      warnings,
      screens: screens.map((screen, index) => this.validateScreen(screen, index, warnings)),
    };
  },

  validateScreen(screen: MintayScreen, index: number, warnings: string[]): MintayScreen {
    return {
      name: screen.name || `Screen ${index + 1}`,
      width: Math.max(screen.width || 1440, 1),
      height: Math.max(screen.height || 900, 1),
      componentType: screen.componentType || 'DESKTOP',
      background: validateFill(
        screen.background || {
          type: 'SOLID',
          color: { r: 1, g: 1, b: 1, a: 1 },
        },
      ),
      nodes: Array.isArray(screen.nodes)
        ? screen.nodes.map((node) => this.validateNode(node, warnings))
        : [],
    };
  },

  validateNode(node: MintayNode, warnings: string[]): MintayNode {
    const validated: MintayNode = {
      ...node,
      id: node.id || generateNodeId(),
      type: node.type || 'FRAME',
      name: node.name || node.type || 'Layer',
      x: Number.isFinite(node.x) ? node.x : 0,
      y: Number.isFinite(node.y) ? node.y : 0,
      width: Number.isFinite(node.width) && node.width > 0 ? node.width : 100,
      height: Number.isFinite(node.height) && node.height > 0 ? node.height : 40,
      opacity: node.opacity === undefined ? undefined : clamp(node.opacity, 0, 1),
      fills: node.fills?.map(validateFill),
      strokes: node.strokes?.map(validateBorder),
      shadows: node.shadows?.map(validateShadow),
      textColor: node.textColor ? safeColor(node.textColor) : undefined,
      children: node.children?.map((child) => this.validateNode(child, warnings)),
    };

    if (!(Number.isFinite(node.width) && node.width > 0)) {
      warnings.push(`Node ${validated.id} had no valid width and was defaulted to 100.`);
    }

    if (!(Number.isFinite(node.height) && node.height > 0)) {
      warnings.push(`Node ${validated.id} had no valid height and was defaulted to 40.`);
    }

    return validated;
  },
};
