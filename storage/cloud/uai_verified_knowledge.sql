-- UAI optional verified-knowledge replica (PostgreSQL / Supabase compatible)
create table if not exists public.uai_verified_knowledge (
  cloud_record_id text primary key,
  subject text not null,
  claim text not null,
  source_id text not null,
  source_url text not null,
  claim_hash text,
  corroboration integer not null default 0 check (corroboration >= 0),
  supporting_sources jsonb not null default '[]'::jsonb,
  verification jsonb not null default '{}'::jsonb,
  training_eligible boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  observed_at timestamptz,
  content_hash text,
  source_trust double precision not null default 0 check (source_trust >= 0 and source_trust <= 1),
  stored_at timestamptz not null default now()
);
create index if not exists uai_verified_knowledge_training_idx on public.uai_verified_knowledge(training_eligible, stored_at desc);
create index if not exists uai_verified_knowledge_claim_idx on public.uai_verified_knowledge(claim_hash);
alter table public.uai_verified_knowledge enable row level security;
-- No anonymous policies are created. Use a server-side credential or define a narrowly scoped authenticated policy yourself.
