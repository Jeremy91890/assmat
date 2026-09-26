/* Mesure d'audience GoatCounter : sans cookie ni identifiant stocké, pas de bannière
   de consentement nécessaire. Les journées et paramètres saisis ne sont jamais transmis :
   seuls la visite (page, référent, taille d'écran) et quelques clics sont comptés.
   Tableau de bord : https://<code>.goatcounter.com */

const Analytics = (() => {

  // Code du site GoatCounter (sous-domaine choisi à l'inscription). Vide = mesure désactivée.
  const CODE = 'pay-assmat';

  // Pas de mesure en développement local.
  const actif = CODE && !/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname)
    && location.protocol === 'https:';

  if (actif) {
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://gc.zgo.at/count.js';
    s.dataset.goatcounter = `https://${CODE}.goatcounter.com/count`;
    document.head.appendChild(s);
  }

  /** Compte un événement (clic sur une action) ; sans effet hors ligne ou si désactivé. */
  function event(nom) {
    if (!actif || !window.goatcounter || !window.goatcounter.count) return;
    window.goatcounter.count({ path: nom, title: nom, event: true });
  }

  return { event };
})();
