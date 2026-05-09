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
      form {
        display: grid;
        gap: 16px;
        padding: 24px;
        background: white;
        border: 1px solid #d9e2ec;
        border-radius: 8px;
        box-shadow: 0 12px 34px rgb(27 39 51 / 10%);
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
        justify-self: start;
        border: 0;
        border-radius: 6px;
        padding: 11px 18px;
        font: inherit;
        font-weight: 700;
        color: white;
        background: #2069d4;
        cursor: pointer;
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
      <h1>SafeScreen demo intake form</h1>
      <p>This page is used to test local placeholder filling with SafeScreen redaction.</p>
      <form id="safe-form">
        <label for="name">Full name
          <input id="name" name="name" autocomplete="name" value="${value("[MY_NAME]")}" />
        </label>
        <label for="email">Email
          <input id="email" name="email" type="email" autocomplete="email" value="${value("[MY_EMAIL]")}" />
        </label>
        <label for="phone">Phone
          <input id="phone" name="phone" autocomplete="tel" value="${value("[MY_PHONE]")}" />
        </label>
        <label for="ssn">SSN
          <input id="ssn" name="ssn" value="${value("[MY_SSN]")}" />
        </label>
        <label for="address">Address
          <input id="address" name="address" autocomplete="street-address" value="${value("[MY_ADDRESS]")}" />
        </label>
        <label for="card">Credit card
          <input id="card" name="card" autocomplete="cc-number" value="${value("[MY_CARD]")}" />
        </label>
        <button id="submit" type="submit">Submit</button>
        <div id="result" role="status" aria-live="polite"></div>
      </form>
    </main>
    <script>
      document.querySelector("#safe-form").addEventListener("submit", (event) => {
        event.preventDefault();
        document.querySelector("#result").textContent = "Submitted locally for demo.";
      });
    </script>
  </body>
</html>`;
}
