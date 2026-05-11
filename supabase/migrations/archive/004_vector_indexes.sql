-- ATH-20 / 004_vector_indexes.sql
create index if not exists idx_document_embeddings_hnsw
  on document_embeddings using hnsw (embedding vector_cosine_ops);
