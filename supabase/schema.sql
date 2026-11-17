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

-- 4. Messages de la page Contact (idées, bugs, questions). Écriture et lecture UNIQUEMENT par le serveur
--    et par toi dans Table Editor > feedback. Aucune policy = aucun accès pour les visiteurs.
create table if not exists public.feedback (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('idee', 'probleme', 'abonnement', 'compte', 'autre')),
  message    text not null check (char_length(message) between 10 and 2000),
  email      text check (email is null or char_length(email) <= 254),
  page       text,
  done       boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.feedback enable row level security;
revoke all on public.feedback from anon, authenticated;

-- 5. Packs d'utilisations (achat unique, sans abonnement). Le solde n'est modifié QUE par les deux fonctions ci-dessous,
--    appelées par le serveur avec la clé secrète. Chaque utilisateur peut lire son propre solde.
create table if not exists public.credits (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  balance    integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);
alter table public.credits enable row level security;
drop policy if exists "lire son solde" on public.credits;
create policy "lire son solde" on public.credits
  for select to authenticated using ((select auth.uid()) = user_id);

-- Chaque paiement de pack n'est crédité qu'une fois (identifiant de session Stripe unique).
create table if not exists public.credit_purchases (
  session_id text primary key,
  user_id    uuid references auth.users (id) on delete set null,
  credits    integer not null,
  cents      integer,
  created_at timestamptz not null default now()
);
alter table public.credit_purchases enable row level security;
revoke all on public.credit_purchases from anon, authenticated;

create or replace function public.add_credits(uid uuid, n integer) returns integer
language sql security definer set search_path = public as $$
  insert into public.credits (user_id, balance, updated_at) values (uid, greatest(n, 0), now())
  on conflict (user_id) do update set balance = public.credits.balance + greatest(excluded.balance, 0), updated_at = now()
  returning balance;
$$;
create or replace function public.use_credit(uid uuid) returns boolean
language sql security definer set search_path = public as $$
  with u as (
    update public.credits set balance = balance - 1, updated_at = now() where user_id = uid and balance > 0 returning 1
  )
  select exists (select 1 from u);
$$;
revoke execute on function public.add_credits(uuid, integer) from public, anon, authenticated;
revoke execute on function public.use_credit(uuid) from public, anon, authenticated;
grant execute on function public.add_credits(uuid, integer) to service_role;
grant execute on function public.use_credit(uuid) to service_role;

-- 6. Droits au plus juste. Visiteurs non connectés (anon) : aucun accès à ces tables.
--    Utilisateurs connectés : lecture de leur abonnement et de leur solde ; lecture, création et
--    modification de leurs propres données (les policies RLS ci-dessus limitent toujours à leurs lignes).
--    Le serveur (service_role) n'est pas concerné.
revoke all on public.user_data, public.subscriptions, public.credits from anon;
revoke all on public.user_data, public.subscriptions, public.credits from authenticated;
grant select on public.subscriptions, public.credits to authenticated;
grant select, insert, update on public.user_data to authenticated;
