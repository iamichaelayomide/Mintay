import type { MintayBorder, MintayColor, MintayFill, MintayShadow } from '../../../../shared/types/mintaySchema';

export function mintayColorToFigma(color: MintayColor): RGB {
  return {
    r: Math.min(1, Math.max(0, color.r)),
    g: Math.min(1, Math.max(0, color.g)),
    b: Math.min(1, Math.max(0, color.b)),
  };
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace('#', '');
  const fullHex = normalized.length === 3 ? normalized.split('').map((char) => `${char}${char}`).join('') : normalized;
  const bigint = parseInt(fullHex, 16);

  return {
    r: ((bigint >> 16) & 255) / 255,
    g: ((bigint >> 8) & 255) / 255,
    b: (bigint & 255) / 255,
  };
}

function gradientTransform(angle = 180): Transform {
  const radians = (angle * Math.PI) / 180;
  const x = Math.cos(radians);
  const y = Math.sin(radians);
  return [
    [x, -y, 0.5 - x / 2 + y / 2],
    [y, x, 0.5 - y / 2 - x / 2],
  ];
}

export function buildSolidOrGradientFills(fills: MintayFill[]): Paint[] {
  return fills.map((fill) => {
    if (fill.type === 'GRADIENT' && fill.gradient) {
      return {
        type: fill.gradient.type === 'RADIAL' ? 'GRADIENT_RADIAL' : 'GRADIENT_LINEAR',
        gradientStops: fill.gradient.stops.map((stop) => ({
          color: { ...mintayColorToFigma(stop.color), a: stop.color.a },
          position: stop.position,
        })),
        gradientTransform: gradientTransform(fill.gradient.angle),
        opacity: fill.opacity ?? 1,
      } as GradientPaint;
    }

    return {
      type: 'SOLID',
      color: mintayColorToFigma(fill.color || { r: 0.9, g: 0.9, b: 0.9, a: 1 }),
      opacity: fill.opacity ?? fill.color?.a ?? 1,
    } as SolidPaint;
  });
}

export function buildStrokePaints(strokes: MintayBorder[]): SolidPaint[] {
  return strokes.map((stroke) => ({
    type: 'SOLID',
    color: mintayColorToFigma(stroke.color),
    opacity: stroke.color.a,
  }));
}

export function buildEffects(shadows: MintayShadow[]): Effect[] {
  return shadows.map((shadow) => ({
    type: shadow.inner ? 'INNER_SHADOW' : 'DROP_SHADOW',
    visible: true,
    blendMode: 'NORMAL',
    color: { ...mintayColorToFigma(shadow.color), a: shadow.color.a },
    offset: { x: shadow.offsetX, y: shadow.offsetY },
    radius: shadow.blur,
    spread: shadow.spread,
  }));
}

export function applyCornerRadius(
  node: CornerMixin,
  cornerRadius?: number,
  cornerRadii?: [number, number, number, number],
): void {
  if (cornerRadii && 'topLeftRadius' in node) {
    node.topLeftRadius = cornerRadii[0];
    node.topRightRadius = cornerRadii[1];
    node.bottomRightRadius = cornerRadii[2];
    node.bottomLeftRadius = cornerRadii[3];
    return;
  }

  if (cornerRadius !== undefined && 'cornerRadius' in node) {
    node.cornerRadius = cornerRadius;
  }
}
