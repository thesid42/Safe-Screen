import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { PLACEHOLDER_VAULT, type Placeholder } from "./demoPage.js";
import type { Redaction, RedactorOutput, Viewport, VisibleDomText } from "./types.js";

const PLACEHOLDERS = Object.keys(PLACEHOLDER_VAULT) as Placeholder[];

export async function redactScreenshot(
  screenshotPath: string,
  domText: VisibleDomText[],
  viewport: Viewport,
  outputPath = "artifacts/redacted-step-1.png"
): Promise<RedactorOutput> {
  const metadata = await sharp(screenshotPath).metadata();
  const width = metadata.width ?? viewport.width;
  const height = metadata.height ?? viewport.height;
  const redactions = collectRedactions(domText);
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
    viewport: { width, height },
    redactions
  };
}

function collectRedactions(domText: VisibleDomText[]): Redaction[] {
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
      box: padBox(item.box, 6),
      source: item
    });
  }

  return redactions;
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

function padBox(box: Redaction["box"], padding: number): Redaction["box"] {
  return {
    x: Math.max(0, box.x - padding),
    y: Math.max(0, box.y - padding),
    width: box.width + padding * 2,
    height: box.height + padding * 2
  };
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
