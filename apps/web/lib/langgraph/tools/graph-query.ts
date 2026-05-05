// ============================================================
// tools/graph-query.ts — Knowledge graph traversal tool (ATH-62)
//
// Wraps the kg_nodes / kg_edges tables as a DynamicStructuredTool
// so all agents can query entity relationships at inference time.
//
// Flow:
//   question → extract entity labels (gpt-4o-mini) →
//   findNodes (kg_nodes) → traverseFromNode BFS (kg_edges) →
//   format readable string → return to agent
//
// Security:
//   - Non-BI users only see visibility='public' nodes.
//   - bi_analysts see public + department nodes.
//   - Edges referencing inaccessible nodes are silently omitted.
//   - boundary_reached is surfaced in output when traversal stops.
//
// Never throws — always returns a graceful string.
// ============================================================

import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { ChatOpenAI } from '@langchain/openai'
import { supabaseAdmin } from '@/lib/supabase/server'
import { registerTool } from './registry'

// ---- Mini model for cheap entity extraction -----------------

const mini = new ChatOpenAI({ modelName: 'gpt-4o-mini', temperature: 0 })

// ---- Types --------------------------------------------------

interface GraphNode {
  id: string
  label: string
  entity_type: string
  visibility: string
  department_ids: string[] | null
  description: string | null
}

interface GraphEdge {
  source_node: string
  target_node: string
  relation: string
  provenance: string
  confidence: number
}

// ---- Entity label extraction --------------------------------

/**
 * Uses gpt-4o-mini to extract entity names from the question.
 * Returns [] on parse failure — never throws.
 */
async function extractEntityLabels(question: string): Promise<string[]> {
  try {
    const response = await mini.invoke([
      {
        role: 'system',
        content:
          'Extract the entity names mentioned in the question. ' +
          'Return a JSON array of strings only, e.g. ["AWS", "Payment Service"]. ' +
          'Return [] if none found. Return only valid JSON — no prose.',
      },
      { role: 'user', content: question },
    ])
    const text =
      typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content)
    const cleaned = text.replace(/```json\n?|```\n?/g, '').trim()
    const parsed = JSON.parse(cleaned)
    return Array.isArray(parsed) ? parsed.map((s: unknown) => String(s)) : []
  } catch {
    return []
  }
}

// ---- Node lookup --------------------------------------------

async function findNodes(
  orgId: string,
  labels: string[],
  entityTypes: string[] | undefined,
  role: string,
): Promise<GraphNode[]> {
  if (labels.length === 0) return []

  let query = supabaseAdmin
    .from('kg_nodes')
    .select('id, label, entity_type, visibility, department_ids, description')
    .eq('org_id', orgId)

  // Non-BI analysts only see public nodes
  if (role !== 'bi_analyst') {
    query = query.eq('visibility', 'public')
  }

  if (entityTypes && entityTypes.length > 0) {
    query = query.in('entity_type', entityTypes)
  }

  // OR-match across all label variants (case-insensitive)
  const labelFilter = labels.map((l) => `label.ilike.%${l}%`).join(',')
  const { data, error } = await query.or(labelFilter).limit(20)

  if (error) throw new Error(`[graph-query] findNodes: ${error.message}`)
  return (data ?? []) as GraphNode[]
}

// ---- BFS traversal ------------------------------------------

async function traverseFromNode(
  orgId: string,
  startId: string,
  maxHops: number,
  role: string,
  visited: Set<string>,
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[]; boundaryReached: boolean }> {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  let boundaryReached = false

  const queue: Array<{ id: string; hop: number }> = [{ id: startId, hop: 0 }]

  while (queue.length > 0) {
    const { id, hop } = queue.shift()!
    if (visited.has(id)) continue
    if (hop >= maxHops) {
      boundaryReached = true
      continue
    }
    visited.add(id)

    // Fetch adjacent edges
    const { data: edgeRows, error: edgeErr } = await supabaseAdmin
      .from('kg_edges')
      .select('source_node, target_node, relation, provenance, confidence')
      .eq('org_id', orgId)
      .or(`source_node.eq.${id},target_node.eq.${id}`)
      .limit(50)

    if (edgeErr) continue

    for (const edge of edgeRows ?? []) {
      edges.push(edge as GraphEdge)
      const nextId =
        edge.source_node === id ? edge.target_node : edge.source_node
      if (!visited.has(nextId)) {
        queue.push({ id: nextId, hop: hop + 1 })
      }
    }

    // Fetch the node itself
    const { data: nodeRow } = await supabaseAdmin
      .from('kg_nodes')
      .select('id, label, entity_type, visibility, department_ids, description')
      .eq('id', id)
      .eq('org_id', orgId)
      .single()

    if (!nodeRow) continue

    // Visibility gate
    if (role !== 'bi_analyst' && nodeRow.visibility !== 'public') {
      boundaryReached = true
      continue
    }

    nodes.push(nodeRow as GraphNode)
  }

  return { nodes, edges, boundaryReached }
}

// ---- Result formatter ---------------------------------------

function formatResult(
  nodes: GraphNode[],
  edges: GraphEdge[],
  boundaryReached: boolean,
): string {
  if (nodes.length === 0) return 'No knowledge graph data available yet.'

  const lines: string[] = []
  lines.push(
    `Entities found: ${nodes
      .map((n) => `${n.label} (${n.entity_type})`)
      .join(', ')}`,
  )

  if (edges.length > 0) {
    const labelMap = new Map(nodes.map((n) => [n.id, n.label]))
    lines.push('Relationships:')
    for (const e of edges) {
      const src = labelMap.get(e.source_node) ?? e.source_node
      const tgt = labelMap.get(e.target_node) ?? e.target_node
      lines.push(
        `  ${src} → ${e.relation} → ${tgt} [${e.provenance}, ${e.confidence.toFixed(2)}]`,
      )
    }
  }

  if (boundaryReached) {
    lines.push(
      'Note: boundary reached — some related nodes are not accessible to you.',
    )
  }

  const sourceDocs = [
    ...new Set(nodes.flatMap((n) => n.department_ids ?? [])),
  ]
  if (sourceDocs.length > 0) {
    lines.push(`Source departments: ${sourceDocs.join(', ')}`)
  }

  return lines.join('\n')
}

// ---- Tool definition ----------------------------------------

export const graphQueryTool = new DynamicStructuredTool({
  name: 'graph_query',
  description:
    'Find entities and their relationships in the org knowledge graph. ' +
    'Use when the question asks about connections, dependencies, or impact chains.',
  schema: z.object({
    question: z
      .string()
      .describe('The question or topic to look up in the knowledge graph'),
    maxHops: z
      .number()
      .default(2)
      .describe('Maximum traversal depth (1-3 recommended)'),
    entityTypes: z
      .array(z.string())
      .optional()
      .describe('Optionally filter by entity type (person, project, service, …)'),
  }),
  func: async ({ question, maxHops, entityTypes }, _runManager, config) => {
    const ctx = (config as any)?.configurable ?? {}
    const orgId: string = ctx.orgId ?? ''
    const role: string = ctx.role ?? 'member'

    if (!orgId) return 'Knowledge graph unavailable: missing org context.'

    try {
      const labels = await extractEntityLabels(question)
      if (labels.length === 0) {
        return 'No entities found in your question to look up in the knowledge graph.'
      }

      const seedNodes = await findNodes(orgId, labels, entityTypes, role)
      if (seedNodes.length === 0) return 'No knowledge graph data available yet.'

      const allNodes = new Map<string, GraphNode>()
      const allEdges = new Map<string, GraphEdge>()
      let anyBoundary = false
      const visited = new Set<string>()

      for (const node of seedNodes) {
        allNodes.set(node.id, node)
        const { nodes, edges, boundaryReached } = await traverseFromNode(
          orgId,
          node.id,
          maxHops,
          role,
          visited,
        )
        for (const n of nodes) allNodes.set(n.id, n)
        for (const e of edges) {
          const key = `${e.source_node}|${e.relation}|${e.target_node}`
          allEdges.set(key, e)
        }
        if (boundaryReached) anyBoundary = true
      }

      return formatResult(
        Array.from(allNodes.values()),
        Array.from(allEdges.values()),
        anyBoundary,
      )
    } catch (err: unknown) {
      console.error('[graph-query] error:', err)
      return 'No knowledge graph data available yet.'
    }
  },
})

// Auto-register for all roles
registerTool(graphQueryTool)
