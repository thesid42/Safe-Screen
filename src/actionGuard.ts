import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { PLACEHOLDER_VAULT } from "./demoPage.js";
import type { ActionContext, DOMRectLike, SafeScreenAction } from "./types.js";

const BLOCKED_TEXT_PATTERN = /\b(copy|clipboard|reveal|show|print|export|download|exfiltrate|send|upload)\b/i;
const ANY_PLACEHOLDER_PATTERN = /\[?MY_(?:NAME|EMAIL|PHONE|SSN|ADDRESS|CARD)\]?/g;

export async function guardAction(action: unknown, context: ActionContext): Promise<SafeScreenAction> {
  const normalized = normalizeAction(action);
  validateAllowedAction(normalized);

  if (normalized.type === "click") {
    validateClick(normalized, context);
    if (context.submitBox && pointInBox(normalized.x, normalized.y, context.submitBox)) {
      await requireSubmitApproval();
    }
  }

  if (normalized.type === "type") {
    if (BLOCKED_TEXT_PATTERN.test(normalized.text)) {
      throw new Error(`Blocked unsafe typing request: ${normalized.text}`);
    }

    return {
      ...normalized,
      text: replacePlaceholders(normalized.text)
    };
  }

  if (normalized.type === "key") {
    const key = normalized.key.toLowerCase();
    if (key.includes("meta+c") || key.includes("control+c") || key.includes("ctrl+c") || key.includes("printscreen")) {
      throw new Error(`Blocked unsafe key action: ${normalized.key}`);
    }
  }

  return normalized;
}

function normalizeAction(action: unknown): SafeScreenAction {
  if (!action || typeof action !== "object") {
    throw new Error("Model action must be an object.");
  }

  const candidate = action as Record<string, unknown>;
  const type = candidate.type;

  if (type === "click") {
    if (candidate.button && candidate.button !== "left") {
      throw new Error(`Blocked non-left click action: ${String(candidate.button)}`);
    }

    return {
      type: "click",
      x: requireNumber(candidate.x, "x"),
      y: requireNumber(candidate.y, "y"),
      button: "left"
    };
  }

  if (type === "type") {
    return {
      type: "type",
      text: requireString(candidate.text, "text")
    };
  }

  if (type === "scroll") {
    return {
      type: "scroll",
      dx: optionalNumber(candidate.dx) ?? optionalNumber(candidate.scroll_x) ?? 0,
      dy: optionalNumber(candidate.dy) ?? optionalNumber(candidate.scroll_y) ?? 0,
      x: optionalNumber(candidate.x),
      y: optionalNumber(candidate.y)
    };
  }

  if (type === "key" || type === "keypress") {
    const keyValue = Array.isArray(candidate.keys) ? candidate.keys.join("+") : candidate.key ?? candidate.keys;
    return {
      type: "key",
      key: requireString(keyValue, "key")
    };
  }

  if (type === "wait") {
    return {
      type: "wait",
      ms: optionalNumber(candidate.ms) ?? 1000
    };
  }

  throw new Error(`Blocked unsupported action type: ${String(type)}`);
}

function validateAllowedAction(action: SafeScreenAction): void {
  if (!["click", "type", "scroll", "key", "wait"].includes(action.type)) {
    throw new Error(`Blocked unsupported action type: ${String((action as { type: string }).type)}`);
  }
}

function validateClick(action: Extract<SafeScreenAction, { type: "click" }>, context: ActionContext): void {
  if (
    action.x < 0 ||
    action.y < 0 ||
    action.x > context.viewport.width ||
    action.y > context.viewport.height
  ) {
    throw new Error(`Blocked click outside viewport: (${action.x}, ${action.y})`);
  }
}

function replacePlaceholders(text: string): string {
  return text.replace(ANY_PLACEHOLDER_PATTERN, (placeholder) => {
    const normalizedPlaceholder = placeholder.startsWith("[") ? placeholder : `[${placeholder}]`;
    const value = PLACEHOLDER_VAULT[normalizedPlaceholder as keyof typeof PLACEHOLDER_VAULT];
    if (!value) {
      throw new Error(`Unknown placeholder: ${placeholder}`);
    }
    return value;
  });
}

function pointInBox(x: number, y: number, box: DOMRectLike): boolean {
  return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
}

async function requireSubmitApproval(): Promise<void> {
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question("SafeScreen submit approval required. Type 'yes' to click Submit: ");
    if (answer.trim().toLowerCase() !== "yes") {
      throw new Error("Submit click denied by console approval.");
    }
  } finally {
    rl.close();
  }
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Action field '${field}' must be a finite number.`);
  }
  return value;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Action field '${field}' must be a string.`);
  }
  return value;
}
