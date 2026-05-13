import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { listConnections } from "@/lib/nango/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
    try {
        const { userId, orgId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // Use orgId if available, fallback to userId (end_user_id)
        // Note: listConnections in lib/nango/client.ts expects an ID to query Supabase/Nango
        const connections = await listConnections(orgId || userId);

        return NextResponse.json(connections);
    } catch (error) {
        console.error("[nango/connections] Error:", error);
        return NextResponse.json([], { status: 200 }); // graceful fallback
    }
}

export async function DELETE(req: Request) {
    try {
        const { userId, orgId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const url = new URL(req.url);
        const providerConfigKey = url.searchParams.get("providerConfigKey");
        const connectionId = url.searchParams.get("connectionId");

        if (!providerConfigKey) {
            return NextResponse.json({ error: "providerConfigKey is required" }, { status: 400 });
        }

        // We need a connection ID to delete from Nango. 
        // If not provided, we might need to find it first, but usually the frontend should know it.
        // In the onboarding wizard, we might need to fetch the connections first to find the ID if not passed.
        
        let targetConnectionId = connectionId;

        if (!targetConnectionId) {
            // Find the connection for this provider
            const connections = await listConnections(orgId || userId);
            const connection = connections.find((c: any) => c.provider_config_key === providerConfigKey);
            if (!connection) {
                return NextResponse.json({ error: "Connection not found" }, { status: 404 });
            }
            targetConnectionId = connection.connection_id;
        }

        if (!targetConnectionId) {
             return NextResponse.json({ error: "connectionId is required" }, { status: 400 });
        }

        await deleteConnection(targetConnectionId, providerConfigKey, orgId || userId);

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("[nango/connections] Delete Error:", error);
        return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to delete connection" }, { status: 500 });
    }
}
