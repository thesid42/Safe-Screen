export type SafeScreenAction =
  | { type: "click"; x: number; y: number; button?: "left" }
  | { type: "type"; text: string }
  | { type: "scroll"; dx?: number; dy: number; x?: number; y?: number }
  | { type: "key"; key: string }
  | { type: "wait"; ms: number }
  | { type: "answer"; text: string };

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

export type SanitizedFormField = {
  id?: string;
  name?: string;
  type?: string;
  label: string;
  status: "empty" | "filled";
  valueLabel?: string;
  focused: boolean;
  box: DOMRectLike;
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
  redactorFailed?: boolean;
  redactorFailureReason?: string;
};

export type ActionContext = {
  viewport: Viewport;
  submitBox?: DOMRectLike;
};
