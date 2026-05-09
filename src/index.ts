import "dotenv/config";
import { guardAction } from "./actionGuard.js";
import { KernelClient } from "./kernelClient.js";
import { redactScreenshot } from "./redactor.js";
import { TzafonClient } from "./tzafonClient.js";
import type { DOMRectLike, RedactorOutput, SafeScreenAction, SanitizedFormField } from "./types.js";

const DEFAULT_GOAL =
  "Complete the multi-step form. On Contact, fill full name [MY_NAME] and email [MY_EMAIL], then click Next. On Identity, fill phone [MY_PHONE], SSN [MY_SSN], and address [MY_ADDRESS], then click Next. On Payment, fill credit card [MY_CARD], then submit.";

async function main(): Promise<void> {
  const kernel = new KernelClient();

  try {
    await kernel.start();

    const liveViewUrl = kernel.getLiveViewUrl();
    if (liveViewUrl) {
      console.log(`Kernel live view: ${liveViewUrl}`);
    } else {
      console.log("Using local Playwright browser fallback because KERNEL_API_KEY is not set.");
    }

    const goal = process.env.SAFE_SCREEN_GOAL?.trim() || DEFAULT_GOAL;
    console.log(`Goal: ${goal}`);

    const viewport = kernel.getViewport();
    let redacted = await captureAndRedactStep(kernel, 1);

    const emailBox = await kernel.getElementBox("#email");
    const submitBox = await kernel.getElementBox("#submit");
    const resultSelector = process.env.SAFE_SCREEN_RESULT_SELECTOR || "#result";
    const tzafon = new TzafonClient({
      viewport: redacted.viewport,
      mockTargets: { emailBox, submitBox }
    });

    const maxSteps = Number.parseInt(process.env.SAFE_SCREEN_MAX_STEPS ?? "16", 10);
    let lastModelAction: SafeScreenAction | undefined;
    let lastActionSummary: string | undefined;
    let didDemoPlaceholderType = false;

    for (let step = 1; step <= maxSteps; step += 1) {
      let modelAction = await tzafon.nextAction({
        goal,
        redactedScreenshotBase64: redacted.redactedScreenshotBase64,
        redactions: redacted.redactions,
        formState: redacted.formState,
        lastActionSummary
      });

      if (!modelAction) {
        console.log("No more CUA actions returned.");
        break;
      }

      const override = applyDemoProgressOverride(modelAction, lastModelAction, {
        emailBox,
        submitBox,
        didDemoPlaceholderType
      });
      modelAction = override.action;
      if (override.didPlaceholderType) {
        didDemoPlaceholderType = true;
      }
      lastModelAction = modelAction;

      console.log(`Step ${step} model action: ${JSON.stringify(modelAction)}`);
      const safeAction = await guardAction(modelAction, {
        viewport: redacted.viewport,
        submitBox
      });

      const actionForLog = safeAction.type === "type"
        ? { ...safeAction, text: safeAction.text.replace(/[^\s]/g, "*") }
        : safeAction;
      console.log(`Step ${step} guarded local action: ${JSON.stringify(actionForLog)}`);

      await kernel.executeAction(safeAction);
      await kernel.executeAction({ type: "wait", ms: 500 });
      lastActionSummary = summarizeModelAction(modelAction);

      if (safeAction.type === "click" && submitBox && pointInBox(safeAction.x, safeAction.y, submitBox)) {
        const resultText = await kernel.getText(resultSelector);
        if (resultText) {
          console.log(`Submit completed: ${resultText}`);
          break;
        }
      }

      if (step < maxSteps) {
        redacted = await captureAndRedactStep(kernel, step + 1);
      }
    }

    console.log("SafeScreen demo loop complete.");
  } finally {
    await kernel.close();
  }
}

function applyDemoProgressOverride(
  action: SafeScreenAction,
  previousAction: SafeScreenAction | undefined,
  context: {
    emailBox: DOMRectLike | undefined;
    submitBox: DOMRectLike | undefined;
    didDemoPlaceholderType: boolean;
  }
): { action: SafeScreenAction; didPlaceholderType: boolean } {
  if (process.env.SAFE_SCREEN_DEMO_PROGRESS_OVERRIDE === "false") {
    return { action, didPlaceholderType: false };
  }

  if (
    context.didDemoPlaceholderType &&
    action.type === "click" &&
    context.emailBox &&
    context.submitBox &&
    pointInBox(action.x, action.y, context.emailBox)
  ) {
    console.warn("Northstar clicked the email field after typing; demo progress override will click Submit.");
    return {
      action: {
        type: "click",
        x: Math.round(context.submitBox.x + context.submitBox.width / 2),
        y: Math.round(context.submitBox.y + context.submitBox.height / 2),
        button: "left"
      },
      didPlaceholderType: false
    };
  }

  if (
    action.type === "click" &&
    previousAction?.type === "click" &&
    context.emailBox &&
    pointInBox(action.x, action.y, context.emailBox) &&
    pointInBox(previousAction.x, previousAction.y, context.emailBox)
  ) {
    console.warn("Northstar repeated the email-field click; demo progress override will type [MY_EMAIL].");
    return { action: { type: "type", text: "[MY_EMAIL]" }, didPlaceholderType: true };
  }

  return { action, didPlaceholderType: false };
}

function pointInBox(x: number, y: number, box: DOMRectLike): boolean {
  return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function captureAndRedactStep(kernel: KernelClient, step: number): Promise<{
  redactedScreenshotBase64: RedactorOutput["redactedScreenshotBase64"];
  viewport: RedactorOutput["viewport"];
  redactions: RedactorOutput["redactions"];
  formState: SanitizedFormField[];
}> {
  const rawScreenshotPath = `artifacts/raw-step-${step}.png`;
  const redactedScreenshotPath = `artifacts/redacted-step-${step}.png`;
  const viewport = kernel.getViewport();

  await kernel.screenshot(rawScreenshotPath);
  console.log(`Raw local screenshot saved: ${rawScreenshotPath}`);

  const domText = await kernel.extractVisibleDomText();
  const redacted = await redactScreenshot(rawScreenshotPath, domText, viewport, redactedScreenshotPath);
  const formState = await kernel.extractSanitizedFormState();
  console.log(`Redacted screenshot saved: ${redacted.redactedScreenshotPath}`);
  console.log(`Redactions applied: ${redacted.redactions.map((item) => {
    return `${item.placeholder}${item.detector ? `/${item.detector}` : ""}`;
  }).join(", ") || "none"}`);
  console.log(`Sanitized form state: ${formatFormState(formState)}`);

  return { ...redacted, formState };
}

function summarizeModelAction(action: SafeScreenAction): string {
  if (action.type === "type") {
    return `Typed ${action.text} into the focused field.`;
  }

  if (action.type === "click") {
    return `Clicked at (${Math.round(action.x)}, ${Math.round(action.y)}).`;
  }

  return `Executed ${action.type}.`;
}

function formatFormState(formState: SanitizedFormField[]): string {
  return formState.map((field) => {
    const value = field.status === "filled" ? field.valueLabel ?? "[FILLED]" : "empty";
    return `${field.label}: ${value}${field.focused ? " (focused)" : ""}`;
  }).join("; ") || "no fields";
}
