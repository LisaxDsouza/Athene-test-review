import { Nango } from '@nangohq/node'
import { supabase } from '../supabase/server'

let nangoInstance: Nango | null = null;

function getNango() {
  if (!nangoInstance) {
    const nangoSecretKey = process.env.NANGO_SECRET_KEY;
    if (!nangoSecretKey) {
      if (process.env.NODE_ENV === 'test') {
        console.warn("NANGO_SECRET_KEY missing; using placeholder for testing");
      } else {
        throw new Error("Missing NANGO_SECRET_KEY environment variable");
      }
    }
    nangoInstance = new Nango({
      secretKey: nangoSecretKey || 'placeholder-key'
    });

    // ⚡ Alias getToken to getConnectionToken to match specification/Founder requirement
    if (!(nangoInstance as any).getConnectionToken) {
      (nangoInstance as any).getConnectionToken = (nangoInstance as any).getToken.bind(nangoInstance);
    }
  }
  return nangoInstance;
}

/**
 * Robust error handler for Nango/OAuth specific failures.
 * 🛡️ Distinguishes between expired tokens, revoked connections, and permission issues.
 */
function handleNangoError(error: unknown, context: string): never {
  const err = error as Record<string, any>;
  const status = err?.response?.status;
  const nangoCode = err?.error?.code;
  const message = err?.error?.message || (error instanceof Error ? error.message : String(error));

  console.error(`[Nango Error] ${context}:`, { status, nangoCode, message });

  // 1. Handle Revoked or Expired OAuth Sessions
  if (status === 401 || nangoCode === 'invalid_credentials') {
    const wrappedError = new Error('Connection expired or revoked. Please reconnect your integration.');
    (wrappedError as any).status = 401;
    (wrappedError as any).reason = 'AUTH_FAILURE';
    (wrappedError as any).reconnect_required = true;
    throw wrappedError;
  }

  // 2. Handle Permission/Ownership Issues
  if (status === 403) {
    const wrappedError = new Error('Access denied. This connection may belong to another organization or have insufficient scopes.');
    (wrappedError as any).status = 403;
    (wrappedError as any).reason = 'FORBIDDEN';
    throw wrappedError;
  }

  // 3. Handle Missing Records
  if (status === 404) {
    const wrappedError = new Error('Connection not found. It may have been deleted.');
    (wrappedError as any).status = 404;
    (wrappedError as any).reason = 'NOT_FOUND';
    throw wrappedError;
  }

  // 4. General Fallback
  throw error;
}

/**
 * Fetches an access token for a given connection and provider.
 * 🔒 Strictly verified against Supabase/metadata to prevent cross-org leaks.
 */
export async function getConnectionToken(
  connectionId: string,
  providerConfigKey: string,
  orgId: string
): Promise<string> {
  if (!orgId) {
    throw new Error('orgId is required to fetch connection token');
  }

  const nango = getNango();

  try {
    // 🛡️ Verify connection ownership in Supabase
    const { data: mapping, error: supabaseError } = await supabase
      .from('nango_connections')
      .select('id')
      .eq('org_id', orgId)
      .eq('connection_id', connectionId)
      .eq('provider_config_key', providerConfigKey)
      .maybeSingle()

    if (supabaseError) {
      console.error('Supabase verification error:', supabaseError)
    }

    if (!mapping) {
      // Fail closed — no Supabase record means this org does not own the connection.
      // We do not fall back to Nango metadata because metadata is user-controlled during
      // OAuth setup and cannot be trusted as an ownership proof.
      const notFound = new Error('Connection not found for this organization');
      (notFound as any).status = 404;
      (notFound as any).reason = 'NOT_FOUND';
      throw notFound;
    }

    // 🔒 If verification passed, proceed to fetch token
    return await (nango as any).getConnectionToken(providerConfigKey, connectionId)

  } catch (error: unknown) {
    return handleNangoError(error, 'getConnectionToken');
  }
}

/**
 * Verified token fetch — always validates org ownership before returning a token.
 * Drop-in for any caller that previously used the unguarded variant.
 */
export async function getToken(
  connectionId: string,
  providerConfigKey: string,
  orgId: string
): Promise<string> {
  return getConnectionToken(connectionId, providerConfigKey, orgId);
}

export async function getConnection(connectionId: string, providerConfigKey: string) {
    const nango = getNango();
    try {
        return await nango.getConnection(providerConfigKey, connectionId);
    } catch (error: unknown) {
        return handleNangoError(error, 'getConnection');
    }
}

/**
 * Fetches the full Nango connection object to extract metadata.
 * 🔒 Strictly verified against Nango metadata to prevent cross-org leaks.
 */
export async function getConnectionMetadata(
  connectionId: string,
  providerConfigKey: string,
  orgId: string
): Promise<any> {
  if (!orgId) {
    throw new Error('orgId is required to fetch connection metadata');
  }

  const nango = getNango();

  // Verify ownership via Supabase (source of truth) before fetching from Nango
  const { data: mapping, error: supabaseError } = await supabase
    .from('nango_connections')
    .select('id')
    .eq('org_id', orgId)
    .eq('connection_id', connectionId)
    .eq('provider_config_key', providerConfigKey)
    .maybeSingle();

  if (supabaseError) {
    console.error('Supabase verification error in getConnectionMetadata:', supabaseError);
  }

  if (!mapping) {
    const notFound = new Error('Connection not found for this organization');
    (notFound as any).status = 404;
    (notFound as any).reason = 'NOT_FOUND';
    throw notFound;
  }

  try {
    return await nango.getConnection(providerConfigKey, connectionId);
  } catch (error: unknown) {
    return handleNangoError(error, 'getConnectionMetadata');
  }
}

/**
 * Lists connections for an organization.
 * 🔒 Properly fixed: Uses server-side filtering (Supabase) to avoid fetching all connections.
 */
export async function listConnections(orgId: string) {
  if (!orgId) {
    throw new Error('orgId is required to list Nango connections');
  }

  const nango = getNango();

  // 1. Fetch authorized connection mappings from Supabase (Source of Truth)
  const { data: mappings, error: supabaseError } = await supabase
    .from('nango_connections')
    .select('connection_id, provider_config_key')
    .eq('org_id', orgId)

  if (supabaseError) {
    console.error('Supabase error in listConnections:', supabaseError)
  }

  try {
    // 2. Fallback: If no Supabase mappings found, attempt limited metadata search
    if (!mappings || mappings.length === 0) {
      const { connections } = await nango.listConnections(undefined, undefined, {
        endUserOrganizationId: orgId
      } as any);

      // Final security check: ensure metadata matches if we fell back
      return connections.filter((conn: any) => conn.metadata?.org_id === orgId);
    }

    // 3. Fetch full connection objects from Nango only for the IDs we found in Supabase
    const connectionPromises = (mappings || []).map((m: any) => 
      nango.getConnection(m.provider_config_key, m.connection_id).catch(() => null)
    );

    const connections = (await Promise.all(connectionPromises)).filter(c => c !== null);

    return connections;
  } catch (error: unknown) {
    return handleNangoError(error, 'listConnections');
  }
}

/**
 * Persists a Nango connection mapping to Supabase.
 * Call this after a successful authentication flow.
 */
export async function saveConnectionMapping(
  orgId: string,
  connectionId: string,
  providerConfigKey: string
) {
  try {
    const { error } = await supabase
      .from('nango_connections')
      .upsert({
        org_id: orgId,
        connection_id: connectionId,
        provider_config_key: providerConfigKey
      }, {
        onConflict: 'org_id, connection_id, provider_config_key'
      })

    if (error) throw error
  } catch (error: unknown) {
    console.error('Error in saveConnectionMapping:', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/**
 * Securely deletes a Nango connection and its Supabase mapping.
 * 🔒 Strictly verifies ownership before deletion.
 */
export async function deleteConnection(
  connectionId: string,
  providerConfigKey: string,
  orgId: string
) {
  if (!orgId) throw new Error('orgId is required for deletion');

  const nango = getNango();

  try {
    // 1. Verify ownership in Supabase first
    const { data: mapping, error: supabaseError } = await supabase
      .from('nango_connections')
      .select('id')
      .eq('org_id', orgId)
      .eq('connection_id', connectionId)
      .eq('provider_config_key', providerConfigKey)
      .maybeSingle()

    if (supabaseError) console.error('Supabase cleanup verification error:', supabaseError);

    // 2. Fail closed — no Supabase record means this org does not own the connection
    if (!mapping) {
      const notFound = new Error('Connection not found for this organization');
      (notFound as any).status = 404;
      (notFound as any).reason = 'NOT_FOUND';
      throw notFound;
    }

    // 3. Delete from Nango service
    await nango.deleteConnection(providerConfigKey, connectionId);

    // 4. Clean up Supabase mapping
    const { error: deleteError } = await supabase
      .from('nango_connections')
      .delete()
      .eq('org_id', orgId)
      .eq('connection_id', connectionId)
      .eq('provider_config_key', providerConfigKey);

    if (deleteError) throw deleteError;

    return { success: true };
  } catch (error: unknown) {
    return handleNangoError(error, 'deleteConnection');
  }
}
