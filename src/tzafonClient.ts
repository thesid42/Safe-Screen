import type { Redaction, SafeScreenAction, Viewport } from "./types.js";

type TzafonClientOptions = {
  viewport: Viewport;
  mockTargets: {
    emailBox?: { x: number; y: number; width: number; height: number };
    submitBox?: { x: number; y: number; width: number; height: number };
  };
};

type LightconeComputerCall = {
  type?: string;
  call_id?: string;
  action?: Record<string, unknown>;
};

export class TzafonClient {
  private previousResponseId?: string;
  private previousCallId?: string;
  private mockStep = 0;

  constructor(private readonly options: TzafonClientOptions) {}

  async nextAction(params: {
    goal: string;
    redactedScreenshotBase64: string;
    redactions: Redaction[];
  }): Promise<SafeScreenAction | undefined> {
    if (process.env.TZAFON_API_KEY) {
      try {
        return await this.nextLightconeAction(params);
      } catch (error) {
        if (process.env.TZAFON_MOCK_FALLBACK === "false") {
          throw error;
        }

        console.warn(`Lightcone call failed; falling back to mock action. ${(error as Error).message}`);
      }
    }

    return this.nextMockAction();
  }

  private async nextLightconeAction(params: {
    goal: string;
    redactedScreenshotBase64: string;
  }): Promise<SafeScreenAction | undefined> {
    const { default: Lightcone } = await import("@tzafon/lightcone");
    const model = requireEnv("TZAFON_MODEL");
    const client = new Lightcone({
      apiKey: process.env.TZAFON_API_KEY,
      baseURL: process.env.LIGHTCONE_BASE_URL || undefined
    });

    const imageUrl = `data:image/png;base64,${params.redactedScreenshotBase64}`;
    console.log("Sending only redacted screenshot data URL to Lightcone/Northstar.");

    const tool = {
      type: "computer_use" as const,
      display_width: this.options.viewport.width,
      display_height: this.options.viewport.height,
      environment: "browser" as const
    };

    const responses = client.responses as unknown as {
      create: (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
    };

    const response = this.previousResponseId && this.previousCallId
      ? await responses.create({
          model,
          previous_response_id: this.previousResponseId,
          tools: [tool],
          input: [
            {
              type: "computer_call_output",
              call_id: this.previousCallId,
              output: { type: "input_image", image_url: imageUrl, detail: "auto" }
            }
          ]
        })
      : await responses.create({
          model,
          instructions:
            "You operate a browser using only redacted screenshots. Use placeholders like [MY_EMAIL] when typing sensitive values. Do not ask to reveal, copy, print, or export private data.",
          tools: [tool],
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: params.goal },
                { type: "input_image", image_url: imageUrl, detail: "auto" }
              ]
            }
          ]
        });

    this.previousResponseId = typeof response.id === "string" ? response.id : undefined;

    const output = Array.isArray(response.output) ? response.output : [];
    const computerCall = output.find((item): item is LightconeComputerCall => {
      return Boolean(item && typeof item === "object" && (item as LightconeComputerCall).type === "computer_call");
    });

    if (!computerCall?.action) {
      return undefined;
    }

    this.previousCallId = computerCall.call_id;
    return this.normalizeLightconeAction(computerCall.action as Record<string, unknown>);
  }

  private normalizeLightconeAction(action: Record<string, unknown>): SafeScreenAction {
    const type = action.type;

    if (type === "click") {
      if (action.button === "right") {
        throw new Error("Blocked right-click action from Northstar.");
      }

      return {
        type: "click",
        x: this.denormalizeX(requireNumber(action.x, "x")),
        y: this.denormalizeY(requireNumber(action.y, "y")),
        button: "left"
      };
    }

    if (type === "type") {
      return { type: "type", text: requireString(action.text, "text") };
    }

    if (type === "scroll") {
      return {
        type: "scroll",
        dx: 0,
        dy: requireNumber(action.scroll_y ?? action.dy ?? 0, "scroll_y"),
        x: optionalNumber(action.x),
        y: optionalNumber(action.y)
      };
    }

    if (type === "key" || type === "keypress") {
      const key = Array.isArray(action.keys) ? action.keys.join("+") : action.keys ?? action.key;
      return { type: "key", key: requireString(key, "key") };
    }

    if (type === "wait") {
      return { type: "wait", ms: 1000 };
    }

    throw new Error(`Unsupported Northstar action type: ${String(type)}`);
  }

  private nextMockAction(): SafeScreenAction | undefined {
    this.mockStep += 1;

    if (this.mockStep === 1) {
      const emailBox = this.options.mockTargets.emailBox;
      if (!emailBox) throw new Error("Mock mode could not find email field coordinates.");
      return {
        type: "click",
        x: Math.round(emailBox.x + emailBox.width / 2),
        y: Math.round(emailBox.y + emailBox.height / 2),
        button: "left"
      };
    }

    if (this.mockStep === 2) {
      return { type: "type", text: "[MY_EMAIL]" };
    }

    if (this.mockStep === 3) {
      const submitBox = this.options.mockTargets.submitBox;
      if (!submitBox) throw new Error("Mock mode could not find submit button coordinates.");
      return {
        type: "click",
        x: Math.round(submitBox.x + submitBox.width / 2),
        y: Math.round(submitBox.y + submitBox.height / 2),
        button: "left"
      };
    }

    return undefined;
  }

  private denormalizeX(x: number): number {
    return x >= 0 && x <= 999 ? Math.round((x / 1000) * this.options.viewport.width) : Math.round(x);
  }

  private denormalizeY(y: number): number {
    return y >= 0 && y <= 999 ? Math.round((y / 1000) * this.options.viewport.height) : Math.round(y);
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

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be set when using Lightcone/Northstar.`);
  }

  return value;
}
