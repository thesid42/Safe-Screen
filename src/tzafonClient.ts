import type { Redaction, SafeScreenAction, SanitizedFormField, Viewport } from "./types.js";

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

type LightconeOutputItem = {
  type?: string;
  call_id?: string;
  action?: Record<string, unknown>;
  content?: unknown;
  summary?: unknown;
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
    formState: SanitizedFormField[];
    lastActionSummary?: string;
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
    formState: SanitizedFormField[];
    lastActionSummary?: string;
  }): Promise<SafeScreenAction | undefined> {
    const { default: Lightcone } = await import("@tzafon/lightcone");
    const model = requireEnv("TZAFON_MODEL");
    const client = new Lightcone({
      apiKey: process.env.TZAFON_API_KEY,
      baseURL: process.env.LIGHTCONE_BASE_URL || undefined
    });

    const imageUrl = `data:image/png;base64,${params.redactedScreenshotBase64}`;
    console.log("Sending only redacted screenshot data URL to Lightcone/Northstar.");
    const safeStateText = buildSafeStateText(params.formState, params.lastActionSummary);

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
            },
            {
              role: "user",
              content: [
                { type: "input_text", text: safeStateText },
                { type: "input_image", image_url: imageUrl, detail: "auto" }
              ]
            }
          ]
        })
      : shouldAnswerWithoutBrowserTool(params.goal, params.formState)
        ? await responses.create({
            model,
            instructions:
              "You review a redacted browser screenshot. Answer directly using only visible non-sensitive details. Do not request browser actions. Do not reveal, copy, print, export, or infer private values. If a value is private, refer to its placeholder or category only.",
            input: [
              {
                role: "user",
                content: [
                  { type: "input_text", text: `${params.goal}\n\n${safeStateText}` },
                  { type: "input_image", image_url: imageUrl, detail: "auto" }
                ]
              }
            ]
          })
      : await responses.create({
          model,
          instructions:
            "You operate a browser using only redacted screenshots. Use at most one GUI action per turn when interaction is needed. If the task is complete or asks for a summary, analysis, or final response, answer directly instead of taking a GUI action. When a target text field is focused, type the requested placeholder including brackets, for example [MY_EMAIL] or [MY_PASSWORD], never literal credentials. Do not ask to reveal, copy, print, export, or inspect private data.",
          tools: [tool],
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: `${params.goal}\n\n${safeStateText}` },
                { type: "input_image", image_url: imageUrl, detail: "auto" }
              ]
            }
          ]
        });

    this.previousResponseId = typeof response.id === "string" ? response.id : undefined;

    const output = Array.isArray(response.output) ? response.output : [];
    const answerText = extractLightconeAnswer(response, output);
    const computerCall = output.find((item): item is LightconeComputerCall => {
      return Boolean(item && typeof item === "object" && (item as LightconeComputerCall).type === "computer_call");
    });

    if (!computerCall?.action) {
      if (answerText) {
        return { type: "answer", text: answerText };
      }

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
      return { type: "key", key: normalizeKeyboardKey(requireString(key, "key")) };
    }

    if (type === "wait") {
      return { type: "wait", ms: 1000 };
    }

    if (type === "answer" || type === "done" || type === "final" || type === "respond") {
      const text = action.text ?? action.answer ?? action.result ?? action.message ?? "Done.";
      return { type: "answer", text: requireString(text, "text") };
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

function buildSafeStateText(formState: SanitizedFormField[], lastActionSummary?: string): string {
  const fields = formState.map((field) => {
    const identity = field.label || field.name || field.id || "field";
    const value = field.status === "filled" ? field.valueLabel ?? "[FILLED]" : "empty";
    const focused = field.focused ? ", focused" : "";
    return `- ${identity}: ${value}${focused}`;
  });

    return [
      "SafeScreen sanitized page state. Values are placeholders only; never ask for real private values.",
      lastActionSummary ? `Last executed action: ${lastActionSummary}` : "Last executed action: none.",
      "Fields:",
      fields.length ? fields.join("\n") : "- no form fields detected",
      "Choose the next GUI action only when interaction is needed. Fill visible empty fields requested by the current step using placeholders only, including brackets like [MY_EMAIL] or [MY_PASSWORD]. If a target field is focused and empty, type its placeholder. Use Next to move between steps. Submit only on the final step after all requested visible fields are filled. If the task asks for analysis or the work is complete, answer with the privacy-safe result."
  ].join("\n");
}

function shouldAnswerWithoutBrowserTool(goal: string, formState: SanitizedFormField[]): boolean {
  const normalizedGoal = goal.toLowerCase();
  const actionGoal = normalizedGoal
    .replace(/\bdo not\b[^.?!]*/g, "")
    .replace(/\bdon't\b[^.?!]*/g, "");
  const asksForInteraction = /\b(click|type|fill|complete|submit|login|sign in|press|select|choose|open|download|upload|scroll)\b/.test(actionGoal);
  const asksForAnswer = /\b(answer|summari[sz]e|summary|analysis|analyze|describe|review|confirm|identify|what is|what's|explain)\b/.test(normalizedGoal);
  const hasActionableFields = formState.some((field) => field.status === "empty");

  return asksForAnswer && !asksForInteraction && !hasActionableFields;
}

function normalizeKeyboardKey(key: string): string {
  const trimmed = key.trim();
  const lower = trimmed.toLowerCase();
  const aliases: Record<string, string> = {
    return: "Enter",
    esc: "Escape",
    space: " ",
    pgdn: "PageDown",
    pgup: "PageUp",
    next: "PageDown",
    prior: "PageUp",
    left: "ArrowLeft",
    right: "ArrowRight",
    up: "ArrowUp",
    down: "ArrowDown"
  };

  return aliases[lower] ?? trimmed;
}

function extractLightconeAnswer(response: Record<string, unknown>, output: unknown[]): string | undefined {
  const directText = typeof response.output_text === "string" ? response.output_text.trim() : "";
  if (directText) {
    return directText;
  }

  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const outputItem = item as LightconeOutputItem;
    if (outputItem.type === "message" || outputItem.type === "reasoning") {
      chunks.push(...extractContentText(outputItem.content));
      chunks.push(...extractContentText(outputItem.summary));
    }
  }

  const answer = chunks.map((chunk) => chunk.trim()).filter(Boolean).join("\n\n");
  return answer || undefined;
}

function extractContentText(content: unknown): string[] {
  if (!content) {
    return [];
  }

  if (typeof content === "string") {
    return [content];
  }

  if (Array.isArray(content)) {
    return content.flatMap((item) => extractContentText(item));
  }

  if (typeof content === "object") {
    const record = content as Record<string, unknown>;
    const text = record.text ?? record.output_text;
    if (typeof text === "string") {
      return [text];
    }
  }

  return [];
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
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
