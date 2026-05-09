import fs from "node:fs/promises";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createDemoPageHtml } from "./demoPage.js";
import type { DOMRectLike, SafeScreenAction, Viewport, VisibleDomText } from "./types.js";

type KernelSession = {
  session_id?: string;
  id?: string;
  cdp_ws_url?: string;
  browser_live_view_url?: string;
};

export class KernelClient {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private kernelSession?: KernelSession;

  constructor(
    private readonly viewport: Viewport = { width: 1280, height: 800 },
    private readonly headless = process.env.SAFE_SCREEN_HEADLESS === "true"
  ) {}

  async start(): Promise<void> {
    if (process.env.KERNEL_API_KEY) {
      await this.startKernelBrowser();
    } else {
      await this.startLocalBrowser();
    }

    const page = await this.getPage();
    await page.setViewportSize(this.viewport);
    await page.setContent(createDemoPageHtml(), { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => undefined);
  }

  async close(): Promise<void> {
    await this.browser?.close().catch(() => undefined);
  }

  getLiveViewUrl(): string | undefined {
    return this.kernelSession?.browser_live_view_url;
  }

  getViewport(): Viewport {
    return this.viewport;
  }

  async screenshot(path: string): Promise<Buffer> {
    await fs.mkdir("artifacts", { recursive: true });
    const page = await this.getPage();
    return page.screenshot({ path, fullPage: false });
  }

  async extractVisibleDomText(): Promise<VisibleDomText[]> {
    const page = await this.getPage();

    return page.evaluate(`
      (() => {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      const isVisible = (element, rect) => {
        const style = window.getComputedStyle(element);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom >= 0 &&
          rect.right >= 0 &&
          rect.top <= viewportHeight &&
          rect.left <= viewportWidth &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          Number(style.opacity || "1") > 0
        );
      };

      const clipRect = (rect) => {
        const x = Math.max(0, rect.left);
        const y = Math.max(0, rect.top);
        const right = Math.min(viewportWidth, rect.right);
        const bottom = Math.min(viewportHeight, rect.bottom);
        return {
          x,
          y,
          width: Math.max(0, right - x),
          height: Math.max(0, bottom - y)
        };
      };

      const results = [];
      const selector = "input, textarea, select, button, label, h1, h2, h3, p, span, div";

      for (const element of Array.from(document.querySelectorAll(selector))) {
        const rect = element.getBoundingClientRect();
        if (!isVisible(element, rect)) continue;

        const value = "value" in element ? element.value : "";
        const text = (value || element.textContent || "").replace(/\s+/g, " ").trim();
        if (!text) continue;

        const box = clipRect(rect);
        if (box.width === 0 || box.height === 0) continue;

        results.push({
          text,
          box,
          tagName: element.tagName.toLowerCase(),
          id: element.id || undefined,
          name: element.getAttribute("name") || undefined,
          type: element.getAttribute("type") || undefined
        });
      }

      return results;
      })()
    `) as Promise<VisibleDomText[]>;
  }

  async getElementBox(selector: string): Promise<DOMRectLike | undefined> {
    const page = await this.getPage();
    const locator = page.locator(selector).first();
    const box = await locator.boundingBox().catch(() => null);
    return box
      ? { x: box.x, y: box.y, width: box.width, height: box.height }
      : undefined;
  }

  async executeAction(action: SafeScreenAction): Promise<void> {
    const page = await this.getPage();

    switch (action.type) {
      case "click":
        await page.mouse.click(action.x, action.y, { button: "left" });
        return;
      case "type":
        await page.keyboard.type(action.text);
        return;
      case "scroll":
        await page.mouse.wheel(action.dx ?? 0, action.dy);
        return;
      case "key":
        await page.keyboard.press(action.key);
        return;
      case "wait":
        await page.waitForTimeout(action.ms);
        return;
    }
  }

  private async startKernelBrowser(): Promise<void> {
    const { default: Kernel } = await import("@onkernel/sdk");
    const client = new Kernel({ apiKey: process.env.KERNEL_API_KEY });
    const session = (await client.browsers.create({
      viewport: this.viewport,
      headless: this.headless
    } as never)) as KernelSession;

    if (!session.cdp_ws_url) {
      throw new Error("Kernel browser session did not return cdp_ws_url.");
    }

    this.kernelSession = session;
    this.browser = await chromium.connectOverCDP(session.cdp_ws_url);
    this.context = this.browser.contexts()[0] ?? (await this.browser.newContext({ viewport: this.viewport }));
    this.page = this.context.pages()[0] ?? (await this.context.newPage());
  }

  private async startLocalBrowser(): Promise<void> {
    this.browser = await chromium.launch({ headless: this.headless });
    this.context = await this.browser.newContext({ viewport: this.viewport });
    this.page = await this.context.newPage();
  }

  private async getPage(): Promise<Page> {
    if (!this.page) {
      throw new Error("KernelClient has not been started.");
    }

    return this.page;
  }
}
