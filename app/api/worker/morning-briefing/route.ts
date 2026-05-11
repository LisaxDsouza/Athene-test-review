import { NextRequest, NextResponse } from 'next/server'
import { verifySignatureAppRouter } from '@upstash/qstash/nextjs'
import { supabaseAdmin } from '@/lib/supabase/server'
import { resolveModelClient } from '@/lib/langgraph/llm-factory'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'

interface BriefingJobBody {
  orgId: string
  userId: string
}

async function handler(req: NextRequest) {
  let body: BriefingJobBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { orgId, userId } = body
  if (!orgId || !userId) {
    return NextResponse.json({ error: 'orgId and userId are required' }, { status: 400 })
  }

  // Fetch recent threads as context for the briefing
  const { data: threads } = await supabaseAdmin
    .from('threads')
    .select('id, summary, created_at')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(10)

  const threadContext = (threads ?? [])
    .map((t: { id: string; summary?: string; created_at: string }) =>
      `- ${t.summary ?? 'Untitled thread'} (${new Date(t.created_at).toLocaleDateString()})`
    )
    .join('\n') || 'No recent activity.'

  const { client: llm } = await resolveModelClient(orgId, 'simple')

  const response = await llm.invoke([
    new SystemMessage(
      'You are Athene, an enterprise AI assistant. Generate a concise morning briefing for the user. ' +
      'Return a JSON object with keys: summary (string), sections (array of { title, items: string[] }).'
    ),
    new HumanMessage(
      `Today is ${new Date().toDateString()}.\n\nRecent activity:\n${threadContext}\n\nGenerate the morning briefing.`
    ),
  ])

  let content: object
  try {
    const text = typeof response.content === 'string' ? response.content : JSON.stringify(response.content)
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    content = jsonMatch ? JSON.parse(jsonMatch[0]) : { summary: text, sections: [] }
  } catch {
    content = { summary: String(response.content), sections: [] }
  }

  const { error } = await supabaseAdmin.from('briefings').insert({
    org_id: orgId,
    user_id: userId,
    content,
    summary: (content as any).summary ?? '',
    generated_at: new Date().toISOString(),
    delivered: false,
    delivery_method: 'in_app',
  })

  if (error) {
    console.error('[morning-briefing] Failed to save briefing:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export const POST = verifySignatureAppRouter(handler)
