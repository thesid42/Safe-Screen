import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { getVaultSnapshot, normalizePlaceholder, resolveVaultValue } from "./vault.js";
import type { ActionContext, DOMRectLike, SafeScreenAction } from "./types.js";

const BLOCKED_TEXT_PATTERN = /\b(copy|clipboard|reveal|show|print|export|download|exfiltrate|send|upload)\b/i;
const ANY_PLACEHOLDER_PATTERN = /\[?MY_(?:NAME|EMAIL|PHONE|SSN|ADDRESS|CARD|USERNAME|PASSWORD)\]?/g;

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
    blockLiteralVaultTyping(normalized.text);

    return {
      ...normalized,
      text: await replacePlaceholders(normalized.text)
    };
  }

  if (normalized.type === "answer") {
    return {
      ...normalized,
      text: sanitizeLiteralVaultText(normalized.text)
    };
  }

  if (normalized.type === "key") {
    const key = normalized.key.toLowerCase();
    if (key.includes("meta+c") || key.includes("control+c") || key.includes("ctrl+c") || key.includes("printscreen")) {
      throw new Error(`Blocked unsafe key action: ${normalized.key}`);
    }
    validateKeyboardKey(normalized.key);
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

  if (type === "answer") {
    return {
      type: "answer",
      text: requireString(candidate.text, "text")
    };
  }

  throw new Error(`Blocked unsupported action type: ${String(type)}`);
}

function validateAllowedAction(action: SafeScreenAction): void {
  if (!["click", "type", "scroll", "key", "wait", "answer"].includes(action.type)) {
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

async function replacePlaceholders(text: string): Promise<string> {
  const matches = [...text.matchAll(ANY_PLACEHOLDER_PATTERN)];
  let replaced = text;

  for (const match of matches) {
    const rawPlaceholder = match[0];
    const placeholder = normalizePlaceholder(rawPlaceholder);
    if (!placeholder) {
      throw new Error(`Unknown placeholder: ${rawPlaceholder}`);
    }
    const value = await resolveVaultValue(placeholder);
    replaced = replaced.replaceAll(rawPlaceholder, value);
  }

  return replaced;
}

function blockLiteralVaultTyping(text: string): void {
  if (process.env.SAFE_SCREEN_ALLOW_LITERAL_VAULT_TYPING === "true") {
    return;
  }

  for (const [placeholder, value] of Object.entries(getVaultSnapshot())) {
    if (value && text.includes(value)) {
      throw new Error(`Blocked model attempt to type literal vault value for ${placeholder}. The model must use placeholders.`);
    }
  }
}

function sanitizeLiteralVaultText(text: string): string {
  let sanitized = text;

  for (const [placeholder, value] of Object.entries(getVaultSnapshot())) {
    if (value) {
      sanitized = sanitized.replaceAll(value, placeholder);
    }
  }

  return sanitized;
}

function validateKeyboardKey(key: string): void {
  const supportedNamedKeys = new Set([
    "Enter",
    "Tab",
    "Escape",
    "Backspace",
    "Delete",
    "Insert",
    "Home",
    "End",
    "PageUp",
    "PageDown",
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "Shift",
    "Control",
    "Alt",
    "Meta"
  ]);

  for (const part of key.split("+")) {
    const segment = part.trim();
    if (!segment) continue;
    if (segment.length === 1) continue;
    if (/^F(?:[1-9]|1[0-2])$/.test(segment)) continue;
    if (supportedNamedKeys.has(segment)) continue;
    if (segment === "Ctrl") continue;

    throw new Error(`Blocked unsupported keyboard key from model: ${key}`);
  }
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
