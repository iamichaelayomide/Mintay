import type { MintayNode } from '../../../../shared/types/mintaySchema';

export function applyAutoLayout(frame: FrameNode, node: MintayNode): void {
  frame.layoutMode = node.layoutMode === 'VERTICAL' ? 'VERTICAL' : 'HORIZONTAL';

  const primaryMap: Record<string, AutoLayoutPrimaryAxisAlignment> = {
    START: 'MIN',
    CENTER: 'CENTER',
    END: 'MAX',
    SPACE_BETWEEN: 'SPACE_BETWEEN',
  };

  const counterMap: Record<string, AutoLayoutCounterAxisAlignment> = {
    START: 'MIN',
    CENTER: 'CENTER',
    END: 'MAX',
    SPACE_BETWEEN: 'MIN',
  };

  frame.primaryAxisAlignItems = primaryMap[node.primaryAxisAlignment || 'START'];
  frame.counterAxisAlignItems = counterMap[node.counterAxisAlignment || 'START'];
  frame.itemSpacing = node.gap || 0;
  frame.paddingTop = node.paddingTop || 0;
  frame.paddingRight = node.paddingRight || 0;
  frame.paddingBottom = node.paddingBottom || 0;
  frame.paddingLeft = node.paddingLeft || 0;
  frame.primaryAxisSizingMode = 'AUTO';
  frame.counterAxisSizingMode = 'AUTO';
}
