export type MintayNodeType =
  | 'FRAME'
  | 'TEXT'
  | 'RECTANGLE'
  | 'ELLIPSE'
  | 'IMAGE'
  | 'VECTOR'
  | 'COMPONENT'
  | 'GROUP';

export type MintayLayoutMode = 'NONE' | 'HORIZONTAL' | 'VERTICAL';
export type MintayAlignment = 'START' | 'CENTER' | 'END' | 'SPACE_BETWEEN';
export type MintayFontWeight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
export type MintayTextAlign = 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';

export interface MintayColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface MintayGradient {
  type: 'LINEAR' | 'RADIAL';
  stops: Array<{ color: MintayColor; position: number }>;
  angle?: number;
}

export interface MintayFill {
  type: 'SOLID' | 'GRADIENT' | 'IMAGE';
  color?: MintayColor;
  gradient?: MintayGradient;
  imageUrl?: string;
  opacity?: number;
}

export interface MintayShadow {
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
  color: MintayColor;
  inner?: boolean;
}

export interface MintayBorder {
  color: MintayColor;
  width: number;
  style: 'SOLID' | 'DASHED' | 'DOTTED';
  position: 'INSIDE' | 'OUTSIDE' | 'CENTER';
}

export interface MintayNode {
  id: string;
  type: MintayNodeType;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  layoutMode?: MintayLayoutMode;
  primaryAxisAlignment?: MintayAlignment;
  counterAxisAlignment?: MintayAlignment;
  gap?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  fills?: MintayFill[];
  strokes?: MintayBorder[];
  shadows?: MintayShadow[];
  opacity?: number;
  cornerRadius?: number;
  cornerRadii?: [number, number, number, number];
  clipsContent?: boolean;
  content?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: MintayFontWeight;
  fontStyle?: 'NORMAL' | 'ITALIC';
  textAlign?: MintayTextAlign;
  textColor?: MintayColor;
  lineHeight?: number;
  letterSpacing?: number;
  textDecoration?: 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH';
  children?: MintayNode[];
}

export interface MintayScreen {
  name: string;
  width: number;
  height: number;
  background: MintayFill;
  nodes: MintayNode[];
  componentType?: 'MOBILE' | 'DESKTOP' | 'TABLET';
}

export interface MintayParseResult {
  success: boolean;
  screens: MintayScreen[];
  warnings?: string[];
  error?: string;
}
