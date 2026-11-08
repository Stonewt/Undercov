// Réglages de Bon'Assiette. Ces identifiants ne sont pas secrets (ils apparaissent dans la page).
// Ne JAMAIS mettre de clé secrète ici : les secrets vont dans les variables de Railway.
export default {
  // Google AdSense : identifiant éditeur, par exemple "ca-pub-1234567890123456".
  // Le renseigner suffit pour la validation du site (balise + ads.txt).
  adsClient: "",
  // Mettre à true quand AdSense a approuvé le site et que les emplacements sont créés.
  adsEnabled: false,
  adSlots: { jour: "", recettes: "" },
  // Google Analytics 4 : identifiant de mesure, par exemple "G-ABCDEF1234".
  gaId: ""
};
