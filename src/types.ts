export type SafeScreenAction =
  | { type: "click"; x: number; y: number; button?: "left" }
  | { type: "type"; text: string }
  | { type: "scroll"; dx?: number; dy: number; x?: number; y?: number }
  | { type: "key"; key: string }
  | { type: "wait"; ms: number };

export type DOMRectLike = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type VisibleDomText = {
  text: string;
  box: DOMRectLike;
  tagName: string;
  id?: string;
  name?: string;
  type?: string;
};

export type Viewport = {
  width: number;
  height: number;
};

export type Redaction = {
  placeholder: string;
  value: string;
  box: DOMRectLike;
  source: VisibleDomText;
  category?: string;
  confidence?: number;
  detector?: "rules" | "brev";
};

export type RedactorOutput = {
  redactedScreenshotPath: string;
  redactedScreenshotBase64: string;
  viewport: Viewport;
  redactions: Redaction[];
};

export type ActionContext = {
  viewport: Viewport;
  submitBox?: DOMRectLike;
};
