import "dotenv/config";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DEMO_GOALS, DEFAULT_DEMO_SCENARIO, normalizeDemoScenario } from "./demoScenarios.js";

type RunState = {
  running: boolean;
  exitCode?: number | null;
  startedAt?: string;
  endedAt?: string;
  scenario?: string;
  targetUrl?: string;
  goal?: string;
  kernelLiveUrl?: string;
  latestRaw?: string;
  latestRedacted?: string;
  logs: string[];
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const artifactsDir = path.join(repoRoot, "artifacts");
const port = Number.parseInt(process.env.SAFE_SCREEN_WEB_PORT ?? "8787", 10);
const clients = new Set<http.ServerResponse>();
const state: RunState = {
  running: false,
  logs: []
};

let child: ChildProcessWithoutNullStreams | undefined;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "GET" && url.pathname === "/") {
      return sendHtml(res);
    }

    if (req.method === "GET" && url.pathname === "/events") {
      return handleEvents(res);
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      return sendJson(res, publicState());
    }

    if (req.method === "GET" && url.pathname === "/api/prompts") {
      return sendJson(res, {
        defaultScenario: DEFAULT_DEMO_SCENARIO,
        goals: DEMO_GOALS
      });
    }

    if (req.method === "POST" && url.pathname === "/api/run") {
      const body = await readJson(req);
      startRun(body);
      return sendJson(res, publicState());
    }

    if (req.method === "POST" && url.pathname === "/api/approve") {
      child?.stdin.write("yes\n");
      appendLog("[web] Sent submit approval: yes");
      return sendJson(res, publicState());
    }

    if (req.method === "POST" && url.pathname === "/api/input") {
      const body = await readJson(req);
      const text = typeof body.text === "string" ? body.text : "";
      if (text) {
        child?.stdin.write(`${text}\n`);
        appendLog(`[web] Sent terminal input: ${"*".repeat(Math.min(text.length, 24))}`);
      }
      return sendJson(res, publicState());
    }

    if (req.method === "POST" && url.pathname === "/api/stop") {
      stopRun();
      return sendJson(res, publicState());
    }

    if (req.method === "GET" && url.pathname.startsWith("/artifacts/")) {
      return sendArtifact(url.pathname, res);
    }

    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  } catch (error) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: (error as Error).message }));
  }
});

server.listen(port, () => {
  console.log(`SafeScreen dashboard: http://localhost:${port}`);
});

function startRun(body: Record<string, unknown>): void {
  if (child) {
    throw new Error("A SafeScreen run is already active.");
  }

  fs.mkdirSync(artifactsDir, { recursive: true });

  const scenario = normalizeDemoScenario(stringValue(body.scenario) || process.env.SAFE_SCREEN_DEMO_SCENARIO);
  const targetUrl = stringValue(body.targetUrl);
  const goal = stringValue(body.goal) || (targetUrl ? "" : DEMO_GOALS[scenario]);
  const maxSteps = stringValue(body.maxSteps) || process.env.SAFE_SCREEN_MAX_STEPS || "16";
  const redactorMode = stringValue(body.redactorMode) || process.env.SAFE_SCREEN_REDACTOR_MODE || "brev";
  const allowFallback = Boolean(body.allowFallback);

  state.running = true;
  state.exitCode = undefined;
  state.startedAt = new Date().toISOString();
  state.endedAt = undefined;
  state.scenario = targetUrl ? "real-app" : scenario;
  state.targetUrl = targetUrl || undefined;
  state.goal = goal || undefined;
  state.kernelLiveUrl = undefined;
  state.latestRaw = undefined;
  state.latestRedacted = undefined;
  state.logs = [];

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SAFE_SCREEN_DEMO_SCENARIO: scenario,
    SAFE_SCREEN_MAX_STEPS: maxSteps,
    SAFE_SCREEN_REDACTOR_MODE: redactorMode,
    SAFE_SCREEN_ALLOW_REDACTOR_FALLBACK_TO_CUA: allowFallback ? "true" : process.env.SAFE_SCREEN_ALLOW_REDACTOR_FALLBACK_TO_CUA ?? "false"
  };

  if (targetUrl) env.SAFE_SCREEN_TARGET_URL = targetUrl;
  if (goal) env.SAFE_SCREEN_GOAL = goal;
  if (typeof body.headless === "boolean") env.SAFE_SCREEN_HEADLESS = body.headless ? "true" : "false";

  child = spawn("npm", ["run", "demo"], {
    cwd: repoRoot,
    env,
    stdio: ["pipe", "pipe", "pipe"]
  });

  appendLog(`[web] Started run: ${state.scenario}`);
  child.stdout.on("data", (chunk) => processOutput(chunk.toString()));
  child.stderr.on("data", (chunk) => processOutput(chunk.toString()));
  child.on("exit", (code) => {
    state.running = false;
    state.exitCode = code;
    state.endedAt = new Date().toISOString();
    appendLog(`[web] Run exited with code ${code}`);
    child = undefined;
    broadcast();
  });
}

function stopRun(): void {
  if (!child) return;
  appendLog("[web] Stopping run.");
  child.kill("SIGTERM");
}

function processOutput(output: string): void {
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    appendLog(line);

    const liveMatch = line.match(/Kernel live view:\s*(https?:\/\/\S+)/);
    if (liveMatch) state.kernelLiveUrl = liveMatch[1];

    const rawMatch = line.match(/Raw local screenshot saved:\s*(artifacts\/raw-step-\d+\.png)/);
    if (rawMatch) state.latestRaw = `/${rawMatch[1]}`;

    const redactedMatch = line.match(/Redacted screenshot saved:\s*(artifacts\/redacted-step-\d+\.png)/);
    if (redactedMatch) state.latestRedacted = `/${redactedMatch[1]}`;
  }

  broadcast();
}

function appendLog(line: string): void {
  state.logs.push(line);
  if (state.logs.length > 1000) state.logs.splice(0, state.logs.length - 1000);
  broadcast();
}

function publicState(): RunState {
  return { ...state, logs: [...state.logs] };
}

function handleEvents(res: http.ServerResponse): void {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });
  clients.add(res);
  res.write(`data: ${JSON.stringify(publicState())}\n\n`);
  res.on("close", () => clients.delete(res));
}

function broadcast(): void {
  const payload = `data: ${JSON.stringify(publicState())}\n\n`;
  for (const client of clients) {
    client.write(payload);
  }
}

function sendArtifact(urlPath: string, res: http.ServerResponse): void {
  const safePath = path.normalize(urlPath.replace(/^\/artifacts\//, ""));
  if (safePath.includes("..")) {
    res.writeHead(400);
    res.end("Bad artifact path");
    return;
  }

  const filePath = path.join(artifactsDir, safePath);
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("Missing artifact");
    return;
  }

  res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
  fs.createReadStream(filePath).pipe(res);
}

function sendJson(res: http.ServerResponse, value: unknown): void {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

function sendHtml(res: http.ServerResponse): void {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(DASHBOARD_HTML);
}

function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 64_000) reject(new Error("Request body too large."));
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body) as Record<string, unknown>);
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SafeScreen Dashboard</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&display=swap" rel="stylesheet">
    <style>
      :root {
        --bg: #09090b;
        --surface: rgba(24, 24, 27, 0.6);
        --surface-border: rgba(255, 255, 255, 0.08);
        --primary: #8b5cf6;
        --primary-hover: #7c3aed;
        --secondary: rgba(255, 255, 255, 0.1);
        --secondary-hover: rgba(255, 255, 255, 0.15);
        --text-main: #f8fafc;
        --text-muted: #94a3b8;
        --danger: #ef4444;
        --danger-hover: #dc2626;
        --success: #10b981;
        --font: 'Outfit', system-ui, sans-serif;
      }
      body {
        margin: 0;
        padding: 24px;
        min-height: 100vh;
        background: radial-gradient(circle at top right, #1e1b4b, var(--bg) 60%);
        color: var(--text-main);
        font-family: var(--font);
      }
      .topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 24px;
        padding-bottom: 20px;
        border-bottom: 1px solid var(--surface-border);
      }
      .title-block h1 {
        margin: 0;
        font-size: 32px;
        font-weight: 800;
        background: linear-gradient(to right, #a78bfa, #38bdf8);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        letter-spacing: -0.5px;
      }
      .title-block p {
        margin: 6px 0 0;
        color: var(--text-muted);
        font-size: 15px;
        font-weight: 300;
      }
      .layout {
        display: grid;
        grid-template-columns: 400px minmax(0, 1fr);
        gap: 24px;
        align-items: start;
      }
      section {
        background: var(--surface);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid var(--surface-border);
        border-radius: 16px;
        padding: 24px;
        box-shadow: 0 4px 30px rgba(0, 0, 0, 0.3);
        transition: transform 0.2s, box-shadow 0.2s;
      }
      section:hover {
        box-shadow: 0 8px 40px rgba(0, 0, 0, 0.4);
      }
      h2 {
        margin: 0 0 16px;
        font-size: 18px;
        font-weight: 600;
        color: #e2e8f0;
      }
      .stack {
        display: grid;
        gap: 20px;
      }
      .sidebar {
        position: sticky;
        top: 24px;
      }
      .field-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 120px;
        gap: 12px;
      }
      label {
        display: grid;
        gap: 8px;
        font-size: 14px;
        font-weight: 600;
        color: #cbd5e1;
      }
      input, select, textarea {
        box-sizing: border-box;
        width: 100%;
        background: rgba(0, 0, 0, 0.3);
        border: 1px solid var(--surface-border);
        border-radius: 8px;
        padding: 10px 14px;
        font: inherit;
        color: white;
        transition: all 0.2s;
      }
      input:focus, select:focus, textarea:focus {
        outline: none;
        border-color: var(--primary);
        box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.2);
      }
      textarea {
        min-height: 100px;
        resize: vertical;
      }
      button {
        border: 0;
        border-radius: 8px;
        padding: 12px 16px;
        font: inherit;
        font-weight: 600;
        color: white;
        background: linear-gradient(135deg, var(--primary), #4f46e5);
        cursor: pointer;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        text-shadow: 0 1px 2px rgba(0,0,0,0.2);
      }
      button:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(139, 92, 246, 0.4);
      }
      button:active {
        transform: translateY(0);
      }
      button.secondary {
        background: var(--secondary);
        box-shadow: none;
      }
      button.secondary:hover {
        background: var(--secondary-hover);
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      }
      button.danger {
        background: linear-gradient(135deg, var(--danger), #b91c1c);
      }
      button.danger:hover {
        box-shadow: 0 6px 20px rgba(239, 68, 68, 0.4);
      }
      .buttons {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
      }
      .small-buttons {
        display: flex;
        gap: 10px;
      }
      .small-buttons button {
        padding: 8px 12px;
        font-size: 13px;
      }
      .status {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 15px;
        font-weight: 600;
        padding: 8px 16px;
        background: var(--surface);
        border: 1px solid var(--surface-border);
        border-radius: 99px;
      }
      .dot {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: var(--text-muted);
        box-shadow: 0 0 8px rgba(0,0,0,0.5);
      }
      .dot.running {
        background: var(--success);
        box-shadow: 0 0 12px var(--success);
        animation: pulse 2s infinite;
      }
      @keyframes pulse {
        0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4); }
        70% { box-shadow: 0 0 0 10px rgba(16, 185, 129, 0); }
        100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
      }
      .screens {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 20px;
      }
      .shot {
        min-height: 280px;
        background: rgba(0, 0, 0, 0.4);
        border: 1px solid var(--surface-border);
        border-radius: 12px;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .shot img {
        display: block;
        width: 100%;
        max-height: 480px;
        object-fit: contain;
        transition: transform 0.3s;
      }
      .shot img:hover {
        transform: scale(1.02);
      }
      .empty {
        padding: 24px;
        color: var(--text-muted);
        font-style: italic;
      }
      iframe {
        width: 100%;
        height: 400px;
        border: 1px solid var(--surface-border);
        border-radius: 12px;
        background: rgba(0, 0, 0, 0.5);
      }
      pre {
        margin: 0;
        max-height: 400px;
        overflow: auto;
        padding: 16px;
        border-radius: 12px;
        color: #a5b4fc;
        background: rgba(0, 0, 0, 0.6);
        border: 1px solid var(--surface-border);
        font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
        font-size: 13px;
        line-height: 1.5;
        white-space: pre-wrap;
      }
      pre::-webkit-scrollbar { width: 8px; height: 8px; }
      pre::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); border-radius: 4px; }
      pre::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
      pre::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
      .hint {
        color: var(--text-muted);
        font-size: 13px;
        line-height: 1.4;
      }
      .check-row {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 14px;
        font-weight: 400;
        color: var(--text-main);
        cursor: pointer;
      }
      .check-row input {
        width: 18px;
        height: 18px;
        accent-color: var(--primary);
        cursor: pointer;
      }
      a {
        color: #38bdf8;
        text-decoration: none;
        transition: color 0.2s;
      }
      a:hover {
        color: #7dd3fc;
        text-decoration: underline;
      }
      @media (max-width: 1024px) {
        .layout, .screens { grid-template-columns: 1fr; }
        .sidebar { position: static; }
        .topbar { flex-direction: column; align-items: flex-start; gap: 16px; }
      }
    </style>
  </head>
  <body>
    <div class="topbar">
      <div class="title-block">
        <h1>SafeScreen Dashboard</h1>
        <p>Run demos, inspect raw/redacted artifacts, and watch the Kernel browser without sending unredacted screenshots to CUA.</p>
      </div>
      <div class="status"><span id="dot" class="dot"></span><span id="status">Idle</span></div>
    </div>
    <div class="layout">
      <div class="stack sidebar">
        <section class="stack">
          <h2>Run Setup</h2>
          <label>Built-in scenario
            <select id="scenario">
              <option value="multistep">Multi-step form</option>
              <option value="statement">Account statement</option>
              <option value="profile">Profile review</option>
              <option value="health">HIPAA Health Record</option>
            </select>
          </label>
          <label>Target URL (optional, overrides scenario)
            <input id="targetUrl" placeholder="https://example.com" />
          </label>
          <label>Goal
            <textarea id="goal" placeholder="Leave empty to use .env/default goal"></textarea>
          </label>
          <div class="small-buttons">
            <button id="loadScenarioPrompt" class="secondary" type="button">Use Scenario Prompt</button>
            <button id="clearGoal" class="secondary" type="button">Clear Prompt</button>
          </div>
          <div class="field-grid">
            <label>Redactor mode
              <select id="redactorMode">
                <option value="brev">Brev / vLLM</option>
                <option value="rules">Rules only</option>
                <option value="hybrid">Hybrid</option>
              </select>
            </label>
            <label>Max steps
              <input id="maxSteps" value="16" />
            </label>
          </div>
          <label class="check-row"><input id="allowFallback" type="checkbox" /> Allow Brev fallback screenshot to CUA</label>
          <label class="check-row"><input id="headless" type="checkbox" /> Headless browser</label>
          <div class="buttons">
            <button id="run">Start Session</button>
            <button id="stop" class="danger">Stop</button>
            <button id="approve" class="secondary">Approve Submit</button>
          </div>
          <label>Terminal input for vault prompts
            <input id="terminalInput" placeholder="Type value then Send" />
          </label>
          <button id="sendInput" class="secondary">Send Input</button>
          <p class="hint">The dashboard starts <code>npm run demo</code> with env overrides. Raw artifacts stay local under <code>artifacts/</code>.</p>
        </section>
      </div>
      <div class="stack">
        <section class="stack">
          <h2>Kernel Live Feed</h2>
          <a id="liveLink" href="#" target="_blank" rel="noreferrer">No Kernel live URL yet</a>
          <iframe id="liveFrame" title="Kernel live view"></iframe>
        </section>
        <section class="stack">
          <h2>Latest Screenshots</h2>
          <div class="screens">
            <div>
              <h2>Raw Local</h2>
              <div id="raw" class="shot"><div class="empty">Waiting for raw screenshot...</div></div>
            </div>
            <div>
              <h2>Redacted Sent To CUA</h2>
              <div id="redacted" class="shot"><div class="empty">Waiting for redacted screenshot...</div></div>
            </div>
          </div>
        </section>
        <section class="stack">
          <h2>Execution Logs</h2>
          <pre id="logs"></pre>
        </section>
      </div>
    </div>
    <script>
      const source = new EventSource('/events');
      let currentState = {};
      let promptTemplates = { goals: {} };

      fetch('/api/prompts')
        .then((response) => response.json())
        .then((data) => {
          promptTemplates = data;
          fillScenarioPrompt();
        });

      source.onmessage = (event) => {
        currentState = JSON.parse(event.data);
        render(currentState);
      };

      document.querySelector('#run').addEventListener('click', async () => {
        await post('/api/run', {
          scenario: document.querySelector('#scenario').value,
          targetUrl: document.querySelector('#targetUrl').value,
          goal: document.querySelector('#goal').value,
          maxSteps: document.querySelector('#maxSteps').value,
          redactorMode: document.querySelector('#redactorMode').value,
          allowFallback: document.querySelector('#allowFallback').checked,
          headless: document.querySelector('#headless').checked
        });
      });

      document.querySelector('#scenario').addEventListener('change', fillScenarioPrompt);
      document.querySelector('#loadScenarioPrompt').addEventListener('click', fillScenarioPrompt);
      document.querySelector('#clearGoal').addEventListener('click', () => {
        document.querySelector('#goal').value = '';
      });
      document.querySelector('#stop').addEventListener('click', () => post('/api/stop', {}));
      document.querySelector('#approve').addEventListener('click', () => post('/api/approve', {}));
      document.querySelector('#sendInput').addEventListener('click', async () => {
        const input = document.querySelector('#terminalInput');
        await post('/api/input', { text: input.value });
        input.value = '';
      });

      async function post(url, body) {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (!response.ok) alert(await response.text());
      }

      function fillScenarioPrompt() {
        const scenario = document.querySelector('#scenario').value;
        const goal = promptTemplates.goals && promptTemplates.goals[scenario];
        if (goal) document.querySelector('#goal').value = goal;
      }

      function render(state) {
        document.querySelector('#status').textContent = state.running ? 'Running' : 'Idle';
        document.querySelector('#dot').className = state.running ? 'dot running' : 'dot';
        document.querySelector('#logs').textContent = (state.logs || []).join('\\n');
        document.querySelector('#logs').scrollTop = document.querySelector('#logs').scrollHeight;
        renderShot('#raw', state.latestRaw);
        renderShot('#redacted', state.latestRedacted);

        const liveLink = document.querySelector('#liveLink');
        const liveFrame = document.querySelector('#liveFrame');
        if (state.kernelLiveUrl) {
          liveLink.textContent = state.kernelLiveUrl;
          liveLink.href = state.kernelLiveUrl;
          if (liveFrame.src !== state.kernelLiveUrl) liveFrame.src = state.kernelLiveUrl;
        } else {
          liveLink.textContent = 'No Kernel live URL yet';
          liveLink.removeAttribute('href');
          liveFrame.removeAttribute('src');
        }
      }

      function renderShot(selector, src) {
        const container = document.querySelector(selector);
        if (!src) {
          container.innerHTML = '<div class="empty">Waiting for screenshot...</div>';
          return;
        }
        const nextSrc = src + '?t=' + Date.now();
        const img = container.querySelector('img');
        if (img && img.dataset.path === src) {
          img.src = nextSrc;
          return;
        }
        container.innerHTML = '<img alt="screenshot" data-path="' + src + '" src="' + nextSrc + '" />';
      }
    </script>
  </body>
</html>`;
