export interface ExtractorChunk {
  content: string;
  document_id: string;
  chunk_index: number;
  source_type?: string;
}

export interface KGNode {
  id: string;
  org_id: string;
  label: string;
  type: string;
  properties: Record<string, unknown>;
  source_document_id?: string | null;
  source_type?: string | null;
  description_embedding?: number[] | null;
}

export interface KGEdge {
  org_id: string;
  from_node_id: string;
  to_node_id: string;
  relation: string;
  weight: number;
  visibility: "public" | "restricted";
}

export interface RawExtraction {
  nodes: Array<{
    id: string;
    label: string;
    type: string;
    properties?: Record<string, unknown>;
  }>;
  edges: Array<{
    from: string;
    to: string;
    relation: string;
    weight?: number;
  }>;
}
