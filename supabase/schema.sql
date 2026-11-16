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

-- 3. Repas proposés par les utilisateurs. Écriture UNIQUEMENT par le serveur (qui complète les valeurs manquantes).
--    Pour valider : Table Editor > meal_suggestions, corrige les valeurs si besoin, puis passe status à « approved ».
--    Les repas « approved » apparaissent dans la recherche de l'appli pour tout le monde.
create table if not exists public.meal_suggestions (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users (id) on delete set null,
  name        text not null check (char_length(name) between 3 and 80),
  portion_g   numeric check (portion_g between 0 and 3000),
  kcal        numeric check (kcal between 0 and 4000),
  prot        numeric check (prot between 0 and 300),
  gluc        numeric check (gluc between 0 and 500),
  lip         numeric check (lip between 0 and 300),
  price       numeric check (price between 0 and 100),
  estimated   text[] not null default '{}',
  ai_estimate jsonb,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at  timestamptz not null default now()
);
alter table public.meal_suggestions enable row level security;

drop policy if exists "lire les repas validés" on public.meal_suggestions;
create policy "lire les repas validés" on public.meal_suggestions
  for select to anon, authenticated using (status = 'approved');
-- Seules les colonnes utiles à l'appli sont lisibles (jamais l'auteur de la proposition).
revoke all on public.meal_suggestions from anon, authenticated;
grant select (id, name, portion_g, kcal, prot, gluc, lip, price, status) on public.meal_suggestions to anon, authenticated;
