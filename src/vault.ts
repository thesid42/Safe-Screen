import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export const PLACEHOLDERS = [
  "[MY_NAME]",
  "[MY_EMAIL]",
  "[MY_PHONE]",
  "[MY_SSN]",
  "[MY_ADDRESS]",
  "[MY_CARD]",
  "[MY_USERNAME]",
  "[MY_PASSWORD]"
] as const;

export type Placeholder = typeof PLACEHOLDERS[number];

const ENV_BY_PLACEHOLDER: Record<Placeholder, string> = {
  "[MY_NAME]": "SAFE_SCREEN_MY_NAME",
  "[MY_EMAIL]": "SAFE_SCREEN_MY_EMAIL",
  "[MY_PHONE]": "SAFE_SCREEN_MY_PHONE",
  "[MY_SSN]": "SAFE_SCREEN_MY_SSN",
  "[MY_ADDRESS]": "SAFE_SCREEN_MY_ADDRESS",
  "[MY_CARD]": "SAFE_SCREEN_MY_CARD",
  "[MY_USERNAME]": "SAFE_SCREEN_MY_USERNAME",
  "[MY_PASSWORD]": "SAFE_SCREEN_MY_PASSWORD"
};

const DEMO_DEFAULTS: Record<Placeholder, string> = {
  "[MY_NAME]": "Anmol Sharma",
  "[MY_EMAIL]": "anmol@example.com",
  "[MY_PHONE]": "925-555-1234",
  "[MY_SSN]": "123-45-6789",
  "[MY_ADDRESS]": "123 Main St, San Ramon, CA",
  "[MY_CARD]": "4111 1111 1111 1111",
  "[MY_USERNAME]": "tomsmith",
  "[MY_PASSWORD]": "SuperSecretPassword!"
};

const runtimeVault = new Map<Placeholder, string>();

export function getVaultSnapshot(options: { includeDemoDefaults?: boolean } = {}): Record<Placeholder, string> {
  return Object.fromEntries(
    PLACEHOLDERS.map((placeholder) => {
      const envValue = readEnvPlaceholder(placeholder);
      const runtimeValue = runtimeVault.get(placeholder);
      const fallback = options.includeDemoDefaults ? DEMO_DEFAULTS[placeholder] : "";
      return [placeholder, runtimeValue || envValue || fallback];
    })
  ) as Record<Placeholder, string>;
}

export function getKnownVaultValue(placeholder: Placeholder): string | undefined {
  return runtimeVault.get(placeholder) || readEnvPlaceholder(placeholder) || undefined;
}

export async function resolveVaultValue(placeholder: Placeholder): Promise<string> {
  const knownValue = getKnownVaultValue(placeholder);
  if (knownValue) {
    return knownValue;
  }

  if (process.env.SAFE_SCREEN_PROMPT_FOR_VALUES === "false") {
    throw new Error(`${placeholder} is missing. Set ${ENV_BY_PLACEHOLDER[placeholder]} or enable SAFE_SCREEN_PROMPT_FOR_VALUES.`);
  }

  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(`SafeScreen local vault: enter value for ${placeholder}: `);
    const value = answer.trim();
    if (!value) {
      throw new Error(`No value entered for ${placeholder}.`);
    }
    runtimeVault.set(placeholder, value);
    return value;
  } finally {
    rl.close();
  }
}

export function normalizePlaceholder(value: string): Placeholder | undefined {
  const bracketed = value.startsWith("[") ? value : `[${value}]`;
  return (PLACEHOLDERS as readonly string[]).includes(bracketed) ? bracketed as Placeholder : undefined;
}

function readEnvPlaceholder(placeholder: Placeholder): string {
  return process.env[ENV_BY_PLACEHOLDER[placeholder]]?.trim() ?? "";
}
