/* Persistance locale (localStorage). Tout reste sur l'appareil : aucun serveur. */

const Store = (() => {
  const KEY_SETTINGS = 'assmat.settings.v1';
  const KEY_DAYS     = 'assmat.days.v1';

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

  /** Fusion superficielle avec les valeurs par défaut (migration douce). */
  function loadSettings() {
    const saved = read(KEY_SETTINGS, {});
    const s = { ...Calc.DEFAULTS, ...saved };
    // Les repas sont fusionnés ligne à ligne pour absorber l'ajout de nouveaux types.
    s.repas = Calc.DEFAULTS.repas.map(def => {
      const found = (saved.repas || []).find(r => r.id === def.id);
      return found ? { ...def, ...found } : { ...def };
    });
    s.typeRepas = { ...Calc.DEFAULTS.typeRepas, ...(saved.typeRepas || {}) };
    return s;
  }

  const saveSettings = s => write(KEY_SETTINGS, s);

  const loadDays = () => read(KEY_DAYS, {});
  const saveDays = d => write(KEY_DAYS, d);

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

  /** Export complet (paramètres + historique) pour sauvegarde externe. */
  function exportJSON() {
    return JSON.stringify({
      version: 1,
      exporte: new Date().toISOString(),
      settings: loadSettings(),
      days: loadDays()
    }, null, 2);
  }

  /** Import d'une sauvegarde. Renvoie { ok, message }. */
  function importJSON(text) {
    let data;
    try { data = JSON.parse(text); }
    catch { return { ok: false, message: 'Fichier illisible (JSON invalide).' }; }
    if (!data || typeof data !== 'object' || (!data.days && !data.settings)) {
      return { ok: false, message: 'Ce fichier ne ressemble pas à une sauvegarde Assmat.' };
    }
    if (data.settings) saveSettings({ ...Calc.DEFAULTS, ...data.settings });
    if (data.days) saveDays(data.days);
    return { ok: true, message: 'Sauvegarde restaurée.' };
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
    lines.push(['Jours d’activité', resume.joursPresence].map(esc).join(sep));
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
    exportJSON, importJSON, exportCSV, download
  };
})();
