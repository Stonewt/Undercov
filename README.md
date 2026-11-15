# Bon'Assiette

Compteur de calories gratuit et français (table Ciqual), avec recettes pas chères, suivi de l'eau et des séances,
comptes facultatifs (Supabase) et abonnement Bon'Assiette+ (Stripe) qui ouvre l'analyse photo et retire la pub.

- Serveur : `node server.js` (Node 20+). Aucune base locale : tout est chez Supabase et Stripe.
- Réglages publics : `config.js`. Secrets : variables d'environnement Railway, jamais dans le code.

## Mise en service en une commande

1. Remplis `.env.setup` (fichier ignoré par git) avec quatre jetons : `SUPABASE_ACCESS_TOKEN` (supabase.com → compte → Access Tokens),
   `STRIPE_SECRET_KEY` (Stripe → Développeurs → Clés API), `RAILWAY_TOKEN` (Railway → Account settings → Tokens),
   `ANTHROPIC_API_KEY` (console.anthropic.com → API keys).
2. `node scripts/setup.mjs` : crée le projet Supabase et son schéma, le produit, le tarif, le webhook et le portail Stripe,
   puis enregistre toutes les variables dans Railway et vérifie le site. Rejouable sans danger.
3. Supprime `.env.setup`.

La liste manuelle ci-dessous décrit ce que fait le script, si tu préfères le faire à la main.

## Mise en service en une commande

1. Remplis `.env.setup` (fichier ignoré par git) avec quatre jetons : `SUPABASE_ACCESS_TOKEN` (supabase.com → compte → Access Tokens),
   `STRIPE_SECRET_KEY` (Stripe → Développeurs → Clés API), `RAILWAY_TOKEN` (Railway → Account settings → Tokens),
   `ANTHROPIC_API_KEY` (console.anthropic.com → API keys).
2. `node scripts/setup.mjs` : crée le projet Supabase et son schéma, le produit, le tarif, le webhook et le portail Stripe,
   puis enregistre toutes les variables dans Railway et vérifie le site. Rejouable sans danger.
3. Supprime `.env.setup`.

La liste manuelle ci-dessous décrit ce que fait le script, si tu préfères le faire à la main.

## Mise en service : la liste à cocher

### 1. Comptes (Supabase)
1. Créer un projet sur supabase.com (région UE, par exemple Francfort ou Paris).
2. SQL Editor → coller `supabase/schema.sql` → Run.
3. Authentication → Providers → Email : laisser « Enable email provider » et activer **Magic link** (pas de mot de passe).
4. Authentication → URL Configuration : Site URL = `https://www.bonassiette.fr`, Redirect URLs = `https://www.bonassiette.fr/`.
5. Project Settings → API : copier **Project URL**, **anon public** et **service_role** (secrète).
6. Variables Railway : `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

Sans ces trois variables, le panneau « Mon compte » n'apparaît pas et l'abonnement reste fermé.

### 2. Abonnement Bon'Assiette+ (Stripe)
1. Créer un compte sur stripe.com, renseigner l'entreprise (entrepreneur individuel, SIRET) et le RIB.
2. Catalogue produits → Ajouter un produit « Bon'Assiette+ », tarif **récurrent mensuel**, prix TTC
   identique à `premiumPrice` dans `config.js` (2,99 € par défaut). Copier l'identifiant `price_…`.
3. Développeurs → Clés API : copier la **clé secrète** `sk_live_…` (ou `sk_test_…` pour essayer).
4. Développeurs → Webhooks → Ajouter un point de terminaison : `https://www.bonassiette.fr/api/stripe/webhook`,
   événements `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`.
   Copier le **secret de signature** `whsec_…`.
5. Paramètres → Facturation → **Portail client** : enregistrer la configuration par défaut en autorisant
   la résiliation et la mise à jour du moyen de paiement (obligatoire, sinon « Gérer mon abonnement » échoue).
6. Paramètres → Taxes : activer la TVA automatique si tu y es assujetti (pas nécessaire en franchise de TVA).
7. Variables Railway : `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`.

Pour tester sans payer : clés `sk_test_…`, carte `4242 4242 4242 4242`, webhook pointé sur l'adresse de test.

### 3. Analyse photo (Anthropic)
- Variable Railway `ANTHROPIC_API_KEY`. Facultatif : `ANALYSE_MODEL` (défaut `claude-haiku-5-5`),
  `ANALYSE_DAILY_CAP` (plafond d'analyses par jour pour tout le site, défaut 300).
- Seuls les abonnés connectés peuvent lancer une analyse : 6 par jour et par compte.

### 4. Adresse et publicité
- `CANONICAL_HOST=www.bonassiette.fr` : les anciennes adresses redirigent vers la bonne.
- AdSense : l'identifiant éditeur est dans `config.js`. Quand Google a approuvé le site, créer deux
  emplacements, mettre leurs identifiants dans `adSlots` et passer `adsEnabled` à `true`.
- Google Analytics : mettre l'identifiant `G-…` dans `gaId`.

## Comment fonctionne l'abonnement
1. Le visiteur crée un compte (lien par e-mail), puis appuie sur « S'abonner » dans la fenêtre Bon'Assiette+.
2. Le serveur (`/api/checkout`) vérifie son jeton Supabase et crée une session Stripe Checkout.
3. Après paiement, Stripe appelle `/api/stripe/webhook` ; le serveur écrit le statut dans la table
   `subscriptions` (clé service_role). C'est la seule source de vérité.
4. L'appli lit son statut dans `subscriptions` (lecture seule, RLS) pour afficher les fonctions ;
   le serveur le revérifie à chaque analyse photo.
5. « Gérer ou résilier mon abonnement » ouvre le portail client Stripe (`/api/portal`).
   La suppression du compte résilie d'abord l'abonnement chez Stripe.

## Vérification rapide après déploiement
- `https://www.bonassiette.fr/api/status` doit répondre `{"photo":true,"premium":true}`.
- Dans Stripe → Webhooks, le dernier événement doit afficher une réponse 200.
