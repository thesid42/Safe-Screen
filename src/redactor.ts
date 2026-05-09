import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { PLACEHOLDER_VAULT, type Placeholder } from "./demoPage.js";
import type { DOMRectLike, Redaction, RedactorOutput, Viewport, VisibleDomText } from "./types.js";

const PLACEHOLDERS = Object.keys(PLACEHOLDER_VAULT) as Placeholder[];
const DEFAULT_REDACTION_POLICY =
  "Redact direct PII, credentials, financial data, health data, government IDs, private notes, and any field that could identify or expose a person.";

export async function redactScreenshot(
  screenshotPath: string,
  domText: VisibleDomText[],
  viewport: Viewport,
  outputPath = "artifacts/redacted-step-1.png"
): Promise<RedactorOutput> {
  const metadata = await sharp(screenshotPath).metadata();
  const width = metadata.width ?? viewport.width;
  const height = metadata.height ?? viewport.height;
  const imageViewport = { width, height };
  const redactions = await detectRedactions(screenshotPath, domText, imageViewport);
  const overlaySvg = buildOverlaySvg(redactions, width, height);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await sharp(screenshotPath)
    .composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }])
    .png()
    .toFile(outputPath);

  const redactedScreenshotBase64 = await fs.readFile(outputPath, "base64");

  return {
    redactedScreenshotPath: outputPath,
    redactedScreenshotBase64,
    viewport: imageViewport,
    redactions
  };
}

async function detectRedactions(
  screenshotPath: string,
  domText: VisibleDomText[],
  viewport: Viewport
): Promise<Redaction[]> {
  const mode = getRedactorMode();
  const fallbackEnabled = process.env.SAFE_SCREEN_REDACTOR_FALLBACK !== "false";
  const ruleRedactions = mode === "rules" || mode === "hybrid"
    ? collectRuleRedactions(domText, viewport)
    : [];

  if (mode === "rules") {
    console.log("SafeScreen redactor: using local rule-based detector.");
    return ruleRedactions;
  }

  if (!process.env.BREV_REDACTOR_URL) {
    if (!fallbackEnabled) {
      throw new Error("BREV_REDACTOR_URL is required when SAFE_SCREEN_REDACTOR_MODE is not 'rules'.");
    }

    console.warn("BREV_REDACTOR_URL is not set; using local rule-based detector.");
    return collectRuleRedactions(domText, viewport);
  }

  try {
    const brevRedactions = await collectBrevRedactions(screenshotPath, domText, viewport);
    console.log(`SafeScreen redactor: Brev returned ${brevRedactions.length} redaction(s).`);

    if (mode === "hybrid") {
      return dedupeRedactions([...brevRedactions, ...ruleRedactions]);
    }

    return brevRedactions;
  } catch (error) {
    if (!fallbackEnabled) {
      throw error;
    }

    console.warn(`Brev redactor failed; using local rule-based detector. ${(error as Error).message}`);
    return collectRuleRedactions(domText, viewport);
  }
}

function getRedactorMode(): "rules" | "brev" | "hybrid" {
  const configured = process.env.SAFE_SCREEN_REDACTOR_MODE?.trim().toLowerCase();
  if (configured === "rules" || configured === "brev" || configured === "hybrid") {
    return configured;
  }

  return process.env.BREV_REDACTOR_URL ? "brev" : "rules";
}

function collectRuleRedactions(domText: VisibleDomText[], viewport: Viewport): Redaction[] {
  const redactions: Redaction[] = [];
  const seen = new Set<string>();

  for (const item of domText) {
    const placeholder = detectPlaceholder(item.text);
    if (!placeholder) continue;

    const key = `${placeholder}:${Math.round(item.box.x)}:${Math.round(item.box.y)}:${Math.round(item.box.width)}:${Math.round(item.box.height)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    redactions.push({
      placeholder,
      value: PLACEHOLDER_VAULT[placeholder],
      box: padAndClampBox(item.box, 6, viewport),
      source: item,
      category: placeholderToCategory(placeholder),
      confidence: 1,
      detector: "rules"
    });
  }

  return redactions;
}

async function collectBrevRedactions(
  screenshotPath: string,
  domText: VisibleDomText[],
  viewport: Viewport
): Promise<Redaction[]> {
  const api = getBrevRedactorApi();
  const endpoint = api === "vllm-chat"
    ? buildVllmChatEndpoint(process.env.BREV_REDACTOR_URL)
    : buildBrevRedactorEndpoint(process.env.BREV_REDACTOR_URL);
  console.log(`SafeScreen redactor: calling ${api} endpoint ${endpoint}`);
  const rawScreenshotBase64 = await fs.readFile(screenshotPath, "base64");
  const timeoutMs = Number.parseInt(process.env.BREV_REDACTOR_TIMEOUT_MS ?? "30000", 10);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const body = api === "vllm-chat"
      ? buildVllmChatBody(rawScreenshotBase64, domText, viewport)
      : {
          model: requireEnv("BREV_REDACTOR_MODEL"),
          policy: process.env.SAFE_SCREEN_REDACTION_POLICY || DEFAULT_REDACTION_POLICY,
          screenshot_base64: rawScreenshotBase64,
          viewport,
          dom_text: domText
        };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...buildBrevAuthHeaders()
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Brev redactor returned ${response.status}: ${body.slice(0, 240)}`);
    }

    const payload = await response.json() as unknown;
    const redactionPayload = api === "vllm-chat" ? parseVllmChatRedactionPayload(payload) : payload;
    return parseBrevRedactions(redactionPayload, domText, viewport);
  } finally {
    clearTimeout(timeout);
  }
}

function getBrevRedactorApi(): "redact" | "vllm-chat" {
  const configured = process.env.BREV_REDACTOR_API?.trim().toLowerCase();
  if (configured === "vllm-chat" || configured === "openai-chat") {
    return "vllm-chat";
  }

  return "redact";
}

function buildBrevRedactorEndpoint(baseUrl: string | undefined): string {
  if (!baseUrl) {
    throw new Error("BREV_REDACTOR_URL is not set.");
  }

  const normalizedBaseUrl = /^https?:\/\//i.test(baseUrl)
    ? baseUrl
    : `http://${baseUrl}`;
  const url = new URL(normalizedBaseUrl);

  if (url.pathname === "/" || url.pathname === "") {
    url.pathname = "/redact";
  }

  return url.toString();
}

function buildVllmChatEndpoint(baseUrl: string | undefined): string {
  if (!baseUrl) {
    throw new Error("BREV_REDACTOR_URL is not set.");
  }

  const normalizedBaseUrl = /^https?:\/\//i.test(baseUrl)
    ? baseUrl
    : `http://${baseUrl}`;
  const url = new URL(normalizedBaseUrl);

  if (url.pathname === "/" || url.pathname === "") {
    url.pathname = "/v1/chat/completions";
  } else if (url.pathname === "/v1" || url.pathname === "/v1/") {
    url.pathname = "/v1/chat/completions";
  } else if (!url.pathname.endsWith("/chat/completions")) {
    url.pathname = `${url.pathname.replace(/\/$/, "")}/chat/completions`;
  }

  return url.toString();
}

function buildVllmChatBody(rawScreenshotBase64: string, domText: VisibleDomText[], viewport: Viewport): Record<string, unknown> {
  const model = requireEnv("BREV_REDACTOR_MODEL");
  const policy = process.env.SAFE_SCREEN_REDACTION_POLICY || DEFAULT_REDACTION_POLICY;
  const compactDomText = domText.slice(0, 160).map((item, index) => ({
    index,
    text: item.text,
    box: item.box,
    tagName: item.tagName,
    id: item.id,
    name: item.name,
    type: item.type
  }));

  return {
    model,
    temperature: 0,
    max_tokens: getBrevMaxTokens(),
    messages: [
      {
        role: "system",
        content:
          "You are SafeScreen's trusted local redaction detector. Return only valid JSON. Do not include markdown."
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              `Policy: ${policy}\n` +
              `Viewport: ${JSON.stringify(viewport)}\n` +
              "Return JSON in this exact shape: {\"redactions\":[{\"placeholder\":\"[MY_EMAIL]\",\"category\":\"email\",\"confidence\":0.98,\"box\":{\"x\":0,\"y\":0,\"width\":10,\"height\":10},\"domId\":\"optional\"}]}.\n" +
              "Use placeholders [MY_NAME], [MY_EMAIL], [MY_PHONE], [MY_SSN], [MY_ADDRESS], [MY_CARD], or [PRIVATE_INFO].\n" +
              "Prefer the provided DOM boxes when a DOM item text is sensitive. DOM items:\n" +
              JSON.stringify(compactDomText)
          },
          {
            type: "image_url",
            image_url: {
              url: `data:image/png;base64,${rawScreenshotBase64}`
            }
          }
        ]
      }
    ]
  };
}

function getBrevMaxTokens(): number {
  const configured = Number.parseInt(process.env.BREV_REDACTOR_MAX_TOKENS ?? "2048", 10);
  if (!Number.isFinite(configured)) {
    return 2048;
  }

  return Math.min(Math.max(configured, 128), 4096);
}

function parseVllmChatRedactionPayload(payload: unknown): unknown {
  const content = readVllmMessageContent(payload);
  if (!content) {
    throw new Error("vLLM chat response did not include message content.");
  }

  const jsonText = extractJsonObject(content);
  return JSON.parse(jsonText) as unknown;
}

function readVllmMessageContent(payload: unknown): string | undefined {
  const candidate = payload as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = candidate.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .join("");
  }

  return undefined;
}

function extractJsonObject(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? content;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`vLLM chat response did not contain a JSON object: ${content.slice(0, 240)}`);
  }

  return candidate.slice(start, end + 1);
}

function buildBrevAuthHeaders(): Record<string, string> {
  const token = process.env.BREV_REDACTOR_TOKEN?.trim();
  return token ? { authorization: `Bearer ${token}` } : {};
}

function parseBrevRedactions(
  payload: unknown,
  domText: VisibleDomText[],
  viewport: Viewport
): Redaction[] {
  const candidate = payload as { redactions?: unknown; items?: unknown };
  const items = Array.isArray(candidate.redactions)
    ? candidate.redactions
    : Array.isArray(candidate.items)
      ? candidate.items
      : Array.isArray(payload)
        ? payload
        : undefined;

  if (!items) {
    throw new Error("Brev redactor response must contain a redactions array.");
  }

  return dedupeRedactions(items.flatMap((item) => normalizeBrevRedaction(item, domText, viewport)));
}

function normalizeBrevRedaction(
  item: unknown,
  domText: VisibleDomText[],
  viewport: Viewport
): Redaction[] {
  if (!item || typeof item !== "object") return [];

  const raw = item as Record<string, unknown>;
  const source = findSourceDomText(raw, domText);
  const box = readBox(raw.box) ?? readBox(raw.bounding_box) ?? readBox(raw.bbox) ?? source?.box;
  if (!box) return [];

  const category = readString(raw.category) ?? readString(raw.type) ?? "sensitive";
  const placeholder = normalizePlaceholder(readString(raw.placeholder), category);
  const confidence = readNumber(raw.confidence);

  return [{
    placeholder,
    value: placeholder in PLACEHOLDER_VAULT
      ? PLACEHOLDER_VAULT[placeholder as Placeholder]
      : source?.text ?? "",
    box: padAndClampBox(box, 6, viewport),
    source: source ?? {
      text: readString(raw.text) ?? "",
      box,
      tagName: "vision"
    },
    category,
    confidence,
    detector: "brev"
  }];
}

function findSourceDomText(raw: Record<string, unknown>, domText: VisibleDomText[]): VisibleDomText | undefined {
  const id = readString(raw.domId) ?? readString(raw.dom_id) ?? readString(raw.id);
  const name = readString(raw.name);
  const text = readString(raw.text) ?? readString(raw.value);

  return domText.find((item) => {
    if (id && item.id === id) return true;
    if (name && item.name === name) return true;
    if (text && item.text === text) return true;
    return false;
  });
}

function readBox(value: unknown): DOMRectLike | undefined {
  if (!value || typeof value !== "object") return undefined;
  const box = value as Record<string, unknown>;
  const x = readNumber(box.x ?? box.left);
  const y = readNumber(box.y ?? box.top);
  const width = readNumber(box.width ?? box.w);
  const height = readNumber(box.height ?? box.h);

  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    return undefined;
  }

  return { x, y, width, height };
}

function normalizePlaceholder(rawPlaceholder: string | undefined, category: string): string {
  if (rawPlaceholder && /^\[[A-Z0-9_]+\]$/.test(rawPlaceholder)) {
    return rawPlaceholder;
  }

  const normalizedCategory = category.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const categoryMap: Record<string, string> = {
    address: "[MY_ADDRESS]",
    card: "[MY_CARD]",
    credit_card: "[MY_CARD]",
    email: "[MY_EMAIL]",
    name: "[MY_NAME]",
    person_name: "[MY_NAME]",
    phone: "[MY_PHONE]",
    ssn: "[MY_SSN]",
    social_security: "[MY_SSN]",
    social_security_number: "[MY_SSN]"
  };

  return categoryMap[normalizedCategory] ?? `[PRIVATE_${normalizedCategory.toUpperCase() || "INFO"}]`;
}

function detectPlaceholder(text: string): Placeholder | undefined {
  const normalized = text.trim();

  for (const placeholder of PLACEHOLDERS) {
    if (normalized.includes(PLACEHOLDER_VAULT[placeholder])) {
      return placeholder;
    }
  }

  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(normalized)) return "[MY_EMAIL]";
  if (/\b\d{3}[-.\s]\d{2}[-.\s]\d{4}\b/.test(normalized)) return "[MY_SSN]";
  if (/\b(?:\d[ -]*?){13,19}\b/.test(normalized)) return "[MY_CARD]";
  if (/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/.test(normalized)) return "[MY_PHONE]";
  if (/\b\d{1,6}\s+[A-Za-z0-9 .'-]+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Drive|Dr|Lane|Ln)\b/i.test(normalized)) {
    return "[MY_ADDRESS]";
  }

  return undefined;
}

function padAndClampBox(box: Redaction["box"], padding: number, viewport: Viewport): Redaction["box"] {
  const x = Math.max(0, box.x - padding);
  const y = Math.max(0, box.y - padding);
  const right = Math.min(viewport.width, box.x + box.width + padding);
  const bottom = Math.min(viewport.height, box.y + box.height + padding);

  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y)
  };
}

function dedupeRedactions(redactions: Redaction[]): Redaction[] {
  const seen = new Set<string>();
  const deduped: Redaction[] = [];

  for (const redaction of redactions) {
    const key = `${redaction.placeholder}:${Math.round(redaction.box.x)}:${Math.round(redaction.box.y)}:${Math.round(redaction.box.width)}:${Math.round(redaction.box.height)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(redaction);
  }

  return deduped;
}

function placeholderToCategory(placeholder: Placeholder): string {
  return placeholder
    .replace("[MY_", "")
    .replace("]", "")
    .toLowerCase();
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be set when using the Brev redactor.`);
  }

  return value;
}

function buildOverlaySvg(redactions: Redaction[], width: number, height: number): string {
  const labels = redactions
    .map((redaction) => {
      const box = redaction.box;
      const fontSize = Math.max(13, Math.min(22, Math.floor(box.height * 0.42)));
      const label = escapeXml(redaction.placeholder);
      const textX = box.x + 10;
      const textY = box.y + box.height / 2 + fontSize * 0.36;

      return `<g>
  <rect x="${box.x.toFixed(1)}" y="${box.y.toFixed(1)}" width="${box.width.toFixed(1)}" height="${box.height.toFixed(1)}" rx="4" fill="#ffe36e" stroke="#2f2a10" stroke-width="2"/>
  <text x="${textX.toFixed(1)}" y="${textY.toFixed(1)}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="700" fill="#181400">${label}</text>
</g>`;
    })
    .join("\n");

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
${labels}
</svg>`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
