import type { MintayNode, MintayScreen } from '../../../../shared/types/mintaySchema';

function styleFromWeight(weight = 400, fontStyle: MintayNode['fontStyle'] = 'NORMAL'): string {
  if (fontStyle === 'ITALIC') {
    return 'Italic';
  }

  if (weight >= 800) {
    return 'Extra Bold';
  }
  if (weight >= 700) {
    return 'Bold';
  }
  if (weight >= 600) {
    return 'Semi Bold';
  }
  if (weight >= 500) {
    return 'Medium';
  }
  if (weight <= 300) {
    return 'Light';
  }

  return 'Regular';
}

export function resolveFontName(node: Pick<MintayNode, 'fontFamily' | 'fontWeight' | 'fontStyle'>): FontName {
  return {
    family: node.fontFamily || 'Inter',
    style: styleFromWeight(node.fontWeight, node.fontStyle),
  };
}

export async function loadRequiredFonts(screen: MintayScreen): Promise<void> {
  const fontMap = new Map<string, FontName>();

  fontMap.set('Inter-Regular', { family: 'Inter', style: 'Regular' });
  fontMap.set('Inter-Medium', { family: 'Inter', style: 'Medium' });
  fontMap.set('Inter-SemiBold', { family: 'Inter', style: 'Semi Bold' });
  fontMap.set('Inter-Bold', { family: 'Inter', style: 'Bold' });

  collectFonts(screen.nodes, fontMap);

  await Promise.allSettled(
    Array.from(fontMap.values()).map(async (fontName) => {
      try {
        await figma.loadFontAsync(fontName);
      } catch {
        await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
      }
    }),
  );
}

function collectFonts(nodes: MintayNode[], fontMap: Map<string, FontName>) {
  for (const node of nodes) {
    if (node.type === 'TEXT') {
      const fontName = resolveFontName(node);
      fontMap.set(`${fontName.family}-${fontName.style}`, fontName);
    }

    if (node.children && node.children.length) {
      collectFonts(node.children, fontMap);
    }
  }
}
