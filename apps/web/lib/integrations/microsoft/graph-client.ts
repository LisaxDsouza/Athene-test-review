import { baseFetch, getProviderToken, baseFetchRaw } from '../base'

export async function graphFetch(connectionId: string, orgId: string, endpoint: string, options: any = {}): Promise<any> {
  const token = await getProviderToken(connectionId, 'microsoft', orgId)
  
  return baseFetch(`https://graph.microsoft.com/v1.0${endpoint}`, {
    method: options.method || 'GET',
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`
    },
    body: options.body ? JSON.parse(options.body) : undefined
  })
}

export async function graphDownload(connectionId: string, orgId: string, endpoint: string, options: any = {}): Promise<ArrayBuffer> {
    const token = await getProviderToken(connectionId, 'microsoft', orgId)
    const res = await baseFetchRaw(`https://graph.microsoft.com/v1.0${endpoint}`, {
        method: 'GET',
        headers: {
            ...options.headers,
            Authorization: `Bearer ${token}`,
        },
    })

    return res.arrayBuffer()
}

/** @deprecated alias for simple token-based fetch */
export async function microsoftGraphFetch<T>(accessToken: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`Microsoft Graph ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}
