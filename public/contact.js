// Page Contact : envoie le message au serveur Bon'Assiette, qui l'enregistre pour l'équipe.
(() => {
  const $ = (id) => document.getElementById(id);
  // Si la personne est connectée dans l'appli, son e-mail est proposé d'office.
  try {
    const s = JSON.parse(localStorage.getItem("g-auth") || "null");
    const mail = s?.user?.email || s?.currentSession?.user?.email;
    if (typeof mail === "string" && mail.length < 255) $("email").value = mail;
  } catch { /* stockage indisponible */ }
  if (new URLSearchParams(location.search).get("sujet") === "abonnement") $("kind").value = "abonnement";

  $("contactForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const message = $("message").value.trim(), email = $("email").value.trim();
    if (message.length < 10) { $("msg").textContent = "Ton message est un peu court : dis-nous en un peu plus."; $("message").focus(); return; }
    if (email && !/^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i.test(email)) { $("msg").textContent = "Cette adresse e-mail ne semble pas valide."; $("email").focus(); return; }
    $("send").disabled = true; $("msg").textContent = "Envoi…";
    const r = await fetch("/api/contact", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: $("kind").value, message, email, website: $("website").value })
    }).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    $("send").disabled = false;
    if (r?.ok) {
      $("contactForm").reset();
      $("msg").textContent = email ? "Merci, c'est bien reçu ! On te répond par e-mail dès que possible." : "Merci, c'est bien reçu !";
    } else $("msg").textContent = j?.error || "L'envoi a échoué. Vérifie ta connexion et réessaie.";
  });
})();
