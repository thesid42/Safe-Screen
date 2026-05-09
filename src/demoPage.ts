export const PLACEHOLDER_VAULT = {
  "[MY_NAME]": process.env.SAFE_SCREEN_MY_NAME || "Anmol Sharma",
  "[MY_EMAIL]": process.env.SAFE_SCREEN_MY_EMAIL || "anmol@example.com",
  "[MY_PHONE]": process.env.SAFE_SCREEN_MY_PHONE || "925-555-1234",
  "[MY_SSN]": process.env.SAFE_SCREEN_MY_SSN || "123-45-6789",
  "[MY_ADDRESS]": process.env.SAFE_SCREEN_MY_ADDRESS || "123 Main St, San Ramon, CA",
  "[MY_CARD]": process.env.SAFE_SCREEN_MY_CARD || "4111 1111 1111 1111"
} as const;

export type Placeholder = keyof typeof PLACEHOLDER_VAULT;

export function createDemoPageHtml(): string {
  const vault = PLACEHOLDER_VAULT;
  const prefill = process.env.SAFE_SCREEN_DEMO_PREFILL === "true";
  const value = (placeholder: Placeholder) => prefill ? vault[placeholder] : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SafeScreen Demo Form</title>
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
      h1 {
        margin: 0 0 8px;
        font-size: 32px;
        line-height: 1.15;
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
      form {
        display: grid;
        gap: 16px;
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
    </style>
  </head>
  <body>
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
            <input id="name" name="name" autocomplete="name" value="${value("[MY_NAME]")}" />
          </label>
          <label for="email">Email
            <input id="email" name="email" type="email" autocomplete="email" value="${value("[MY_EMAIL]")}" />
          </label>
          <div class="actions">
            <button id="next-contact" class="right" type="button" data-next>Next</button>
          </div>
        </fieldset>
        <fieldset data-step="1" hidden>
          <legend>Identity and address</legend>
          <label for="phone">Phone
            <input id="phone" name="phone" autocomplete="tel" value="${value("[MY_PHONE]")}" />
          </label>
          <label for="ssn">SSN
            <input id="ssn" name="ssn" value="${value("[MY_SSN]")}" />
          </label>
          <label for="address">Address
            <input id="address" name="address" autocomplete="street-address" value="${value("[MY_ADDRESS]")}" />
          </label>
          <div class="actions">
            <button id="back-identity" class="secondary" type="button" data-back>Back</button>
            <button id="next-identity" type="button" data-next>Next</button>
          </div>
        </fieldset>
        <fieldset data-step="2" hidden>
          <legend>Payment</legend>
          <label for="card">Credit card
            <input id="card" name="card" autocomplete="cc-number" value="${value("[MY_CARD]")}" />
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
    </script>
  </body>
</html>`;
}
