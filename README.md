# SafeScreen

SafeScreen is like putting sticky notes over sensitive information before an AI assistant looks at your screen.

The local controller can see private demo values such as an email, phone number, SSN, address, and credit card. Before the CUA model receives an image, SafeScreen draws sticky-note labels over those values:

- `[MY_NAME]`
- `[MY_EMAIL]`
- `[MY_PHONE]`
- `[MY_SSN]`
- `[MY_ADDRESS]`
- `[MY_CARD]`

The AI still sees the page layout, labels, fields, and buttons, so it can decide where to click and what to type. If the AI says to type `[MY_EMAIL]`, the local SafeScreen executor swaps that placeholder for the real value immediately before typing into the browser.

## Security Rule

The cloud CUA model must never receive:

- raw screenshots
- raw DOM text containing PII
- real email
- real phone
- real SSN
- real address
- real credit card

It should only receive:

- redacted screenshots
- safe placeholder labels

This MVP keeps the placeholder vault in `src/demoPage.ts` and never includes it in Lightcone requests.

## Architecture

```text
Kernel browser screenshot
  -> local DOM-assisted SafeScreen redactor
  -> redacted screenshot with sticky-note labels
  -> Lightcone / Northstar CUA or mock Tzafon client
  -> SafeScreen action guard
  -> local placeholder substitution
  -> Kernel browser execution
```

For the 4-hour MVP, redaction can run in two modes:

- local rule-based detection, where Playwright reads visible DOM text and bounding boxes, then `sharp` draws sticky-note overlays onto the screenshot while preserving the original dimensions and coordinate space
- Brev-hosted smart detection, where SafeScreen sends the raw local screenshot plus DOM metadata to a trusted Qwen VL redaction service and receives back redaction boxes/labels before anything is sent to the CUA model

The Brev redactor is inside the privacy boundary. Lightcone/Northstar still receives only the redacted screenshot.

## Setup

```bash
npm install
cp .env.example .env
```

Set these values if you want cloud integrations:

```bash
KERNEL_API_KEY=...
TZAFON_API_KEY=...
TZAFON_MODEL=...
LIGHTCONE_BASE_URL=
TZAFON_MOCK_FALLBACK=true
SAFE_SCREEN_REDACTOR_MODE=brev
BREV_REDACTOR_URL=
BREV_REDACTOR_TOKEN=
BREV_REDACTOR_MODEL=...
```

If `KERNEL_API_KEY` is missing, SafeScreen uses a local Playwright Chromium browser. If `TZAFON_API_KEY` is missing or the Lightcone request fails and `TZAFON_MOCK_FALLBACK=true`, it uses the mock action sequence.

If `BREV_REDACTOR_URL` is set, SafeScreen calls that service for smart redaction. If it is missing or unavailable and `SAFE_SCREEN_REDACTOR_FALLBACK=true`, SafeScreen falls back to local rule-based redaction.

For a raw vLLM/OpenAI-compatible Qwen VL server, use:

```bash
SAFE_SCREEN_REDACTOR_MODE=brev
BREV_REDACTOR_API=vllm-chat
BREV_REDACTOR_URL=http://localhost:12434/v1
BREV_REDACTOR_MODEL=Qwen/Qwen3-VL-4B-Instruct
```

SafeScreen will call `/v1/chat/completions` and parse the model's JSON response into redaction boxes.

## Brev Redactor Contract

SafeScreen expects the Brev instance to expose:

```text
POST /redact
```

Request:

```json
{
  "model": "<value of BREV_REDACTOR_MODEL>",
  "policy": "Redact direct PII, credentials, financial data, health data, government IDs, private notes, and any field that could identify or expose a person.",
  "screenshot_base64": "...",
  "viewport": { "width": 1280, "height": 800 },
  "dom_text": [
    {
      "text": "anmol@example.com",
      "box": { "x": 420, "y": 260, "width": 320, "height": 44 },
      "tagName": "input",
      "id": "email",
      "name": "email",
      "type": "email"
    }
  ]
}
```

Response can be either `{ "redactions": [...] }`, `{ "items": [...] }`, or a raw array:

```json
{
  "redactions": [
    {
      "placeholder": "[MY_EMAIL]",
      "category": "email",
      "confidence": 0.98,
      "box": { "x": 420, "y": 260, "width": 320, "height": 44 },
      "domId": "email"
    }
  ]
}
```

If the service returns `domId`, `dom_id`, `id`, `name`, or exact `text`, SafeScreen can reuse the matching DOM box. If it returns `box`, `bounding_box`, or `bbox`, SafeScreen uses that box directly.

## Run

```bash
npm run demo
```

The demo writes:

- `artifacts/raw-step-1.png`
- `artifacts/redacted-step-1.png`

By default, the built-in demo form starts empty so the CUA flow can fill it. Set this to show the original prefilled redaction-proof page:

```bash
SAFE_SCREEN_DEMO_PREFILL=true
```

On every step, SafeScreen also sends Northstar a sanitized form-state summary such as `Email: empty`, `Email: [MY_EMAIL] (focused)`, or `Email: [MY_EMAIL]`. These summaries never include raw private values.

The mock CUA sequence does this:

1. Click the email field.
2. Type `[MY_EMAIL]`.
3. Click Submit.

Before the submit click, SafeScreen asks for console approval. Type `yes` to allow it.

If the real CUA model repeatedly clicks the focused email field during the hackathon demo, SafeScreen applies a small local progress override and converts the repeated click into typing `[MY_EMAIL]`. Disable that behavior with:

```bash
SAFE_SCREEN_DEMO_PROGRESS_OVERRIDE=false
```

## Verification Checklist

- Demo page opens.
- Raw screenshot contains the fake sensitive values.
- Redacted screenshot has the same dimensions and shows sticky-note placeholders.
- Console logs show only the redacted screenshot is sent to Lightcone/Northstar.
- Mock mode works without Tzafon credentials.
- Placeholder text is swapped locally before browser typing.
- Submit click requires console approval.

## Files

- `src/index.ts` orchestrates the demo loop.
- `src/kernelClient.ts` manages Kernel or local Playwright browser control.
- `src/redactor.ts` detects sensitive DOM text and draws sticky-note overlays.
- `src/tzafonClient.ts` calls Lightcone/Northstar or mock actions.
- `src/actionGuard.ts` validates and localizes model actions.
- `src/demoPage.ts` defines the local demo form and placeholder vault.
