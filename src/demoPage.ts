import { getVaultSnapshot, type Placeholder } from "./vault.js";
import { normalizeDemoScenario } from "./demoScenarios.js";

export function createDemoPageHtml(): string {
  const scenario = normalizeDemoScenario(process.env.SAFE_SCREEN_DEMO_SCENARIO);

  if (scenario === "statement") {
    return wrapDemoPage("SafeScreen account statement", createAccountStatementHtml());
  }

  if (scenario === "profile") {
    return wrapDemoPage("SafeScreen profile review", createProfileReviewHtml());
  }

  return wrapDemoPage("SafeScreen multi-step intake", createMultiStepFormHtml());
}

function createMultiStepFormHtml(): string {
  const vault = getVaultSnapshot({ includeDemoDefaults: true });
  const prefill = process.env.SAFE_SCREEN_DEMO_PREFILL === "true";
  const value = (placeholder: Placeholder) => prefill ? vault[placeholder] : "";

  return `
    <main>
      <h1>SafeScreen multi-step intake</h1>
      <p>This multi-step form tests placeholder filling, redaction, and progress state across screens.</p>
      <div class="stepper" aria-label="Progress">
        <span class="step-pill" data-step-pill="0" data-active="true">Contact</span>
        <span class="step-pill" data-step-pill="1">Identity</span>
        <span class="step-pill" data-step-pill="2">Payment</span>
      </div>
      <form id="safe-form">
        <fieldset data-step="0">
          <legend>Contact details</legend>
          <label for="name">Full name
            <input id="name" name="name" autocomplete="name" value="${escapeHtml(value("[MY_NAME]"))}" />
          </label>
          <label for="email">Email
            <input id="email" name="email" type="email" autocomplete="email" value="${escapeHtml(value("[MY_EMAIL]"))}" />
          </label>
          <div class="actions">
            <button id="next-contact" class="right" type="button" data-next>Next</button>
          </div>
        </fieldset>
        <fieldset data-step="1" hidden>
          <legend>Identity and address</legend>
          <label for="phone">Phone
            <input id="phone" name="phone" autocomplete="tel" value="${escapeHtml(value("[MY_PHONE]"))}" />
          </label>
          <label for="ssn">SSN
            <input id="ssn" name="ssn" value="${escapeHtml(value("[MY_SSN]"))}" />
          </label>
          <label for="address">Address
            <input id="address" name="address" autocomplete="street-address" value="${escapeHtml(value("[MY_ADDRESS]"))}" />
          </label>
          <div class="actions">
            <button id="back-identity" class="secondary" type="button" data-back>Back</button>
            <button id="next-identity" type="button" data-next>Next</button>
          </div>
        </fieldset>
        <fieldset data-step="2" hidden>
          <legend>Payment</legend>
          <label for="card">Credit card
            <input id="card" name="card" autocomplete="cc-number" value="${escapeHtml(value("[MY_CARD]"))}" />
          </label>
          <div class="actions">
            <button id="back-payment" class="secondary" type="button" data-back>Back</button>
            <button id="submit" type="submit">Submit</button>
          </div>
        </fieldset>
        <div id="result" role="status" aria-live="polite"></div>
      </form>
    </main>
    <script>
      const steps = Array.from(document.querySelectorAll("[data-step]"));
      const pills = Array.from(document.querySelectorAll("[data-step-pill]"));
      let currentStep = 0;

      function showStep(index) {
        currentStep = Math.max(0, Math.min(index, steps.length - 1));
        steps.forEach((step, stepIndex) => {
          step.hidden = stepIndex !== currentStep;
        });
        pills.forEach((pill, pillIndex) => {
          pill.dataset.active = String(pillIndex === currentStep);
        });
      }

      document.querySelectorAll("[data-next]").forEach((button) => {
        button.addEventListener("click", () => showStep(currentStep + 1));
      });

      document.querySelectorAll("[data-back]").forEach((button) => {
        button.addEventListener("click", () => showStep(currentStep - 1));
      });

      document.querySelector("#safe-form").addEventListener("submit", (event) => {
        event.preventDefault();
        document.querySelector("#result").textContent = "Submitted locally for demo.";
      });
    </script>`;
}

function createAccountStatementHtml(): string {
  const vault = getVaultSnapshot({ includeDemoDefaults: true });

  return `
    <main class="wide">
      <h1>Account statement</h1>
      <p>Read-only financial page for testing redaction across tables, cards, and account metadata.</p>
      <section class="panel">
        <div class="statement-header">
          <div>
            <span class="kicker">Statement period</span>
            <h2>April 1 - April 30, 2026</h2>
          </div>
          <button id="download" type="button">Download PDF</button>
        </div>
        <div class="summary-grid">
          <div><span>Account holder</span><strong>${escapeHtml(vault["[MY_NAME]"])}</strong></div>
          <div><span>Email</span><strong>${escapeHtml(vault["[MY_EMAIL]"])}</strong></div>
          <div><span>Phone</span><strong>${escapeHtml(vault["[MY_PHONE]"])}</strong></div>
          <div><span>SSN on file</span><strong>${escapeHtml(vault["[MY_SSN]"])}</strong></div>
          <div><span>Checking account</span><strong>9876543210</strong></div>
          <div><span>Routing number</span><strong>121000248</strong></div>
          <div><span>Billing address</span><strong>${escapeHtml(vault["[MY_ADDRESS]"])}</strong></div>
          <div><span>Card ending</span><strong>${escapeHtml(vault["[MY_CARD]"])}</strong></div>
        </div>
      </section>
      <section class="panel">
        <h2>Transactions</h2>
        <table>
          <thead>
            <tr><th>Date</th><th>Description</th><th>Reference</th><th>Amount</th></tr>
          </thead>
          <tbody>
            <tr><td>Apr 02</td><td>Payroll deposit</td><td>ACH 55392001</td><td>$4,250.00</td></tr>
            <tr><td>Apr 08</td><td>Card payment ${escapeHtml(vault["[MY_CARD]"])}</td><td>PMT 44091</td><td>-$740.12</td></tr>
            <tr><td>Apr 12</td><td>Wire to ${escapeHtml(vault["[MY_NAME]"])}</td><td>ACCT 9876543210</td><td>-$1,200.00</td></tr>
            <tr><td>Apr 19</td><td>Insurance autopay</td><td>POLICY HZ-882914</td><td>-$188.40</td></tr>
          </tbody>
        </table>
      </section>
      <div id="result" role="status">Statement loaded.</div>
    </main>`;
}

function createProfileReviewHtml(): string {
  const vault = getVaultSnapshot({ includeDemoDefaults: true });

  return `
    <main>
      <h1>Customer profile review</h1>
      <p>Mixed layout for testing redaction of profile details, credentials, and support notes.</p>
      <section class="panel profile">
        <div class="avatar">AS</div>
        <div>
          <h2>${escapeHtml(vault["[MY_NAME]"])}</h2>
          <p>${escapeHtml(vault["[MY_ADDRESS]"])}</p>
        </div>
      </section>
      <section class="panel details">
        <dl>
          <div><dt>Username</dt><dd>${escapeHtml(vault["[MY_USERNAME]"])}</dd></div>
          <div><dt>Password reset token</dt><dd>reset_9u1Azz_44_private</dd></div>
          <div><dt>Email</dt><dd>${escapeHtml(vault["[MY_EMAIL]"])}</dd></div>
          <div><dt>Phone</dt><dd>${escapeHtml(vault["[MY_PHONE]"])}</dd></div>
          <div><dt>SSN</dt><dd>${escapeHtml(vault["[MY_SSN]"])}</dd></div>
          <div><dt>Credit card</dt><dd>${escapeHtml(vault["[MY_CARD]"])}</dd></div>
        </dl>
      </section>
      <section class="panel note">
        <h2>Support note</h2>
        <p>Customer asked to verify identity using ${escapeHtml(vault["[MY_SSN]"])} and callback at ${escapeHtml(vault["[MY_PHONE]"])} before updating billing card ${escapeHtml(vault["[MY_CARD]"])}.</p>
      </section>
      <div id="result" role="status">Profile loaded.</div>
    </main>`;
}

function wrapDemoPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f4f7fb;
        color: #1b2733;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: start center;
        padding: 48px 24px;
      }
      main {
        width: min(760px, calc(100vw - 48px));
      }
      main.wide {
        width: min(980px, calc(100vw - 48px));
      }
      h1 {
        margin: 0 0 8px;
        font-size: 32px;
        line-height: 1.15;
      }
      h2 {
        margin: 0 0 12px;
        font-size: 20px;
      }
      p {
        margin: 0 0 24px;
        color: #506070;
      }
      .stepper {
        display: flex;
        gap: 8px;
        margin-bottom: 14px;
      }
      .step-pill {
        border: 1px solid #c9d4df;
        border-radius: 999px;
        padding: 5px 10px;
        font-size: 13px;
        font-weight: 700;
        color: #506070;
        background: #ffffff;
      }
      .step-pill[data-active="true"] {
        border-color: #2069d4;
        color: #0f55b8;
        background: #e9f1ff;
      }
      form,
      .panel {
        display: grid;
        gap: 16px;
        margin: 0 0 18px;
        padding: 24px;
        background: white;
        border: 1px solid #d9e2ec;
        border-radius: 8px;
        box-shadow: 0 12px 34px rgb(27 39 51 / 10%);
      }
      fieldset {
        display: grid;
        gap: 16px;
        margin: 0;
        padding: 0;
        border: 0;
      }
      fieldset[hidden] {
        display: none;
      }
      legend {
        margin: 0 0 2px;
        padding: 0;
        font-size: 18px;
        font-weight: 800;
        color: #1b2733;
      }
      label {
        display: grid;
        gap: 6px;
        font-size: 14px;
        font-weight: 650;
        color: #334455;
      }
      input {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid #b8c4d0;
        border-radius: 6px;
        padding: 12px 13px;
        font: inherit;
        background: #fbfdff;
        color: #13202c;
      }
      input:focus {
        border-color: #2d6cdf;
        outline: 3px solid rgb(45 108 223 / 18%);
        background: white;
      }
      button {
        border: 0;
        border-radius: 6px;
        padding: 11px 18px;
        font: inherit;
        font-weight: 700;
        color: white;
        background: #2069d4;
        cursor: pointer;
      }
      button.secondary {
        color: #1b2733;
        background: #e7edf4;
      }
      .actions {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        min-height: 43px;
      }
      .actions .right {
        margin-left: auto;
      }
      #result {
        min-height: 22px;
        font-size: 14px;
        color: #1f7a4d;
        font-weight: 650;
      }
      .statement-header,
      .profile {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
      }
      .summary-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
      }
      .summary-grid div {
        display: grid;
        gap: 4px;
        padding: 12px;
        border: 1px solid #dbe5ef;
        border-radius: 6px;
        background: #f9fbfe;
      }
      .summary-grid span,
      .kicker,
      dt {
        color: #637487;
        font-size: 13px;
        font-weight: 700;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th,
      td {
        border-bottom: 1px solid #e1e8f0;
        padding: 10px 8px;
        text-align: left;
      }
      th {
        color: #435466;
        font-size: 13px;
      }
      .avatar {
        display: grid;
        place-items: center;
        width: 54px;
        height: 54px;
        border-radius: 50%;
        color: white;
        background: #2069d4;
        font-weight: 800;
      }
      dl {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
        margin: 0;
      }
      dl div {
        display: grid;
        gap: 5px;
      }
      dd {
        margin: 0;
        font-weight: 700;
      }
      .note p {
        margin: 0;
        line-height: 1.55;
      }
    </style>
  </head>
  <body>
    ${body}
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
