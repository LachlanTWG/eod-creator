// Signed OAuth state for mailbox connect (Gmail or Outlook).
// One connection = one (exec, client). Provider chosen at connect time.

import { createHmac } from "crypto";

export type MailboxProvider = "gmail" | "outlook";

function stateSecret(): string | null {
  return process.env.WEBHOOK_SECRET || process.env.EOD_ENTRY_SECRET || null;
}

export function nodeServiceBase(): string | null {
  const base = process.env.NODE_SERVICE_URL;
  if (!base) return null;
  return base.replace(/\/+$/, "");
}

export function isMailboxConnectConfigured(): boolean {
  return Boolean(stateSecret() && nodeServiceBase());
}

export function signMailboxOAuthState(payload: {
  userId: string;
  salesPersonName: string;
  provider: MailboxProvider;
  companyId: string;
  returnUrl: string;
  exp?: number;
}): string {
  const secret = stateSecret();
  if (!secret) throw new Error("WEBHOOK_SECRET / EOD_ENTRY_SECRET not configured");
  if (payload.provider !== "gmail" && payload.provider !== "outlook") {
    throw new Error(`Invalid provider: ${payload.provider}`);
  }
  if (!payload.companyId) throw new Error("companyId required");
  const body = Buffer.from(
    JSON.stringify({
      userId: payload.userId,
      salesPersonName: payload.salesPersonName,
      provider: payload.provider,
      companyId: payload.companyId,
      returnUrl: payload.returnUrl,
      exp: payload.exp ?? Date.now() + 15 * 60 * 1000,
    }),
  ).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function mailboxStartUrl(state: string): string {
  const base = nodeServiceBase();
  if (!base) throw new Error("NODE_SERVICE_URL not configured");
  return `${base}/oauth/mailbox/start?state=${encodeURIComponent(state)}`;
}
