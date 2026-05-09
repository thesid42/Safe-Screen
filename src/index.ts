import "dotenv/config";
import { guardAction } from "./actionGuard.js";
import { KernelClient } from "./kernelClient.js";
import { redactScreenshot } from "./redactor.js";
import { TzafonClient } from "./tzafonClient.js";

const RAW_SCREENSHOT_PATH = "artifacts/raw-step-1.png";
const GOAL = "Fill the email field with [MY_EMAIL], then submit the form.";

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

    await kernel.screenshot(RAW_SCREENSHOT_PATH);
    console.log(`Raw local screenshot saved: ${RAW_SCREENSHOT_PATH}`);

    const viewport = kernel.getViewport();
    const domText = await kernel.extractVisibleDomText();
    const redacted = await redactScreenshot(RAW_SCREENSHOT_PATH, domText, viewport);
    console.log(`Redacted screenshot saved: ${redacted.redactedScreenshotPath}`);
    console.log(`Redactions applied: ${redacted.redactions.map((item) => item.placeholder).join(", ")}`);

    const emailBox = await kernel.getElementBox("#email");
    const submitBox = await kernel.getElementBox("#submit");
    const tzafon = new TzafonClient({
      viewport: redacted.viewport,
      mockTargets: { emailBox, submitBox }
    });

    const maxSteps = Number.parseInt(process.env.SAFE_SCREEN_MAX_STEPS ?? "3", 10);

    for (let step = 1; step <= maxSteps; step += 1) {
      const modelAction = await tzafon.nextAction({
        goal: GOAL,
        redactedScreenshotBase64: redacted.redactedScreenshotBase64,
        redactions: redacted.redactions
      });

      if (!modelAction) {
        console.log("No more CUA actions returned.");
        break;
      }

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
    }

    console.log("SafeScreen demo loop complete.");
  } finally {
    await kernel.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
