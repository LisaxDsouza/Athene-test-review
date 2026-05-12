// ============================================================
// nodes/action-executor.ts — Executes approved write actions
//
// This node runs AFTER an action has been approved by a human.
// It reads pending_write_action from state, dispatches to the
// appropriate integration, and stores the result or error.
// ============================================================

import type { AtheneStateType, AtheneStateUpdate } from "../state";
import { sendEmail } from "@/lib/integrations/microsoft/outlook-fetcher";
import type { EmailDraft } from "@/lib/integrations/microsoft/outlook-fetcher";
import { createEvent } from "@/lib/integrations/microsoft/calendar-fetcher";
import type { EventDraft } from "@/lib/integrations/microsoft/calendar-fetcher";
import { sendEmail as gmailSendEmail } from "@/lib/integrations/google/gmail-fetcher";
import { createCalendarEvent } from "@/lib/integrations/google/calendar-fetcher";
import type { EventDraft as GoogleEventDraft } from "@/lib/integrations/google/calendar-fetcher";
import { supabaseAdmin } from "@/lib/supabase/server";
import { qstash } from "@/lib/qstash/client";
import { getAppBaseUrl } from "@/lib/config/app-url";

type PendingWriteAction = {
  tool: string;
  payload: Record<string, unknown>;
  requested_at: string;
};

// state.org_id is already the Supabase UUID — no Clerk→UUID lookup needed

async function resolveMicrosoftConnectionId(orgUuid: string): Promise<string> {
  const { data: connectionRow, error: connectionError } = await supabaseAdmin
    .from("nango_connections")
    .select("connection_id")
    .eq("org_id", orgUuid)
    .eq("provider_config_key", "microsoft")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (connectionError) {
    throw new Error(`Failed to resolve Microsoft connection: ${connectionError.message}`);
  }
  if (!connectionRow?.connection_id) {
    throw new Error("No Microsoft connection configured for this organization");
  }

  return connectionRow.connection_id;
}

async function resolveGoogleConnectionId(orgUuid: string, providerKey: 'gmail' | 'google-calendar' | 'google'): Promise<string> {
  const keysToTry = providerKey === 'google' ? ['google'] : [providerKey, 'google'];

  for (const key of keysToTry) {
    const { data: connectionRow, error: connectionError } = await supabaseAdmin
      .from("nango_connections")
      .select("connection_id")
      .eq("org_id", orgUuid)
      .eq("provider_config_key", key)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (connectionError) {
      throw new Error(`Failed to resolve Google connection: ${connectionError.message}`);
    }
    if (connectionRow?.connection_id) {
      return connectionRow.connection_id;
    }
  }

  throw new Error("No Google connection configured for this organization");
}

function toEmailDraft(payload: Record<string, unknown>): EmailDraft {
  const to = Array.isArray(payload.to) ? payload.to.filter((value): value is string => typeof value === "string") : [];
  const cc = Array.isArray(payload.cc) ? payload.cc.filter((value): value is string => typeof value === "string") : [];
  const subject = typeof payload.subject === "string" ? payload.subject : "";
  const body = typeof payload.body === "string" ? payload.body : "";

  if (to.length === 0) {
    throw new Error("Approved email draft is missing recipients");
  }

  return {
    subject,
    body: {
      contentType: "Text",
      content: body,
    },
    toRecipients: to.map((address) => ({
      emailAddress: { address },
    })),
    ccRecipients: cc.map((address) => ({
      emailAddress: { address },
    })),
  };
}

/**
 * Converts the agent payload (same shape as the Microsoft email payload)
 * into a base64url-encoded RFC 2822 message for the Gmail send API.
 */
function toGmailRaw(payload: Record<string, unknown>): string {
  const to = Array.isArray(payload.to) ? payload.to.filter((v): v is string => typeof v === "string") : [];
  const cc = Array.isArray(payload.cc) ? payload.cc.filter((v): v is string => typeof v === "string") : [];
  const subject = typeof payload.subject === "string" ? payload.subject : "";
  const body = typeof payload.body === "string" ? payload.body : "";

  if (to.length === 0) {
    throw new Error("Approved email draft is missing recipients");
  }

  const lines: string[] = [
    `To: ${to.join(", ")}`,
  ];
  if (cc.length > 0) {
    lines.push(`Cc: ${cc.join(", ")}`);
  }
  lines.push(`Subject: ${subject}`, "Content-Type: text/plain; charset=utf-8", "", body);

  const message = lines.join("\r\n");
  // Gmail requires base64url encoding (no padding)
  return Buffer.from(message).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function toGoogleEventDraft(payload: Record<string, unknown>): GoogleEventDraft {
  const summary = typeof payload.summary === "string" ? payload.summary : "";
  const description = typeof payload.description === "string" ? payload.description : undefined;
  const location = typeof payload.location === "string" ? payload.location : undefined;
  const start = payload.start as { dateTime?: unknown; timeZone?: unknown } | undefined;
  const end = payload.end as { dateTime?: unknown; timeZone?: unknown } | undefined;
  const attendees = Array.isArray(payload.attendees)
    ? payload.attendees.filter((a): a is { email?: unknown } => typeof a === "object" && a !== null)
    : [];

  if (!summary || !start?.dateTime || !end?.dateTime) {
    throw new Error("Approved calendar draft is missing required event fields");
  }

  return {
    summary,
    description,
    location,
    start: {
      dateTime: String(start.dateTime),
      timeZone: start.timeZone ? String(start.timeZone) : "UTC",
    },
    end: {
      dateTime: String(end.dateTime),
      timeZone: end.timeZone ? String(end.timeZone) : "UTC",
    },
    attendees: attendees
      .filter((a) => typeof a.email === "string" && (a.email as string).length > 0)
      .map((a) => ({ email: String(a.email) })),
  };
}

function toEventDraft(payload: Record<string, unknown>): EventDraft {
  const summary = typeof payload.summary === "string" ? payload.summary : "";
  const description = typeof payload.description === "string" ? payload.description : undefined;
  const location = typeof payload.location === "string" ? payload.location : undefined;
  const start = payload.start as { dateTime?: unknown; timeZone?: unknown } | undefined;
  const end = payload.end as { dateTime?: unknown; timeZone?: unknown } | undefined;
  const attendees = Array.isArray(payload.attendees)
    ? payload.attendees.filter((attendee): attendee is { email?: unknown; displayName?: unknown } => typeof attendee === "object" && attendee !== null)
    : [];

  if (!summary || !start?.dateTime || !start?.timeZone || !end?.dateTime || !end?.timeZone) {
    throw new Error("Approved calendar draft is missing required event fields");
  }

  return {
    subject: summary,
    body: description
      ? {
          contentType: "Text",
          content: description,
        }
      : undefined,
    start: {
      dateTime: String(start.dateTime),
      timeZone: String(start.timeZone),
    },
    end: {
      dateTime: String(end.dateTime),
      timeZone: String(end.timeZone),
    },
    location: location ? { displayName: location } : undefined,
    attendees: attendees
      .filter((attendee) => typeof attendee.email === "string" && attendee.email.length > 0)
      .map((attendee) => ({
        emailAddress: {
          address: String(attendee.email),
          name: typeof attendee.displayName === "string" ? attendee.displayName : String(attendee.email),
        },
        type: "required" as const,
      })),
  };
}

export async function actionExecutorNode(
  state: AtheneStateType
): Promise<AtheneStateUpdate> {
  const action = state.pending_write_action as PendingWriteAction | null;

  if (!action) {
    return { run_status: "running" };
  }

  try {
    let result: unknown;

    switch (action.tool) {
      case "email-send": {
        const connectionId = await resolveMicrosoftConnectionId(state.org_id);
        result = await sendEmail(
          connectionId,
          state.org_id,
          toEmailDraft(action.payload)
        );
        break;
      }
      case "calendar-create": {
        const connectionId = await resolveMicrosoftConnectionId(state.org_id);
        result = await createEvent(
          connectionId,
          state.org_id,
          toEventDraft(action.payload)
        );
        break;
      }
      case "gmail-send": {
        const connectionId = await resolveGoogleConnectionId(state.org_id, "gmail");
        result = await gmailSendEmail(
          connectionId,
          state.org_id,
          toGmailRaw(action.payload)
        );
        break;
      }
      case "google-calendar-create": {
        const connectionId = await resolveGoogleConnectionId(state.org_id, "google-calendar");
        result = await createCalendarEvent(
          connectionId,
          state.org_id,
          toGoogleEventDraft(action.payload)
        );
        break;
      }
      case "data-index": {
        const { org_id, document_ids, doc_count } = action.payload as {
          org_id: string;
          document_ids: string[];
          doc_count: number;
        };
        await qstash.publishJSON({
          url: `${getAppBaseUrl()}/api/worker/index-delta`,
          body: { org_id, document_ids },
        });
        result = { queued: doc_count };
        break;
      }
      default:
        throw new Error(`Unknown action tool: ${action.tool}`);
    }

    return {
      pending_write_action: null,
      run_status: "running",
      final_answer: `Action completed successfully: ${JSON.stringify(result)}`,
    };
  } catch (err) {
    return {
      pending_write_action: null,
      run_status: "running",
      final_answer: `Action failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
