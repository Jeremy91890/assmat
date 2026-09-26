/* En-tête commun à l'app et au guide : bouton « Installer » et suivi des clics « Soutenir ». */

(() => {
  'use strict';

  // Lien externe simple : seul le clic est compté (sans donnée personnelle).
  document.querySelectorAll('[data-don]').forEach(a =>
    a.addEventListener('click', () => Analytics.event(`don-${a.dataset.don}`)));

  const btn = document.getElementById('btn-install');
  const dlg = document.getElementById('dlg-install');
  if (!btn) return;

  // iOS n'implémente pas `beforeinstallprompt` : Safari comme Chrome passent par le
  // menu Partager. On affiche donc le bouton d'emblée avec la marche à suivre.
  const estIOS = /iP(hone|ad|od)/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS se déclare macOS
  const dejaInstalle = () =>
    window.navigator.standalone === true
    || window.matchMedia('(display-mode: standalone)').matches;

  let promptInstall = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    promptInstall = e;
    btn.hidden = false;
  });

  if (estIOS && !dejaInstalle()) btn.hidden = false;

  btn.addEventListener('click', async () => {
    if (!promptInstall) { dlg.showModal(); return; }
    promptInstall.prompt();
    await promptInstall.userChoice;
    promptInstall = null;
    btn.hidden = true;
  });

  window.addEventListener('appinstalled', () => { btn.hidden = true; Analytics.event('installation'); });
})();
