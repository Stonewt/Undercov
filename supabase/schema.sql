-- Bon'Assiette : base de données Supabase.
-- À coller une seule fois dans Supabase > SQL Editor > New query, puis « Run ».
-- Chaque utilisateur ne peut lire et modifier QUE ses propres lignes (Row Level Security).

-- 1. Sauvegarde des données de l'appli (repas, points, eau, séances…).
--    Le poids et le tour de taille n'y sont jamais envoyés : ils restent sur le téléphone.
create table if not exists public.user_data (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint user_data_size check (pg_column_size(data) < 300000)
);
alter table public.user_data enable row level security;

drop policy if exists "lire ses données" on public.user_data;
create policy "lire ses données" on public.user_data
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "créer ses données" on public.user_data;
create policy "créer ses données" on public.user_data
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "modifier ses données" on public.user_data;
create policy "modifier ses données" on public.user_data
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- 2. Abonnements Bon'Assiette+ : lisibles par leur propriétaire, modifiables UNIQUEMENT par le serveur
--    (clé secrète service_role, utilisée par le futur webhook de paiement). Aucune policy d'écriture = écriture interdite aux utilisateurs.
create table if not exists public.subscriptions (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  status             text not null default 'inactive' check (status in ('active', 'inactive', 'past_due', 'canceled')),
  current_period_end timestamptz,
  provider_ref       text,
  updated_at         timestamptz not null default now()
);
alter table public.subscriptions enable row level security;

drop policy if exists "lire son abonnement" on public.subscriptions;
create policy "lire son abonnement" on public.subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);
