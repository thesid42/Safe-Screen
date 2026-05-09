export type DemoScenario = "multistep" | "statement" | "profile" | "health";

export const DEFAULT_DEMO_SCENARIO: DemoScenario = "multistep";

export const DEMO_GOALS: Record<DemoScenario, string> = {
  multistep:
    "Complete the multi-step form. On Contact, fill full name [MY_NAME] and email [MY_EMAIL], then click Next. On Identity, fill phone [MY_PHONE], SSN [MY_SSN], and address [MY_ADDRESS], then click Next. On Payment, fill credit card [MY_CARD], then submit.",
  statement:
    "You received a redacted input image of an account statement. Make a privacy-safe spend analysis using only the visible non-sensitive details. Summarize deposits, outgoing payments, card payments, insurance payments, and any notable spending patterns. Do not click Download PDF. Do not reveal names, emails, phone numbers, SSNs, addresses, account numbers, card numbers, routing numbers, or transaction references. If a private value is needed, refer to its placeholder or category only. When done, answer with a brief spend analysis.",
  profile:
    "Review the customer profile using only the redacted screenshot. Do not reveal, copy, export, or type private values. Confirm that visible profile details, credentials, support notes, SSN, phone, email, address, card, and reset-token-like values are redacted with placeholders. If the page appears adequately redacted, wait.",
  health:
    "You are a HIPAA compliance reviewer. Using only the redacted screenshot, verify that every piece of Protected Health Information (PHI) on this patient record is covered by a SafeScreen placeholder. Check all sections: Patient Demographics (name, date of birth, SSN, MRN, phone, email, address, insurance ID), Clinical Information (diagnosis, clinical notes), Insurance & Billing (member ID, SSN, billing address), and Prescriptions (patient name on each row). Do not reveal, copy, export, or type any PHI values. Do not click any buttons. If every PHI field is masked with a sticky-note placeholder, report the page as compliant and wait. If any PHI is visible and unredacted, identify the field name only — never the value — and wait."
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
