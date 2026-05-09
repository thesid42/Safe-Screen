export type DemoScenario = "multistep" | "statement" | "profile" | "health";

export const DEFAULT_DEMO_SCENARIO: DemoScenario = "multistep";

export const DEMO_GOALS: Record<DemoScenario, string> = {
  multistep:
    "Complete this multi-step form by operating the browser. Use placeholders only when typing private values. On the Contact step, enter [MY_NAME] for full name and [MY_EMAIL] for email, then click Next. On the Identity step, enter [MY_PHONE], [MY_SSN], and [MY_ADDRESS], then click Next. On the Payment step, enter [MY_CARD], then submit. Never type literal private values and never reveal what a placeholder stands for.",
  statement:
    "You received a redacted screenshot of an account statement. Do not operate the browser or click Download PDF. Create a privacy-safe spend analysis using only visible non-sensitive details. Summarize deposits, outgoing payments, card payments, insurance payments, and notable spending patterns. Do not reveal names, emails, phone numbers, SSNs, addresses, account numbers, card numbers, routing numbers, or transaction references. If a private value is needed, refer to its placeholder or category only. Answer with the brief spend analysis.",
  profile:
    "You received a redacted screenshot of a customer profile. Do not operate the browser, click, type, copy, or export anything. Describe what kind of page this is and give a privacy-safe redaction review. Confirm whether profile details, credentials, support notes, SSN, phone, email, address, card, and reset-token-like values appear covered by placeholders. Do not reveal or infer private values. Answer with a short page description and redaction status.",
  health:
    "You received a redacted screenshot of a patient record. Act as a HIPAA compliance reviewer, but do not operate the browser, click, type, copy, export, or reveal any PHI. Verify whether Protected Health Information appears covered by SafeScreen placeholders across Patient Demographics, Clinical Information, Insurance & Billing, and Prescriptions. Check for patient name, date of birth, SSN, MRN, phone, email, address, insurance ID, diagnosis, notes, member ID, billing address, and patient names in prescription rows. If any PHI appears unredacted, identify the field name only, never the value. Answer with a brief HIPAA redaction status."
};

export function normalizeDemoScenario(value: string | undefined): DemoScenario {
  const normalized = value?.trim().toLowerCase();

  if (normalized === "statement" || normalized === "account-statement") {
    return "statement";
  }

  if (normalized === "profile" || normalized === "profile-review") {
    return "profile";
  }

  if (normalized === "health" || normalized === "hipaa" || normalized === "health-record") {
    return "health";
  }

  return "multistep";
}

export function defaultGoalForScenario(value: string | undefined): string {
  return DEMO_GOALS[normalizeDemoScenario(value)];
}
