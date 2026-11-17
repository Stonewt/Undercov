// Réglages de Bon'Assiette. Ces identifiants ne sont pas secrets (ils apparaissent dans la page).
// Ne JAMAIS mettre de clé secrète ici : les secrets vont dans les variables de Railway.
export default {
  // Google AdSense : identifiant éditeur, par exemple "ca-pub-1234567890123456".
  // Le renseigner suffit pour la validation du site (balise + ads.txt).
  adsClient: "ca-pub-4765209928947760",
  // Mettre à true quand AdSense a approuvé le site et que les emplacements sont créés.
  adsEnabled: false,
  adSlots: { jour: "", recettes: "" },
  // Google Analytics 4 : identifiant de mesure, par exemple "G-ABCDEF1234".
  gaId: "",
  // Abonnement Bon'Assiette+ : prix AFFICHÉ dans l'appli. Le prix réellement facturé est celui du tarif Stripe
  // (variable STRIPE_PRICE_ID dans Railway) : les deux doivent correspondre.
  premiumPrice: "2,99 €/mois",
  // Pack d'utilisations (achat unique, sans abonnement) : prix AFFICHÉ et nombre d'utilisations. Le prix facturé est celui
  // du tarif Stripe STRIPE_PACK_PRICE_ID (créé par scripts/setup.mjs avec PACK_CENTS) : les deux doivent correspondre.
  packPrice: "1,49 €",
  packCredits: 5
};
