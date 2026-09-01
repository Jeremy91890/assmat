/* Interface : calendrier de saisie, paramètres, fiche de paie. */

(() => {
  'use strict';

  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const JOURS_COURTS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

  /* ---------- État ---------- */

  let settings = Store.loadSettings();
  let days     = Store.loadDays();
  let moisCal  = Calc.monthKey(new Date());   // mois affiché dans le calendrier
  let moisPaie = moisCal;                     // mois affiché dans la fiche de paie
  let jourEdite = null;                       // 'YYYY-MM-DD' en cours d'édition
  let brouillon = null;                       // copie de travail du jour édité

  const repasActifs = () => settings.repas.filter(r => r.actif);

  /* ---------- Notifications ---------- */

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  /* ---------- Onglets ---------- */

  function showView(name) {
    $$('.tab').forEach(t => {
      const on = t.dataset.view === name;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
    });
    $$('.view').forEach(v => v.classList.toggle('is-active', v.id === `vue-${name}`));
    if (name === 'paie') renderPaie();
    window.scrollTo({ top: 0 });
  }

  $$('.tab').forEach(t => t.addEventListener('click', () => showView(t.dataset.view)));

  /* ================= CALENDRIER ================= */

  function renderCalendrier() {
    $('#mois-titre').textContent = Calc.fmtMois(moisCal);
    $('#brand-sub').textContent = settings.enfant
      ? `Garde de ${settings.enfant}`
      : 'Suivi de garde';

    const resume = Calc.month(moisCal, days, settings);
    renderStats(resume);
    renderGrid(resume);
    renderQuickFill();
  }

  function renderStats(resume) {
    const cible = settings.mode === 'mensualisation'
      ? Calc.heuresMensualisees(settings) : null;
    const ecart = cible !== null ? resume.totalHeures - cible : null;

    const cards = [
      { v: Calc.fmtH(resume.totalHeures), l: 'Heures' },
      { v: resume.joursPresence, l: 'Jours' },
      {
        v: cible !== null ? (ecart >= 0 ? '+' : '−') + Calc.fmtH(Math.abs(ecart)) : Calc.fmtH(resume.heures.maj1 + resume.heures.maj2),
        l: cible !== null ? 'vs mensualisé' : 'Majorées'
      },
      { v: Calc.fmtEur(resume.netAPayer), l: 'Net à payer', hero: true }
    ];

    $('#stats').innerHTML = cards.map(c =>
      `<div class="stat${c.hero ? ' hero' : ''}"><b>${c.v}</b><span>${c.l}</span></div>`
    ).join('');
  }

  function renderGrid(resume) {
    const [y, m] = moisCal.split('-').map(Number);
    const premier = new Date(y, m - 1, 1);
    const offset = (premier.getDay() + 6) % 7;              // lundi = 0
    const nbJours = new Date(y, m, 0).getDate();
    const aujourdhui = Calc.isoDate(new Date());

    // Totaux hebdomadaires calculés par le moteur (bornés au mois, comme la paie).
    const totalSemaine = new Map(resume.semaines.map(w => [w.week, w.heures]));
    const seuil = Number(settings.seuilMajoration) || Infinity;

    const cells = [];
    let semaineCourante = null;

    const pousseSomme = () => {
      const h = semaineCourante !== null ? totalSemaine.get(semaineCourante) : null;
      const over = h > seuil;
      cells.push(`<div class="wsum${over ? ' over' : ''}">${h ? Calc.fmtH(h) : ''}</div>`);
    };

    for (let i = 0; i < offset; i++) cells.push('<div class="day is-out"></div>');

    for (let d = 1; d <= nbJours; d++) {
      const date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      semaineCourante = Calc.weekKey(date);
      const dow = (new Date(y, m - 1, d).getDay() + 6) % 7;
      const j = days[date];
      const statut = j ? (j.statut || 'present') : null;
      const heures = j && statut === 'present' ? Number(j.heures) || 0 : 0;
      const nbRepas = j ? Object.values(j.repas || {}).reduce((a, n) => a + (Number(n) || 0), 0) : 0;

      const classes = ['day'];
      if (dow >= 5) classes.push('is-we');
      if (date === aujourdhui) classes.push('is-today');
      if (heures > 0) classes.push('filled');
      else if (j && statut !== 'present') classes.push('off');

      let contenu = '';
      if (heures > 0) contenu = `<span class="h">${Calc.fmtH(heures)}</span>`;
      else if (j && statut !== 'present') contenu = `<span class="h">${abbrev(statut)}</span>`;

      const dots = nbRepas > 0
        ? `<span class="dots">${'<span class="dot"></span>'.repeat(Math.min(nbRepas, 3))}</span>`
        : '';

      cells.push(
        `<button type="button" class="${classes.join(' ')}" data-date="${date}" ` +
        `aria-label="${Calc.fmtJour(date)}"><span class="n">${d}</span>${contenu}${dots}</button>`
      );

      if (dow === 6) pousseSomme();                          // dimanche : fin de ligne
    }

    // Complète la dernière ligne, sauf si le mois se terminait un dimanche
    // (auquel cas la somme de la semaine a déjà été poussée).
    const reste = (7 - ((offset + nbJours) % 7)) % 7;
    if (reste > 0) {
      for (let i = 0; i < reste; i++) cells.push('<div class="day is-out"></div>');
      pousseSomme();
    }

    $('#cal-grid').innerHTML = cells.join('');
  }

  const abbrev = statut => ({
    absent: 'abs.', conge: 'congé', ferie: 'férié', maladie: 'malad.'
  }[statut] || '');

  $('#cal-grid').addEventListener('click', e => {
    const btn = e.target.closest('.day[data-date]');
    if (btn) ouvrirJour(btn.dataset.date);
  });

  $('#mois-prev').addEventListener('click', () => { moisCal = Calc.shiftMonth(moisCal, -1); renderCalendrier(); });
  $('#mois-next').addEventListener('click', () => { moisCal = Calc.shiftMonth(moisCal, 1);  renderCalendrier(); });
  $('#mois-today').addEventListener('click', () => { moisCal = Calc.monthKey(new Date());   renderCalendrier(); });

  /* ---------- Remplissage rapide ---------- */

  function renderQuickFill() {
    const r = repasActifs().filter(x => (settings.typeRepas[x.id] || 0) > 0)
      .map(x => x.label.toLowerCase());
    $('#type-desc').textContent =
      Calc.fmtH(settings.typeHeures) + (r.length ? ` + ${r.join(', ')}` : '');

    $('#jours-contrat').innerHTML = JOURS_COURTS.map((lab, i) => {
      const n = i + 1;
      const on = settings.joursAccueil.includes(n);
      return `<button type="button" class="chip" data-dow="${n}" aria-pressed="${on}">${lab}</button>`;
    }).join('');
  }

  $('#jours-contrat').addEventListener('click', e => {
    const c = e.target.closest('.chip'); if (!c) return;
    const n = Number(c.dataset.dow);
    const set = new Set(settings.joursAccueil);
    set.has(n) ? set.delete(n) : set.add(n);
    settings.joursAccueil = [...set].sort();
    Store.saveSettings(settings);
    renderQuickFill();
  });

  /** Applique la journée type aux jours d'accueil, sans écraser l'existant. */
  function remplir(dates) {
    let n = 0;
    for (const date of dates) {
      const dow = ((Calc.parseISO(date).getDay() + 6) % 7) + 1;
      if (!settings.joursAccueil.includes(dow)) continue;
      if (days[date]) continue;
      const repas = {};
      for (const r of repasActifs()) {
        const v = Number(settings.typeRepas[r.id]) || 0;
        if (v) repas[r.id] = v;
      }
      days[date] = { statut: 'present', heures: Number(settings.typeHeures) || 0, repas, km: 0, note: '' };
      n++;
    }
    Store.saveDays(days);
    renderCalendrier();
    toast(n ? `${n} journée${n > 1 ? 's' : ''} ajoutée${n > 1 ? 's' : ''}.` : 'Rien à ajouter.');
  }

  $('#fill-month').addEventListener('click', () => remplir(Calc.daysOfMonth(moisCal)));

  $('#fill-week').addEventListener('click', () => {
    const ref = Calc.monthKey(new Date()) === moisCal ? new Date() : Calc.parseISO(`${moisCal}-01`);
    const lundi = new Date(ref);
    lundi.setDate(lundi.getDate() - ((lundi.getDay() + 6) % 7));
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(lundi); d.setDate(lundi.getDate() + i);
      dates.push(Calc.isoDate(d));
    }
    remplir(dates);
  });

  $('#clear-month').addEventListener('click', () => {
    const dates = Calc.daysOfMonth(moisCal).filter(d => days[d]);
    if (!dates.length) return toast('Ce mois est déjà vide.');
    if (!confirm(`Effacer les ${dates.length} journées saisies de ${Calc.fmtMois(moisCal)} ?`)) return;
    dates.forEach(d => delete days[d]);
    Store.saveDays(days);
    renderCalendrier();
    toast('Mois vidé.');
  });

  /* ================= ÉDITEUR DE JOURNÉE ================= */

  const dlg = $('#dlg-jour');

  function ouvrirJour(date) {
    jourEdite = date;
    const j = days[date];
    brouillon = j
      ? { statut: j.statut || 'present', heures: Number(j.heures) || 0, repas: { ...(j.repas || {}) }, km: Number(j.km) || 0, note: j.note || '' }
      : {
          statut: 'present',
          heures: Number(settings.typeHeures) || 0,
          repas: Object.fromEntries(repasActifs().map(r => [r.id, Number(settings.typeRepas[r.id]) || 0])),
          km: 0, note: ''
        };

    $('#dlg-titre').textContent = Calc.fmtJour(date).replace(/^./, c => c.toUpperCase());
    $('#dlg-sub').textContent = j ? 'Journée déjà enregistrée' : 'Nouvelle journée';
    $('#fs-km').hidden = !settings.kmActif;
    $('#dlg-km').value = brouillon.km || '';
    $('#dlg-note').value = brouillon.note;

    $('#dlg-statut').innerHTML = Object.entries(Calc.ABSENCES).map(([k, v]) =>
      `<button type="button" class="chip" data-statut="${k}" aria-pressed="${brouillon.statut === k}">${v.label}</button>`
    ).join('');

    const quick = [...new Set([Number(settings.typeHeures) || 0, 4, 6, 8, 9, 10, 11])]
      .filter(h => h > 0).sort((a, b) => a - b);
    $('#dlg-heures-quick').innerHTML = quick.map(h =>
      `<button type="button" class="chip" data-quick="${h}">${Calc.fmtH(h)}</button>`
    ).join('');

    syncDialogue();
    dlg.showModal();
  }

  function syncDialogue() {
    const present = brouillon.statut === 'present';
    $('#fs-heures').hidden = !present;
    $('#fs-repas').hidden = !present || repasActifs().length === 0;
    $('#dlg-heures').value = brouillon.heures || 0;

    $$('#dlg-statut .chip').forEach(c =>
      c.setAttribute('aria-pressed', String(c.dataset.statut === brouillon.statut)));

    const ent = Calc.entretienJour(present ? brouillon.heures : 0, settings);
    $('#dlg-entretien').textContent = present && ent
      ? `Indemnité d’entretien : ${Calc.fmtEur(ent)}`
      : 'Aucune indemnité d’entretien.';

    $('#dlg-repas').innerHTML = repasActifs().map(r => {
      const n = Number(brouillon.repas[r.id]) || 0;
      return `<div class="counter">
        <div>${r.label}<small>${Calc.fmtEur(r.prix)} l’unité</small></div>
        <div class="ctrl">
          <button type="button" class="btn icon" data-repas="${r.id}" data-delta="-1" aria-label="Moins">−</button>
          <span class="val">${n}</span>
          <button type="button" class="btn icon" data-repas="${r.id}" data-delta="1" aria-label="Plus">+</button>
        </div>
      </div>`;
    }).join('');
  }

  dlg.addEventListener('click', e => {
    const st = e.target.closest('[data-statut]');
    if (st) { brouillon.statut = st.dataset.statut; return syncDialogue(); }

    const q = e.target.closest('[data-quick]');
    if (q) { brouillon.heures = Number(q.dataset.quick); return syncDialogue(); }

    const h = e.target.closest('[data-h]');
    if (h) {
      brouillon.heures = Math.min(24, Math.max(0, brouillon.heures + Number(h.dataset.h)));
      return syncDialogue();
    }

    const r = e.target.closest('[data-repas]');
    if (r) {
      const id = r.dataset.repas;
      const v = (Number(brouillon.repas[id]) || 0) + Number(r.dataset.delta);
      brouillon.repas[id] = Math.min(5, Math.max(0, v));
      return syncDialogue();
    }
  });

  $('#dlg-heures').addEventListener('input', e => {
    brouillon.heures = Math.min(24, Math.max(0, Number(e.target.value) || 0));
    const ent = Calc.entretienJour(brouillon.statut === 'present' ? brouillon.heures : 0, settings);
    $('#dlg-entretien').textContent = ent
      ? `Indemnité d’entretien : ${Calc.fmtEur(ent)}`
      : 'Aucune indemnité d’entretien.';
  });

  /* La sauvegarde est traitée sur `submit` et non sur `close` : certains moteurs
     ne déclenchent pas l'événement `close` lors d'une soumission `method="dialog"`. */
  $('#form-jour').addEventListener('submit', e => {
    const action = (e.submitter && e.submitter.value) || dlg.returnValue;
    if (!brouillon) return;

    if (action === 'save') {
      brouillon.km = Number($('#dlg-km').value) || 0;
      brouillon.note = $('#dlg-note').value.trim();
      if (brouillon.statut !== 'present') { brouillon.heures = 0; brouillon.repas = {}; }
      Store.setDay(days, jourEdite, brouillon);
      toast('Journée enregistrée.');
    } else if (action === 'delete') {
      delete days[jourEdite];
      Store.saveDays(days);
      toast('Journée effacée.');
    }

    jourEdite = brouillon = null;
    if (action === 'save' || action === 'delete') renderCalendrier();
  });

  // Fermeture par Échap ou par la croix : on abandonne simplement le brouillon.
  dlg.addEventListener('close', () => { jourEdite = brouillon = null; });

  /* ================= PARAMÈTRES ================= */

  const form = $('#form-params');

  function renderParams() {
    for (const el of form.elements) {
      if (!el.name || !(el.name in settings)) continue;
      if (el.type === 'checkbox') el.checked = !!settings[el.name];
      else el.value = settings[el.name];
    }

    $('#repas-params').innerHTML = settings.repas.map((r, i) =>
      `<div class="repas-line${r.actif ? '' : ' off'}">
         <input type="checkbox" data-repas-actif="${i}" ${r.actif ? 'checked' : ''} aria-label="Activer ${r.label}">
         <span>${r.label}</span>
         <input type="number" data-repas-prix="${i}" value="${r.prix}" step="0.05" min="0" inputmode="decimal" aria-label="Prix ${r.label}">
       </div>`).join('');

    renderTypeRepas();
    syncConditionnels();
    renderReadouts();
    renderStorageInfo();
  }

  function renderTypeRepas() {
    $('#type-repas').innerHTML = repasActifs().length
      ? repasActifs().map(r =>
          `<div class="repas-line" style="grid-template-columns:1fr 110px">
             <span>${r.label}</span>
             <input type="number" data-type-repas="${r.id}" value="${settings.typeRepas[r.id] || 0}" step="1" min="0" max="5" inputmode="numeric" aria-label="Nombre de ${r.label}">
           </div>`).join('')
      : '<p class="muted">Activez au moins un type de repas ci-dessus.</p>';
  }

  function syncConditionnels() {
    $$('[data-when]', form).forEach(el => {
      const w = el.dataset.when;
      const on = (w === 'bareme' || w === 'fixe') ? settings.entretienMode === w
               : w === 'km' ? settings.kmActif
               : w === 'cp' ? settings.cpActif
               : true;
      el.hidden = !on;
    });
  }

  function renderReadouts() {
    const t = Calc.tauxHoraire(settings);
    $('#taux-readout').textContent = `${Calc.fmtEur(t.brut)} brut = ${Calc.fmtEur(t.net)} net /h`;
    const m = Calc.salaireMensualise(settings);
    $('#mens-readout').textContent = settings.mode === 'mensualisation'
      ? `${Calc.fmtEur(m.brut)} brut — ${Calc.fmtEur(m.net)} net (${Calc.fmtH(m.heures)}/mois)`
      : 'Non applicable (paiement au réel)';
  }

  function renderStorageInfo() {
    const n = Object.keys(days).length;
    const mois = new Set(Object.keys(days).map(d => d.slice(0, 7)));
    $('#storage-info').textContent = n
      ? `${n} journée${n > 1 ? 's' : ''} enregistrée${n > 1 ? 's' : ''} sur ${mois.size} mois.`
      : 'Aucune donnée enregistrée pour l’instant.';
  }

  form.addEventListener('input', e => {
    const el = e.target;

    if (el.dataset.repasActif !== undefined) {
      settings.repas[Number(el.dataset.repasActif)].actif = el.checked;
      el.closest('.repas-line').classList.toggle('off', !el.checked);
    } else if (el.dataset.repasPrix !== undefined) {
      settings.repas[Number(el.dataset.repasPrix)].prix = Number(el.value) || 0;
    } else if (el.dataset.typeRepas !== undefined) {
      settings.typeRepas[el.dataset.typeRepas] = Number(el.value) || 0;
    } else if (el.name && el.name in settings) {
      settings[el.name] = el.type === 'checkbox' ? el.checked
        : el.type === 'number' ? (el.value === '' ? 0 : Number(el.value))
        : el.value;
    } else return;

    Store.saveSettings(settings);
    syncConditionnels();
    renderReadouts();

    // Activer/désactiver un repas change la liste proposée dans la journée type.
    // On ne re-rend que ce bloc, pour ne pas retirer le focus de la case cochée.
    if (el.dataset.repasActif !== undefined) renderTypeRepas();
  });

  form.addEventListener('submit', e => e.preventDefault());

  /* ---------- Import / export / réinitialisation ---------- */

  $('#btn-export').addEventListener('click', () => {
    const d = new Date().toISOString().slice(0, 10);
    Store.download(`assmat-sauvegarde-${d}.json`, Store.exportJSON(), 'application/json');
    toast('Sauvegarde téléchargée.');
  });

  $('#btn-import').addEventListener('click', () => $('#file-import').click());

  $('#file-import').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    if (!confirm('L’import remplace les paramètres et les journées existantes. Continuer ?')) {
      e.target.value = ''; return;
    }
    const res = Store.importJSON(await f.text());
    e.target.value = '';
    if (!res.ok) return toast(res.message);
    settings = Store.loadSettings();
    days = Store.loadDays();
    renderParams(); renderCalendrier();
    toast(res.message);
  });

  $('#btn-reset').addEventListener('click', () => {
    if (!confirm('Effacer définitivement toutes les données (paramètres et journées) ?')) return;
    localStorage.clear();
    settings = Store.loadSettings();
    days = {};
    renderParams(); renderCalendrier();
    toast('Données effacées.');
  });

  /* ================= FICHE DE PAIE ================= */

  function renderPaie() {
    $('#paie-titre').textContent = Calc.fmtMois(moisPaie);
    const r = Calc.month(moisPaie, days, settings);
    const s = settings;

    if (r.joursSaisis === 0 && s.mode === 'reel') {
      $('#paie-content').innerHTML =
        `<div class="card empty"><p>Aucune journée saisie pour ${Calc.fmtMois(moisPaie)}.</p>
         <p class="muted">Renseignez le calendrier pour générer la fiche.</p></div>`;
      return;
    }

    const lignesHtml = r.lignes.map(l => `
      <tr>
        <td>${l.libelle}</td>
        <td class="num">${l.qte !== null ? Calc.fmtNum(l.qte) : ''}</td>
        <td class="num">${l.taux !== null ? Calc.fmtEur(l.taux) : ''}</td>
        <td class="num">${Calc.fmtEur(l.brut)}</td>
      </tr>`).join('');

    const indemLignes = [
      r.entretien ? { l: `Indemnités d’entretien (${r.joursPresence} j)`, v: r.entretien } : null,
      ...r.repasDetail.map(x => ({ l: `${x.label} (${x.nb} × ${Calc.fmtEur(x.prix)})`, v: x.total })),
      r.kmTotal ? { l: `Frais kilométriques (${Calc.fmtNum(r.totalKm)} km)`, v: r.kmTotal } : null
    ].filter(Boolean);

    const semainesHtml = r.semaines.map(w => `
      <tr>
        <td>${Calc.parseISO(w.debut).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}
            – ${Calc.parseISO(w.fin).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}</td>
        <td class="num">${w.jours}</td>
        <td class="num">${Calc.fmtH(w.heures)}</td>
        <td class="num">${w.complementaires ? Calc.fmtH(w.complementaires) : '—'}</td>
        <td class="num">${(w.maj1 + w.maj2) ? Calc.fmtH(w.maj1 + w.maj2) : '—'}</td>
      </tr>`).join('');

    const avertissements = [];
    if (s.mode === 'mensualisation' && r.totalHeures < Calc.heuresMensualisees(s) - 0.01) {
      avertissements.push(`Les heures réellement effectuées (${Calc.fmtH(r.totalHeures)}) sont inférieures aux ` +
        `${Calc.fmtH(Calc.heuresMensualisees(s))} mensualisées : le salaire de base reste dû en intégralité.`);
    }
    if (r.joursSaisis === 0) {
      avertissements.push('Aucune journée saisie ce mois-ci : seule la mensualisation figure sur la fiche.');
    }
    avertissements.push('Une semaine à cheval sur deux mois n’est comptée ici que pour sa part dans le mois, ' +
      'y compris pour le calcul des majorations.');

    $('#paie-content').innerHTML = `
      <article class="paie">
        <div class="paie-head">
          <h1>Bulletin de paie — assistant maternel</h1>
          <p class="periode">Période : ${Calc.fmtMois(moisPaie)}</p>
        </div>

        <div class="parties">
          <div class="partie"><h3>Employeur</h3><p>${esc(s.employeur) || '—'}</p></div>
          <div class="partie"><h3>Salarié</h3><p>${esc(s.assmat) || '—'}</p></div>
          <div class="partie"><h3>Enfant accueilli</h3><p>${esc(s.enfant) || '—'}</p></div>
          <div class="partie"><h3>Contrat</h3><p>${s.mode === 'mensualisation'
            ? `Mensualisation · ${Calc.fmtH(s.heuresSemaine)}/sem. · ${s.semainesAn} sem./an`
            : 'Paiement au réel'}</p></div>
        </div>

        <div class="paie-t-wrap">
        <table class="paie-t">
          <caption>Rémunération</caption>
          <thead><tr><th>Libellé</th><th class="num">Nombre</th><th class="num">Taux</th><th class="num">Montant</th></tr></thead>
          <tbody>
            ${lignesHtml}
            <tr class="sub"><td colspan="3">Salaire brut</td><td class="num">${Calc.fmtEur(r.brut)}</td></tr>
            <tr class="neg"><td colspan="3">Cotisations salariales (${Calc.fmtNum(s.tauxCotisations)} %)</td><td class="num">− ${Calc.fmtEur(r.cotisations)}</td></tr>
            <tr class="sub"><td colspan="3">Salaire net</td><td class="num">${Calc.fmtEur(r.netSalaire)}</td></tr>
          </tbody>
        </table>
        </div>

        ${indemLignes.length ? `
        <div class="paie-t-wrap">
        <table class="paie-t">
          <caption>Indemnités — non soumises à cotisations</caption>
          <tbody>
            ${indemLignes.map(x => `<tr><td>${x.l}</td><td class="num">${Calc.fmtEur(x.v)}</td></tr>`).join('')}
            <tr class="sub"><td>Total des indemnités</td><td class="num">${Calc.fmtEur(r.indemnites)}</td></tr>
          </tbody>
        </table>
        </div>` : ''}

        <div class="net-final">
          <span>Net à payer à l’assistante maternelle</span>
          <b>${Calc.fmtEur(r.netAPayer)}</b>
        </div>

        <div class="paje">
          <h3>À reporter dans la déclaration Pajemploi</h3>
          <dl>
            <dt>Nombre d’heures normales</dt><dd>${Calc.fmtNum(r.pajemploi.heures)}</dd>
            <dt>Nombre de jours d’activité</dt><dd>${r.pajemploi.joursActivite}</dd>
            <dt>Salaire net</dt><dd>${Calc.fmtEur(r.pajemploi.salaireNet)}</dd>
            <dt>Indemnités d’entretien</dt><dd>${Calc.fmtEur(r.pajemploi.indemnitesEntretien)}</dd>
            <dt>Indemnités de repas</dt><dd>${Calc.fmtEur(r.pajemploi.indemnitesRepas)}</dd>
            ${r.kmTotal ? `<dt>Indemnités kilométriques</dt><dd>${Calc.fmtEur(r.pajemploi.indemnitesKm)}</dd>` : ''}
          </dl>
        </div>

        ${r.semaines.length ? `
        <div class="paie-t-wrap">
        <table class="paie-t">
          <caption>Détail par semaine</caption>
          <thead><tr><th>Semaine</th><th class="num">Jours</th><th class="num">Heures</th><th class="num">Compl.</th><th class="num">Majorées</th></tr></thead>
          <tbody>${semainesHtml}</tbody>
        </table>
        </div>` : ''}

        ${avertissements.map(a => `<p class="warn">${a}</p>`).join('')}
      </article>`;
  }

  const esc = t => String(t ?? '').replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  $('#paie-prev').addEventListener('click', () => { moisPaie = Calc.shiftMonth(moisPaie, -1); renderPaie(); });
  $('#paie-next').addEventListener('click', () => { moisPaie = Calc.shiftMonth(moisPaie, 1);  renderPaie(); });

  $('#btn-print').addEventListener('click', () => window.print());

  $('#btn-csv').addEventListener('click', () => {
    const r = Calc.month(moisPaie, days, settings);
    Store.download(`assmat-${moisPaie}.csv`, Store.exportCSV(r, settings), 'text/csv');
    toast('CSV téléchargé.');
  });

  $('#btn-copy-paje').addEventListener('click', async () => {
    const r = Calc.month(moisPaie, days, settings).pajemploi;
    const txt = [
      `Pajemploi — ${Calc.fmtMois(moisPaie)}`,
      `Heures : ${Calc.fmtNum(r.heures)}`,
      `Jours d'activité : ${r.joursActivite}`,
      `Salaire net : ${Calc.fmtNum(r.salaireNet)} €`,
      `Indemnités d'entretien : ${Calc.fmtNum(r.indemnitesEntretien)} €`,
      `Indemnités de repas : ${Calc.fmtNum(r.indemnitesRepas)} €`,
      ...(r.indemnitesKm ? [`Indemnités kilométriques : ${Calc.fmtNum(r.indemnitesKm)} €`] : [])
    ].join('\n');
    try {
      await navigator.clipboard.writeText(txt);
      toast('Récap copié.');
    } catch {
      // clipboard indisponible (contexte non sécurisé, permission refusée)
      prompt('Copiez le récapitulatif :', txt);
    }
  });

  /* ================= PWA ================= */

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () =>
      navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW non enregistré', e)));
  }

  let promptInstall = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    promptInstall = e;
    $('#btn-install').hidden = false;
  });

  $('#btn-install').addEventListener('click', async () => {
    if (!promptInstall) return;
    promptInstall.prompt();
    await promptInstall.userChoice;
    promptInstall = null;
    $('#btn-install').hidden = true;
  });

  window.addEventListener('appinstalled', () => { $('#btn-install').hidden = true; });

  /* ================= Démarrage ================= */

  renderParams();
  renderCalendrier();
  renderPaie();   // la fiche doit exister même si l'onglet n'a pas été ouvert (impression directe)

  // Une impression déclenchée depuis un autre onglet doit porter sur des chiffres à jour.
  window.addEventListener('beforeprint', renderPaie);
})();
