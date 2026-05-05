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
import { supabaseAdmin } from "@/lib/supabase/server";

type PendingWriteAction = {
  tool: string;
  payload: Record<string, unknown>;
  requested_at: string;
};

async function resolveMicrosoftConnectionId(clerkOrgId: string): Promise<string> {
  const { data: orgRow, error: orgError } = await supabaseAdmin
    .from("organizations")
    .select("id")
    .eq("clerk_org_id", clerkOrgId)
    .maybeSingle();

  if (orgError) {
    throw new Error(`Failed to resolve organization: ${orgError.message}`);
  }
  if (!orgRow) {
    throw new Error("Organization not found for this Clerk org");
  }

  const { data: connectionRow, error: connectionError } = await supabaseAdmin
    .from("nango_connections")
    .select("connection_id")
    .eq("org_id", orgRow.id)
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
    const connectionId = await resolveMicrosoftConnectionId(state.org_id);

    switch (action.tool) {
      case "email-send": {
        result = await sendEmail(
          connectionId,
          state.org_id,
          toEmailDraft(action.payload)
        );
        break;
      }
      case "calendar-create": {
        result = await createEvent(
          connectionId,
          state.org_id,
          toEventDraft(action.payload)
        );
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
