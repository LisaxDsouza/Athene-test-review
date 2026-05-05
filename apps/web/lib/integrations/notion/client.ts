import { baseFetch, getProviderToken } from '../base'

export async function notionFetch(connectionId: string, orgId: string, path: string, body?: object): Promise<any> {
  const token = await getProviderToken(connectionId, 'notion', orgId)
  
  return baseFetch(`https://api.notion.com/v1${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    },
    body: body || undefined
  })
}
