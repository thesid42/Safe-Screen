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

For the 4-hour MVP, redaction is DOM-assisted rather than OCR-based. Playwright reads visible DOM text and bounding boxes from the browser, then `sharp` draws sticky-note overlays onto the screenshot while preserving the original dimensions and coordinate space.

Brev is not needed for the MVP. It is a future option if redaction moves from DOM-assisted detection to heavier OCR or vision models.

## Setup

```bash
npm install
cp .env.example .env
```

Set these values if you want cloud integrations:

```bash
KERNEL_API_KEY=...
TZAFON_API_KEY=...
LIGHTCONE_BASE_URL=
TZAFON_MOCK_FALLBACK=true
```

If `KERNEL_API_KEY` is missing, SafeScreen uses a local Playwright Chromium browser. If `TZAFON_API_KEY` is missing or the Lightcone request fails and `TZAFON_MOCK_FALLBACK=true`, it uses the mock action sequence.

## Run

```bash
npm run demo
```

The demo writes:

- `artifacts/raw-step-1.png`
- `artifacts/redacted-step-1.png`

The mock CUA sequence does this:

1. Click the email field.
2. Type `[MY_EMAIL]`.
3. Click Submit.

Before the submit click, SafeScreen asks for console approval. Type `yes` to allow it.

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
