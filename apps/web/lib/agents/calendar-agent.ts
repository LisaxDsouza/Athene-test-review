// ============================================================
// calendar-agent.ts — Calendar Agent (ATH-38)
//
// Translates natural-language scheduling requests into a
// structured CalendarEventDraft and queues it for HITL approval.
//
// Design notes:
//   • Prompt is inlined as a template literal — fs.readFileSync
//     crashes in Next.js Edge / serverless environments.
//   • Timezone defaults to UTC; the AI extracts any explicit
//     timezone from the user's message.
//   • Returns pending_write_action (canonical field) instead of
//     the legacy pending_action field.
// ============================================================

import { z } from "zod";
import { getModel } from "../langgraph/llm-factory";
import type { AtheneStateType, AtheneStateUpdate } from "../langgraph/state";
import { AIMessage } from "@langchain/core/messages";

// ---- Structured output schema --------------------------------

export const calendarEventSchema = z.object({
  action_type: z
    .enum(["create", "update", "delete", "search"])
    .default("create"),
  is_search: z
    .boolean()
    .default(false)
    .describe(
      "True if the user is looking for a free slot rather than a specific time"
    ),
  summary: z.string().describe("The title of the meeting"),
  start: z
    .object({
      dateTime: z.string().describe("ISO 8601 start time"),
      timeZone: z.string().describe("The timezone for this time"),
    })
    .optional(),
  end: z
    .object({
      dateTime: z.string().describe("ISO 8601 end time"),
      timeZone: z.string().describe("The timezone for this time"),
    })
    .optional(),
  search_range: z
    .object({
      startAfter: z.string().describe("ISO 8601 earliest possible time"),
      endBefore: z.string().describe("ISO 8601 latest possible time"),
    })
    .optional(),
  recurrence: z
    .string()
    .optional()
    .describe("Recurrence rule (e.g. WEEKLY;BYDAY=MO)"),
  constraints: z
    .array(z.string())
    .optional()
    .describe(
      "User constraints (e.g. ['avoid Wednesdays', 'virtual only'])"
    ),
  attendees: z
    .array(
      z
        .object({
          email: z.string().optional(),
          displayName: z.string().optional(),
        })
        .refine((data) => data.email || data.displayName, {
          message: "At least one of email or displayName must be provided",
        })
    )
    .optional(),
  location: z.string().optional(),
  description: z.string().optional(),
  cancellation_note: z
    .string()
    .optional()
    .describe("Note if this draft replaces another event"),
});

export type CalendarEventDraft = z.infer<typeof calendarEventSchema>;

// ---- Inlined system prompt ----------------------------------
// (Avoids fs.readFileSync which crashes in Edge Runtime)

const SYSTEM_PROMPT_TEMPLATE = `# Role
You are a Strategic Calendar Assistant. Your mission is to translate complex, human scheduling requests into a precise, actionable calendar draft.

# Context
{dateContext}

# Strategic Reasoning Steps
1. **Determine Intent**: Is the user scheduling a specific time, searching for an available slot, or rescheduling/canceling?
2. **Resolve Time Context**:
   - Use the Current System Time as your anchor.
   - Convert explicit timezones (e.g., "IST", "GMT") to the user's local timezone: {timezone}.
   - Resolve fuzzy terms: "Morning" (9am), "Afternoon" (2pm), "Lunch" (12pm-1pm), "End of day" (5pm).
3. **Identify Constraints**: Note any "avoid" days, "only if free" requirements, or "virtual" preferences.
4. **Handle Multi-Action**: If the user says "Cancel X and Book Y", draft the NEW event and add a note in the description about the cancellation of X.

# Handling Specific Scenarios
- **The "Find" Request**: If the user says "Find a slot", "Sometime next week", or "When everyone is free", you must set the 'is_search' flag to true and define the 'search_range'.
- **Missing Emails**: Use 'displayName' for people like "Alex" or "Priya". Do NOT hallucinate emails.
- **Recurrence**: If the user says "Weekly", "Every Monday", or "Monthly", populate the 'recurrence' field with a descriptive pattern (e.g., "WEEKLY;BYDAY=MO").
- **Location**: If "virtual" or "online" is mentioned, set the location to "Video Call / Remote".

# Output Rules
- You MUST produce a valid JSON object.
- If you are missing critical information (like the date), ask the user for it politely.
- Never claim to have "created" the event; always say you have "prepared the draft" for their approval.`;

// ---- Agent node ---------------------------------------------

/**
 * Calendar Agent Node
 *
 * Handles complex strategic scheduling and search requests.
 * On success: returns pending_write_action + awaiting_approval=true.
 * On error:   returns a user-friendly message without crashing the graph.
 */
export async function calendarAgent(
  state: AtheneStateType
): Promise<AtheneStateUpdate> {
  const now = new Date();
  // Timezone not in canonical state — default to UTC.
  // The AI will still parse any explicit timezone in the user's message.
  const timezone = "UTC";

  const dateContext = `Current System Time: ${now.toISOString()}
User Local Time: ${now.toUTCString()}
User Timezone: ${timezone}`;

  const systemPrompt = SYSTEM_PROMPT_TEMPLATE.replace(
    "{dateContext}",
    dateContext
  ).replace("{timezone}", timezone);

  const draftModel = getModel().withStructuredOutput(calendarEventSchema, {
    name: "draft_calendar_event",
  });

  try {
    const draft = await draftModel.invoke([
      { role: "system", content: systemPrompt },
      ...state.messages,
    ]);

    return {
      awaiting_approval: true,
      pending_write_action: {
        tool: "calendar-create",
        payload: draft as Record<string, unknown>,
        requested_at: now.toISOString(),
      },
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[calendarAgent] Error:", msg);

    return {
      messages: [
        new AIMessage({
          content:
            "I'm sorry, I couldn't quite process that calendar request. Could you please provide more details about the date, time, or people involved?",
        }),
      ],
    };
  }
}
