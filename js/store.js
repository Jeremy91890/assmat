/* Persistance locale (localStorage). Tout reste sur l'appareil : aucun serveur. */

const Store = (() => {
  // Un index des contrats (un par enfant) et, pour chacun, ses paramètres et ses journées.
  const KEY_INDEX = 'assmat.contrats.v1';
  const keySettings = id => `assmat.settings.${id}`;
  const keyDays = id => `assmat.days.${id}`;
  // Anciennes versions : un seul contrat, sous ces deux clés.
  const OLD_SETTINGS = 'assmat.settings.v1';
  const OLD_DAYS = 'assmat.days.v1';

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.warn('Lecture impossible', key, e);
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('Écriture impossible', key, e);
      return false;
    }
  }

  function remove(key) {
    try { localStorage.removeItem(key); } catch { /* stockage indisponible */ }
  }

  /* ---------- Index des contrats ---------- */

  /** Index { actif, ids } ; crée le premier contrat (en reprenant l'ancien format) au besoin. */
  function index() {
    const idx = read(KEY_INDEX, null);
    if (idx && Array.isArray(idx.ids) && idx.ids.length) {
      if (!idx.ids.includes(idx.actif)) idx.actif = idx.ids[0];
      return idx;
    }
    // Migration : l'unique contrat des anciennes versions devient « c1 », sans perte.
    const neuf = { actif: 'c1', ids: ['c1'] };
    write(keySettings('c1'), read(OLD_SETTINGS, {}));
    write(keyDays('c1'), read(OLD_DAYS, {}));
    write(KEY_INDEX, neuf);
    remove(OLD_SETTINGS);
    remove(OLD_DAYS);
    return neuf;
  }

  const actif = () => index().actif;

  /* ---------- Paramètres et journées (contrat actif par défaut) ---------- */

  /** Fusion superficielle avec les valeurs par défaut (migration douce). */
  function loadSettings(id = actif()) {
    const saved = read(keySettings(id), {});
    const s = { ...Calc.DEFAULTS, ...saved };
    // Les repas sont fusionnés ligne à ligne pour absorber l'ajout de nouveaux types.
    s.repas = Calc.DEFAULTS.repas.map(def => {
      const found = (saved.repas || []).find(r => r.id === def.id);
      return found ? { ...def, ...found } : { ...def };
    });
    s.typeRepas = { ...Calc.DEFAULTS.typeRepas, ...(saved.typeRepas || {}) };
    // Anciennes versions : le type d'année se déduisait du nombre de semaines, et les
    // congés payés étaient une simple case « 10 % chaque mois ».
    if (saved.typeAnnee === undefined && saved.semainesAn !== undefined) {
      s.typeAnnee = saved.semainesAn < 52 ? 'incomplete' : 'complete';
      if (s.typeAnnee === 'complete') s.semainesAn = Calc.DEFAULTS.semainesAn;
    }
    if (saved.cpMode === undefined && saved.cpActif) s.cpMode = 'mensuel';
    delete s.cpActif;
    if (!Calc.COULEURS[s.couleur]) s.couleur = Calc.DEFAULTS.couleur;
    return s;
  }

  const saveSettings = (s, id = actif()) => write(keySettings(id), s);

  const loadDays = (id = actif()) => read(keyDays(id), {});
  const saveDays = (d, id = actif()) => write(keyDays(id), d);

  /** Sauvegarde d'un jour ; une entrée vide est supprimée pour ne pas polluer. */
  function setDay(days, date, jour) {
    const vide = !jour
      || (jour.statut === 'present'
          && !Number(jour.heures)
          && !Object.values(jour.repas || {}).some(Number)
          && !Number(jour.km)
          && !(jour.note || '').trim());
    if (vide) delete days[date];
    else days[date] = jour;
    saveDays(days);
    return days;
  }

  /* ---------- Gestion des contrats ---------- */

  /** Liste pour la barre de sélection : [{ id, enfant, couleur, actif }]. */
  function contrats() {
    const idx = index();
    return idx.ids.map(id => {
      const s = loadSettings(id);
      return { id, enfant: s.enfant, couleur: s.couleur, actif: id === idx.actif };
    });
  }

  function activer(id) {
    const idx = index();
    if (!idx.ids.includes(id)) return false;
    idx.actif = id;
    return write(KEY_INDEX, idx);
  }

  /** Première couleur de la palette que n'utilise encore aucun contrat. */
  function couleurLibre(prises) {
    const libres = Object.keys(Calc.COULEURS).filter(c => !prises.includes(c));
    return libres[0] || Object.keys(Calc.COULEURS)[prises.length % Object.keys(Calc.COULEURS).length];
  }

  /** Nouveau contrat : copie des paramètres du contrat actif, sans les journées. Devient actif. */
  function ajouterContrat() {
    const idx = index();
    let n = idx.ids.length + 1;
    while (idx.ids.includes(`c${n}`)) n++;
    const id = `c${n}`;
    const copie = { ...loadSettings(), enfant: '', couleur: couleurLibre(contrats().map(c => c.couleur)) };
    saveSettings(copie, id);
    saveDays({}, id);
    idx.ids.push(id);
    idx.actif = id;
    write(KEY_INDEX, idx);
    return id;
  }

  /** Supprime un contrat (jamais le dernier). Renvoie false si refusé. */
  function supprimerContrat(id) {
    const idx = index();
    if (idx.ids.length <= 1 || !idx.ids.includes(id)) return false;
    idx.ids = idx.ids.filter(x => x !== id);
    if (idx.actif === id) idx.actif = idx.ids[0];
    write(KEY_INDEX, idx);
    remove(keySettings(id));
    remove(keyDays(id));
    return true;
  }

  /** Efface tout : contrats, paramètres, journées (les préférences d'autres sites sont intactes). */
  function effacerTout() {
    const idx = read(KEY_INDEX, null);
    for (const id of (idx && idx.ids) || []) { remove(keySettings(id)); remove(keyDays(id)); }
    [KEY_INDEX, OLD_SETTINGS, OLD_DAYS].forEach(remove);
  }

  /* ---------- Sauvegarde / restauration ---------- */

  /** Export complet (tous les contrats) pour sauvegarde externe. */
  function exportJSON() {
    const idx = index();
    return JSON.stringify({
      version: 2,
      exporte: new Date().toISOString(),
      actif: idx.ids.indexOf(idx.actif),
      contrats: idx.ids.map(id => ({ settings: loadSettings(id), days: loadDays(id) }))
    }, null, 2);
  }

  /** Import d'une sauvegarde (v2 multi-contrats, ou v1 à contrat unique). Renvoie { ok, message }. */
  function importJSON(text) {
    let data;
    try { data = JSON.parse(text); }
    catch { return { ok: false, message: 'Fichier illisible (JSON invalide).' }; }
    const liste = data && Array.isArray(data.contrats) ? data.contrats
      : data && (data.days || data.settings) ? [{ settings: data.settings, days: data.days }]
      : null;
    if (!liste || !liste.length) {
      return { ok: false, message: 'Ce fichier ne ressemble pas à une sauvegarde Pay Assmat.' };
    }
    effacerTout();
    const ids = liste.map((c, i) => {
      const id = `c${i + 1}`;
      // Enregistrés tels quels : loadSettings complète avec les valeurs par défaut et migre
      // les sauvegardes d'anciennes versions.
      write(keySettings(id), (c && c.settings) || {});
      write(keyDays(id), (c && c.days) || {});
      return id;
    });
    write(KEY_INDEX, { actif: ids[Number(data.actif)] || ids[0], ids });
    return {
      ok: true,
      message: ids.length > 1 ? `Sauvegarde restaurée (${ids.length} contrats).` : 'Sauvegarde restaurée.'
    };
  }

  /** CSV du mois : une ligne par jour saisi. */
  function exportCSV(resume, s) {
    const repasActifs = (s.repas || []).filter(r => r.actif);
    const sep = ';';
    const esc = v => {
      const t = String(v ?? '');
      return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const head = ['Date', 'Jour', 'Statut', 'Heures',
      ...repasActifs.map(r => r.label),
      'Indemnité entretien', 'Km', 'Note'];
    const lines = [head.join(sep)];

    for (const j of resume.jours) {
      lines.push([
        j.date,
        Calc.parseISO(j.date).toLocaleDateString('fr-FR', { weekday: 'long' }),
        (Calc.ABSENCES[j.statut] || {}).label || j.statut,
        Calc.fmtNum(j.heures),
        ...repasActifs.map(r => Number(j.repas[r.id]) || 0),
        Calc.fmtNum(Calc.entretienJour(j.heures, s)),
        j.km || 0,
        j.note || ''
      ].map(esc).join(sep));
    }

    lines.push('');
    lines.push(['TOTAUX'].join(sep));
    lines.push(['Heures totales', Calc.fmtNum(resume.totalHeures)].map(esc).join(sep));
    lines.push(['Jours de présence', resume.joursPresence].map(esc).join(sep));
    for (const l of resume.lignes) {
      lines.push([l.libelle, Calc.fmtNum(l.brut)].map(esc).join(sep));
    }
    lines.push(['Salaire brut', Calc.fmtNum(resume.brut)].map(esc).join(sep));
    lines.push([`Cotisations salariales (${s.tauxCotisations} %)`, Calc.fmtNum(-resume.cotisations)].map(esc).join(sep));
    lines.push(['Salaire net', Calc.fmtNum(resume.netSalaire)].map(esc).join(sep));
    lines.push(['Indemnités d’entretien', Calc.fmtNum(resume.entretien)].map(esc).join(sep));
    for (const r of resume.repasDetail) {
      lines.push([`${r.label} (${r.nb})`, Calc.fmtNum(r.total)].map(esc).join(sep));
    }
    if (resume.kmTotal) lines.push(['Frais kilométriques', Calc.fmtNum(resume.kmTotal)].map(esc).join(sep));
    lines.push(['NET À PAYER', Calc.fmtNum(resume.netAPayer)].map(esc).join(sep));

    // BOM UTF-8 : indispensable pour qu'Excel affiche correctement les accents.
    return '﻿' + lines.join('\r\n');
  }

  /** Déclenche un téléchargement local (aucune donnée n'est envoyée). */
  function download(filename, content, mime) {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return {
    loadSettings, saveSettings, loadDays, saveDays, setDay,
    contrats, activer, ajouterContrat, supprimerContrat, effacerTout,
    exportJSON, importJSON, exportCSV, download
  };
})();

if (typeof module !== 'undefined') module.exports = Store;
