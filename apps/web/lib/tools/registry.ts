// ============================================================
// lib/tools/registry.ts — Central tool registry (ATH-41)
//
// Single source of truth for every LangChain tool available
// to the Athene multi-agent system. Agents import from here
// instead of scattering tool definitions across the codebase.
//
// Design rules:
//   • Every tool is a DynamicStructuredTool with Zod validation.
//   • Role-gating is declarative via ToolMeta.allowedRoles.
//   • getToolsForRole() is the ONLY public API agents use to
//     obtain their tool set — it filters by role automatically.
//   • Tool implementations are stubs that return structured
//     results. Actual integration calls (Supabase vector search,
//     Gmail API, etc.) are wired in the corresponding
//     lib/langgraph/tools/* files that delegate to these.
// ============================================================

import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import type { UserRole, ToolName, ToolMeta } from './types'

// ---- Tool metadata catalogue ------------------------------------

const TOOL_META: Record<ToolName, ToolMeta> = {
  vectorSearch: {
    name: 'vectorSearch',
    displayName: 'Vector Search',
    description:
      'Searches the vector store for documents relevant to the query within the user\'s own department.',
    allowedRoles: ['member', 'super_user', 'admin'],
    requiresApproval: false,
  },
  crossDeptVectorSearch: {
    name: 'crossDeptVectorSearch',
    displayName: 'Cross-Department Vector Search',
    description:
      'Searches the vector store across multiple departments. Restricted to BI analysts (super_user) and admins with active access grants.',
    allowedRoles: ['super_user', 'admin'],
    requiresApproval: false,
  },
  draftEmail: {
    name: 'draftEmail',
    displayName: 'Draft Email',
    description:
      'Drafts an email with the given recipient, subject, and body. Does NOT send — the email-send tool handles actual delivery after HITL approval.',
    allowedRoles: ['member', 'super_user', 'admin'],
    requiresApproval: false,
  },
  draftCalendarEvent: {
    name: 'draftCalendarEvent',
    displayName: 'Draft Calendar Event',
    description:
      'Drafts a calendar event with title, start/end times, and attendees. Does NOT create — the calendar-create tool handles actual creation after HITL approval.',
    allowedRoles: ['member', 'super_user', 'admin'],
    requiresApproval: false,
  },
  planReport: {
    name: 'planReport',
    displayName: 'Plan Report',
    description:
      'Plans a structured report by generating an outline with sections, data sources, and key questions.',
    allowedRoles: ['member', 'super_user', 'admin'],
    requiresApproval: false,
  },
}

// ---- DynamicStructuredTool instances ----------------------------

export const vectorSearchTool = new DynamicStructuredTool({
  name: 'vectorSearch',
  description: TOOL_META.vectorSearch.description,
  schema: z.object({
    query: z.string().describe('The natural-language search query.'),
    top_k: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(5)
      .describe('Number of results to return.'),
    source_type: z
      .string()
      .optional()
      .describe('Optional filter by source type (e.g. "drive", "confluence").'),
  }),
  func: async ({ query, top_k, source_type }) => {
    // Stub — actual implementation delegated to lib/langgraph/tools/vector-search.ts
    return JSON.stringify({
      tool: 'vectorSearch',
      query,
      top_k,
      source_type: source_type ?? null,
      results: [],
      message: 'Vector search executed (stub).',
    })
  },
})

export const crossDeptVectorSearchTool = new DynamicStructuredTool({
  name: 'crossDeptVectorSearch',
  description: TOOL_META.crossDeptVectorSearch.description,
  schema: z.object({
    query: z.string().describe('The natural-language search query.'),
    department_ids: z
      .array(z.string())
      .describe('List of department IDs to search across.'),
    top_k: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(5)
      .describe('Number of results to return per department.'),
  }),
  func: async ({ query, department_ids, top_k }) => {
    return JSON.stringify({
      tool: 'crossDeptVectorSearch',
      query,
      department_ids,
      top_k,
      results: [],
      message: 'Cross-department vector search executed (stub).',
    })
  },
})

const draftEmailTool = new DynamicStructuredTool({
  name: 'draftEmail',
  description: TOOL_META.draftEmail.description,
  schema: z.object({
    to: z.array(z.string()).describe('Recipient email addresses.'),
    subject: z.string().describe('Email subject line.'),
    body: z.string().describe('Email body content in plain text.'),
    cc: z
      .array(z.string())
      .optional()
      .describe('Optional CC recipients.'),
  }),
  func: async ({ to, subject, body, cc }) => {
    return JSON.stringify({
      tool: 'draftEmail',
      draft: { to, subject, body, cc: cc ?? [] },
      message: 'Email draft created (stub). Use email-send to deliver after approval.',
    })
  },
})

const draftCalendarEventTool = new DynamicStructuredTool({
  name: 'draftCalendarEvent',
  description: TOOL_META.draftCalendarEvent.description,
  schema: z.object({
    summary: z.string().describe('Event title.'),
    start: z.string().describe('ISO-8601 start datetime.'),
    end: z.string().describe('ISO-8601 end datetime.'),
    attendees: z
      .array(z.string())
      .optional()
      .describe('Optional list of attendee email addresses.'),
    location: z.string().optional().describe('Optional event location.'),
    description: z.string().optional().describe('Optional event description.'),
  }),
  func: async ({ summary, start, end, attendees, location, description }) => {
    return JSON.stringify({
      tool: 'draftCalendarEvent',
      draft: {
        summary,
        start,
        end,
        attendees: attendees ?? [],
        location: location ?? null,
        description: description ?? null,
      },
      message:
        'Calendar event drafted (stub). Use calendar-create to finalize after approval.',
    })
  },
})

const planReportTool = new DynamicStructuredTool({
  name: 'planReport',
  description: TOOL_META.planReport.description,
  schema: z.object({
    topic: z.string().describe('The report topic or question.'),
    sections: z
      .array(z.string())
      .optional()
      .describe('Optional suggested section titles.'),
    data_sources: z
      .array(z.string())
      .optional()
      .describe('Optional list of data sources to include.'),
  }),
  func: async ({ topic, sections, data_sources }) => {
    return JSON.stringify({
      tool: 'planReport',
      plan: {
        topic,
        sections: sections ?? [],
        data_sources: data_sources ?? [],
      },
      message: 'Report plan generated (stub).',
    })
  },
})

// ---- Internal lookup map ----------------------------------------

const TOOL_INSTANCES: Record<ToolName, DynamicStructuredTool> = {
  vectorSearch: vectorSearchTool,
  crossDeptVectorSearch: crossDeptVectorSearchTool,
  draftEmail: draftEmailTool,
  draftCalendarEvent: draftCalendarEventTool,
  planReport: planReportTool,
}

// ---- Public API -------------------------------------------------

/**
 * Returns the metadata for a specific tool.
 */
export function getToolMeta(name: ToolName): ToolMeta {
  return TOOL_META[name]
}

/**
 * Returns all tool metadata entries.
 */
export function getAllToolMeta(): ToolMeta[] {
  return Object.values(TOOL_META)
}

/**
 * Returns the DynamicStructuredTool instances available to a given role.
 * This is the primary entry point for agents to obtain their tool set.
 *
 * @param role - The authenticated user's role.
 * @returns An array of LangChain tools the role is permitted to invoke.
 */
export function getToolsForRole(role: UserRole): DynamicStructuredTool[] {
  return (Object.keys(TOOL_META) as ToolName[])
    .filter((name) => TOOL_META[name].allowedRoles.includes(role))
    .map((name) => TOOL_INSTANCES[name])
}

/**
 * Returns a single tool instance by name.
 * Throws if the name is not registered.
 */
export function getToolByName(name: ToolName): DynamicStructuredTool {
  const tool = TOOL_INSTANCES[name]
  if (!tool) throw new Error(`Unknown tool: ${name}`)
  return tool
}

/**
 * Returns tool names available to a given role (useful for logging/debugging).
 */
export function getToolNamesForRole(role: UserRole): ToolName[] {
  return (Object.keys(TOOL_META) as ToolName[]).filter((name) =>
    TOOL_META[name].allowedRoles.includes(role),
  )
}

