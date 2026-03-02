-- Esquema para almacenar propuestas SEO en Supabase (PostgreSQL)
create extension if not exists "pgcrypto";

create table if not exists public.seo_propuestas (
  id uuid primary key default gen_random_uuid(),
  id_pagina text not null,
  url text not null,
  keyword_gsc text not null,
  metadatos_actuales jsonb not null default '{}'::jsonb,
  metadatos_propuestos_ia jsonb not null default '{}'::jsonb,
  estado text not null default 'Pendiente' check (estado in ('Pendiente', 'Aprobado', 'Rechazado')),
  fecha_creacion timestamptz not null default now()
);

create index if not exists seo_propuestas_id_pagina_idx
  on public.seo_propuestas (id_pagina);

create index if not exists seo_propuestas_estado_idx
  on public.seo_propuestas (estado);

create index if not exists seo_propuestas_fecha_creacion_idx
  on public.seo_propuestas (fecha_creacion desc);
