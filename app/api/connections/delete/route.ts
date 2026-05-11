import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { deleteConnection } from "@/lib/nango/client";
import { supabaseAdmin } from "@/lib/supabase/server";
import { resolveOrgUuid } from "@/lib/auth/rbac";

/**
 * 🔒 SECURE DELETE ENDPOINT
 * Strictly enforces Clerk Organization membership for deletion safety.
 */
export async function DELETE(request: Request) {
  const { userId, orgId } = await auth();

  if (!userId || !orgId) {
    return new NextResponse("Unauthorized: Organization membership required", { status: 401 });
  }

  const orgUuid = await resolveOrgUuid(orgId);
  if (!orgUuid) {
    return new NextResponse("Organization not found", { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const connectionId = searchParams.get('connectionId');
  const providerConfigKey = searchParams.get('providerConfigKey');

  if (!connectionId || !providerConfigKey) {
    return NextResponse.json(
      { success: false, error: "Missing required parameters: connectionId, providerConfigKey" },
      { status: 400 },
    );
  }

  try {
    // Collect document IDs before deletion so we can clean up kg_nodes afterwards.
    const { data: docRows } = await supabaseAdmin
      .from('documents')
      .select('id')
      .eq('connection_id', connectionId)
      .eq('org_id', orgUuid)

    const deletedDocIds: string[] = (docRows ?? []).map((r: { id: string }) => r.id)

    await deleteConnection(connectionId, providerConfigKey, orgId);

    if (deletedDocIds.length > 0) {
      for (const docId of deletedDocIds) {
        const { error: updateErr } = await supabaseAdmin.rpc('array_remove_kg_source', {
          p_org_id: orgUuid,
          p_doc_id: docId,
        })
        if (updateErr) {
          console.error('[connections/delete] Failed to clean kg_nodes for doc', docId, updateErr.message)
        }
      }

      const { error: pruneErr } = await supabaseAdmin
        .from('kg_nodes')
        .delete()
        .eq('org_id', orgUuid)
        .eq('source_documents', '{}')

      if (pruneErr) {
        console.error('[connections/delete] Failed to prune empty kg_nodes:', pruneErr.message)
      }
    }

    return NextResponse.json({ success: true, message: "Connection deleted successfully", connectionId });
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number; reason?: string }
    console.error("Error deleting connection:", e);
    return NextResponse.json(
      { success: false, error: "Failed to delete connection", details: e.message, reason: e.reason ?? 'DELETE_FAILURE' },
      { status: e.status ?? 500 },
    );
  }
}
