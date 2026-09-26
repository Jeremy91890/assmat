/* Moteur de calcul de la paie d'un assistant maternel.
   Fonctions pures : aucune dépendance au DOM ni au stockage.
   Références : convention collective des particuliers employeurs (barèmes 2026). */

const Calc = (() => {

  /* ---------- Barèmes / valeurs par défaut ---------- */

  const DEFAULTS = {
    // Identité
    enfant: '',
    assmat: '',
    employeur: '',

    // Rémunération
    tauxSaisi: 3.64,          // le taux tel que saisi par l'utilisateur
    tauxType: 'brut',         // 'brut' | 'net'
    tauxCotisations: 22,      // % de cotisations salariales (brut -> net)

    // Contrat
    mode: 'mensualisation',   // 'mensualisation' | 'reel'
    heuresSemaine: 45,        // heures d'accueil prévues au contrat
    joursSemaine: 4,          // jours d'accueil prévus au contrat
    joursAccueil: [1, 2, 3, 4], // jours de la semaine gardés (1 = lundi … 7 = dimanche)
    typeAnnee: 'complete',    // 'complete' (52 sem. payées, CP inclus) | 'incomplete'
    semainesAn: 46,           // année incomplète : semaines d'accueil programmées (46 max)
    debutContrat: '',         // 'YYYY-MM-DD' : borne l'année contractuelle (quota enfant malade)
    seuilMajoration: 45,      // au-delà : heures majorées
    majoration1: 25,          // % sur les 8 premières heures au-delà du seuil
    majoration2: 50,          // % au-delà
    heuresMaj1: 8,            // nombre d'heures concernées par majoration1

    // Indemnités d'entretien
    entretienMode: 'bareme',  // 'bareme' | 'fixe' | 'aucun'
    entretienTauxH: 0.425,    // €/h d'accueil
    entretienMin: 2.65,       // plancher journalier
    entretienMax: 3.83,       // plafond journalier (9 h et plus)
    entretienFixe: 3.83,      // si entretienMode === 'fixe'

    // Repas
    repas: [
      { id: 'pdej',   label: 'Petit-déjeuner', prix: 0,    actif: false },
      { id: 'dej',    label: 'Déjeuner',       prix: 5.50, actif: true  },
      { id: 'gouter', label: 'Goûter',         prix: 0,    actif: false }
    ],

    // Frais kilométriques
    kmActif: false,
    kmTarif: 0.45,            // €/km

    // Congés payés
    // Congés payés : dus en plus du salaire hors année complète mensualisée
    cpMode: 'juin',           // 'juin' | 'prise' (prise principale) | 'mensuel' (au fur et à mesure)
    cpMoisPrise: 8,           // mois de la prise principale (1 = janvier … 12 = décembre)
    cpTaux: 10,               // % : règle du dixième

    // Journée type (pré-remplissage rapide)
    typeHeures: 9,
    typeRepas: { pdej: 0, dej: 1, gouter: 0 }
  };

  /* Effet de chaque statut sur le salaire mensualisé :
     - 'maintenu' : salaire dû en intégralité (convenance du parent, maladie sans certificat…)
     - 'deduit'   : absence non rémunérée (absence de l'assmat hors congés payés)
     - 'quota'    : enfant malade avec certificat, déductible 5 jours par année contractuelle
     - 'hospit'   : hospitalisation de l'enfant, déductible 14 jours consécutifs
     Les indemnités d'entretien et de repas ne sont dues que les jours de présence. */
  const ABSENCES = {
    present:         { label: 'Présent',                          effet: 'maintenu' },
    absent:          { label: 'Absence enfant (convenance)',      effet: 'maintenu' },
    maladie:         { label: 'Enfant malade sans certificat',    effet: 'maintenu' },
    maladieCertif:   { label: 'Enfant malade avec certificat',    effet: 'quota'    },
    hospitalisation: { label: 'Hospitalisation enfant',           effet: 'hospit'   },
    conge:           { label: 'Congés payés assmat',              effet: 'maintenu' },
    absenceAssmat:   { label: 'Absence assmat (maladie, sans solde…)', effet: 'deduit' },
    ferie:           { label: 'Jour férié',                       effet: 'maintenu' }
  };

  const QUOTA_MALADIE_CERTIF = 5;    // jours par année contractuelle
  const QUOTA_HOSPITALISATION = 14;  // jours calendaires consécutifs

  /* ---------- Utilitaires de date ---------- */

  const pad = n => String(n).padStart(2, '0');

  /** Date -> 'YYYY-MM-DD' (en heure locale, pas UTC). */
  function isoDate(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /** 'YYYY-MM-DD' -> Date locale à midi (évite les décalages de fuseau). */
  function parseISO(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0);
  }

  /** 'YYYY-MM' du mois courant. */
  function monthKey(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  }

  /** Clé de semaine ISO 'YYYY-Www' (semaine commençant le lundi). */
  function weekKey(dateStr) {
    const d = parseISO(dateStr);
    const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    // jeudi de la semaine courante -> détermine l'année ISO
    const day = (t.getDay() + 6) % 7;           // lundi = 0
    t.setDate(t.getDate() - day + 3);
    const firstThursday = new Date(t.getFullYear(), 0, 4);
    const fday = (firstThursday.getDay() + 6) % 7;
    firstThursday.setDate(firstThursday.getDate() - fday + 3);
    const week = 1 + Math.round((t - firstThursday) / (7 * 864e5));
    return `${t.getFullYear()}-W${pad(week)}`;
  }

  /** Liste des 'YYYY-MM-DD' d'un mois 'YYYY-MM'. */
  function daysOfMonth(mk) {
    const [y, m] = mk.split('-').map(Number);
    const n = new Date(y, m, 0).getDate();
    const out = [];
    for (let i = 1; i <= n; i++) out.push(`${y}-${pad(m)}-${pad(i)}`);
    return out;
  }

  /** Décale un mois 'YYYY-MM' de `delta` mois. */
  function shiftMonth(mk, delta) {
    const [y, m] = mk.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return monthKey(d);
  }

  /* ---------- Arrondis monétaires ---------- */

  /** Arrondi comptable à 2 décimales (demi vers le haut, insensible au flottant). */
  const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
  const r3 = n => Math.round((n + Number.EPSILON) * 1000) / 1000;
  const r4 = n => Math.round((n + Number.EPSILON) * 10000) / 10000;

  /* ---------- Taux horaire ---------- */

  /** Renvoie { brut, net } à partir du taux saisi et du taux de cotisations. */
  function tauxHoraire(s) {
    const c = (s.tauxCotisations || 0) / 100;
    const saisi = Number(s.tauxSaisi) || 0;
    if (s.tauxType === 'net') {
      const brut = c >= 1 ? saisi : saisi / (1 - c);
      return { brut: r3(brut), net: saisi };
    }
    return { brut: saisi, net: r3(saisi * (1 - c)) };
  }

  /** Salaire mensualisé brut = taux × heures/semaine × semaines/an ÷ 12. */
  function salaireMensualise(s) {
    const t = tauxHoraire(s);
    const heures = heuresMensualisees(s);
    return { brut: r2(t.brut * heures), net: r2(t.net * heures), heures: r4(heures) };
  }

  /** Année complète : 47 semaines d'accueil + 5 de CP, soit 52 semaines payées. */
  const anneeComplete = s => s.typeAnnee !== 'incomplete';

  /** Semaines rémunérées par la mensualisation : 52, ou les semaines programmées. */
  const semainesPayees = s => anneeComplete(s) ? 52 : (Number(s.semainesAn) || 0);

  /** Les congés payés s'ajoutent au salaire, sauf en année complète mensualisée. */
  const cpEnSus = s => !(s.mode === 'mensualisation' && anneeComplete(s));

  /** Heures rémunérées chaque mois au titre de la mensualisation. */
  function heuresMensualisees(s) {
    return (Number(s.heuresSemaine) || 0) * semainesPayees(s) / 12;
  }

  /** Jours d'activité mensualisés = jours/semaine × semaines payées ÷ 12, arrondi à l'entier supérieur. */
  function joursMensualises(s) {
    return Math.ceil(r4((Number(s.joursSemaine) || 0) * semainesPayees(s) / 12));
  }

  /* ---------- Absences déductibles ---------- */

  /** Début de l'année contractuelle contenant `date` (année civile à défaut de date de contrat). */
  function debutAnneeContrat(date, s) {
    const d = parseISO(date);
    const debut = /^\d{4}-\d{2}-\d{2}$/.test(s.debutContrat || '') ? parseISO(s.debutContrat) : null;
    if (!debut) return `${d.getFullYear()}-01-01`;
    let y = d.getFullYear();
    const anniv = y => isoDate(new Date(y, debut.getMonth(), debut.getDate(), 12));
    if (anniv(y) > date) y--;
    return anniv(y);
  }

  /** Décale une date 'YYYY-MM-DD' de `delta` jours. */
  function shiftDay(date, delta) {
    const d = parseISO(date);
    d.setDate(d.getDate() + delta);
    return isoDate(d);
  }

  const dow = date => ((parseISO(date).getDay() + 6) % 7) + 1; // 1 = lundi … 7 = dimanche

  /**
   * La journée `date` (absence) est-elle retenue sur le salaire ?
   * `days` doit contenir tout l'historique : les quotas s'apprécient sur l'année contractuelle.
   */
  function absenceDeduite(date, days, s) {
    const effet = (ABSENCES[(days[date] || {}).statut] || {}).effet;
    if (effet === 'deduit') return true;
    if (effet === 'quota') {
      const debut = debutAnneeContrat(date, s);
      const rang = Object.keys(days)
        .filter(d => d >= debut && d <= date && days[d].statut === 'maladieCertif').length;
      return rang <= QUOTA_MALADIE_CERTIF;
    }
    if (effet === 'hospit') {
      // Remonte au premier jour de l'hospitalisation, en enjambant les jours sans accueil.
      const accueil = s.joursAccueil || [];
      let debut = date;
      for (let prev = shiftDay(date, -1), n = 0; n < 366; prev = shiftDay(prev, -1), n++) {
        const j = days[prev];
        if (j && j.statut === 'hospitalisation') debut = prev;
        else if (j || accueil.includes(dow(prev))) break;
      }
      return (parseISO(date) - parseISO(debut)) / 864e5 < QUOTA_HOSPITALISATION;
    }
    return false;
  }

  /* ---------- Indemnité d'entretien ---------- */

  /** Indemnité d'entretien due pour une journée d'accueil de `h` heures. */
  function entretienJour(h, s) {
    if (!h || h <= 0 || s.entretienMode === 'aucun') return 0;
    if (s.entretienMode === 'fixe') return r2(Number(s.entretienFixe) || 0);
    const brut = h * (Number(s.entretienTauxH) || 0);
    return r2(Math.min(Math.max(brut, Number(s.entretienMin) || 0), Number(s.entretienMax) || Infinity));
  }

  /* ---------- Découpage hebdomadaire (pour les majorations) ---------- */

  /**
   * Regroupe les jours par semaine ISO et ventile les heures.
   * Les semaines sont bornées au mois : une semaine à cheval sur deux mois
   * n'est comptée que pour sa portion dans le mois affiché.
   */
  function weeks(entries, s) {
    const seuil = Number(s.seuilMajoration) || 0;
    const bloc1 = Number(s.heuresMaj1) || 0;
    const contrat = s.mode === 'mensualisation' ? (Number(s.heuresSemaine) || 0) : seuil;
    const map = new Map();

    for (const e of entries) {
      const k = weekKey(e.date);
      if (!map.has(k)) map.set(k, { week: k, debut: e.date, fin: e.date, heures: 0, jours: 0 });
      const w = map.get(k);
      w.heures += e.heures;
      if (e.heures > 0) w.jours++;
      if (e.date < w.debut) w.debut = e.date;
      if (e.date > w.fin) w.fin = e.date;
    }

    return [...map.values()]
      .sort((a, b) => a.debut.localeCompare(b.debut))
      .map(w => {
        const h = r4(w.heures);
        const auDela = Math.max(0, h - seuil);
        const maj2 = Math.max(0, auDela - bloc1);
        const maj1 = Math.min(auDela, bloc1);
        const base = Math.min(h, seuil);
        const comp = Math.max(0, base - Math.min(contrat, seuil));
        return { ...w, heures: h, normales: r4(base - comp), complementaires: r4(comp), maj1: r4(maj1), maj2: r4(maj2) };
      });
  }

  /* ---------- Salaire de base d'un mois ---------- */

  const dateContrat = s => /^\d{4}-\d{2}-\d{2}$/.test(s.debutContrat || '') ? s.debutContrat : null;

  /** Mois 'YYYY-MM' de `de` à `a` inclus. */
  function moisEntre(de, a) {
    const out = [];
    for (let m = de; m <= a; m = shiftMonth(m, 1)) out.push(m);
    return out;
  }

  /** Le contrat court-il ce mois-ci ? À défaut de date de début : un jour au moins est saisi. */
  function moisActif(mk, days, s) {
    const debut = dateContrat(s);
    return debut ? mk >= debut.slice(0, 7) : Object.keys(days).some(d => d.startsWith(mk));
  }

  /**
   * Heures, salaire brut et retenues d'un mois, hors congés payés et régularisation
   * (qui, eux, se calculent à partir des salaires de base de plusieurs mois).
   */
  function baseMois(mk, days, s) {
    const t = tauxHoraire(s);

    const entries = [];
    for (const date of daysOfMonth(mk)) {
      const j = days[date];
      if (!j) continue;
      const statut = j.statut || 'present';
      const heures = statut === 'present' ? (Number(j.heures) || 0) : 0;
      entries.push({
        date, statut, heures,
        repas: j.repas || {},
        km: Number(j.km) || 0,
        note: j.note || ''
      });
    }

    const presents = entries.filter(e => e.heures > 0);
    const sem = weeks(presents, s);
    const hComp = r4(sem.reduce((a, w) => a + w.complementaires, 0));
    const hMaj1 = r4(sem.reduce((a, w) => a + w.maj1, 0));
    const hMaj2 = r4(sem.reduce((a, w) => a + w.maj2, 0));
    const hNorm = r4(sem.reduce((a, w) => a + w.normales, 0));

    const cf1 = 1 + (Number(s.majoration1) || 0) / 100;
    const cf2 = 1 + (Number(s.majoration2) || 0) / 100;

    /* --- Lignes de salaire brut --- */
    const lignes = [];
    if (s.mode === 'mensualisation') {
      const mens = salaireMensualise(s);
      lignes.push({
        cle: 'base',
        libelle: `Salaire mensualisé (${fmtH(mens.heures)})`,
        qte: mens.heures, taux: t.brut, brut: mens.brut
      });
    } else {
      lignes.push({
        cle: 'base',
        libelle: 'Heures normales',
        qte: hNorm, taux: t.brut, brut: r2(hNorm * t.brut)
      });
    }
    if (hComp > 0) lignes.push({
      cle: 'comp', libelle: 'Heures complémentaires',
      qte: hComp, taux: t.brut, brut: r2(hComp * t.brut)
    });
    if (hMaj1 > 0) lignes.push({
      cle: 'maj1', libelle: `Heures majorées +${s.majoration1} %`,
      qte: hMaj1, taux: r4(t.brut * cf1), brut: r2(hMaj1 * t.brut * cf1)
    });
    if (hMaj2 > 0) lignes.push({
      cle: 'maj2', libelle: `Heures majorées +${s.majoration2} %`,
      qte: hMaj2, taux: r4(t.brut * cf2), brut: r2(hMaj2 * t.brut * cf2)
    });

    /* --- Absences non rémunérées (méthode de la Cour de cassation) ---
       Retenue = salaire mensualisé × heures d'absence ÷ heures qui auraient dû être
       travaillées dans le mois. */
    const deduits = s.mode === 'mensualisation'
      ? entries.filter(e => e.statut !== 'present' && absenceDeduite(e.date, days, s)) : [];
    const accueil = s.joursAccueil || [];
    const joursTheoriques = daysOfMonth(mk).filter(d => accueil.includes(dow(d))).length;
    const hJour = accueil.length ? (Number(s.heuresSemaine) || 0) / accueil.length : 0;
    const ratioAbsence = joursTheoriques ? Math.min(deduits.length / joursTheoriques, 1) : 0;
    let heuresBase = s.mode === 'mensualisation' ? heuresMensualisees(s) : hNorm;
    if (deduits.length) {
      const base = lignes[0];
      const hAbs = r4(deduits.length * hJour);
      lignes.push({
        cle: 'absence',
        libelle: `Absence non rémunérée (${deduits.length} j)`,
        qte: hAbs,
        taux: hAbs ? r4(base.brut * ratioAbsence / hAbs) : null,
        brut: -r2(base.brut * ratioAbsence)
      });
      heuresBase = heuresBase * (1 - ratioAbsence);
    }

    // Heures dues au titre du contrat, pour la régularisation annuelle : heures d'accueil
    // dans la limite du contrat, plus les absences rémunérées (convenance du parent, férié…).
    // Les congés payés sont exclus : ils sont rémunérés à part en année incomplète.
    const absencesPayees = entries.filter(e =>
      e.statut !== 'present' && e.statut !== 'conge' && !deduits.includes(e));
    const heuresDues = r4(hNorm + absencesPayees.length * hJour);

    return {
      t, entries, presents, sem, lignes, deduits,
      hNorm, hComp, hMaj1, hMaj2, heuresBase, heuresDues,
      brut: r2(lignes.reduce((a, l) => a + l.brut, 0))
    };
  }

  /* ---------- Congés payés (hors année complète) ---------- */

  const NOMS_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
    'août', 'septembre', 'octobre', 'novembre', 'décembre'];

  /**
   * Congés acquis sur la période de référence du 1er juin `annee − 1` au 31 mai `annee` :
   * 2,5 jours ouvrables par mois (30 au plus, arrondi à l'entier supérieur), indemnisés au
   * plus avantageux de la règle du dixième et du maintien de salaire.
   */
  function congesPayes(annee, days, s) {
    const mois = moisEntre(`${annee - 1}-06`, `${annee}-05`).filter(mk => moisActif(mk, days, s));
    const brutReference = r2(mois.reduce((a, mk) => a + baseMois(mk, days, s).brut, 0));
    const jours = Math.min(30, Math.ceil(r4(mois.length * 2.5)));
    const dixieme = r2(brutReference * (Number(s.cpTaux) || 0) / 100);
    // Maintien : ce qu'aurait perçu le salarié en travaillant, 6 jours ouvrables par semaine.
    const maintien = r2(jours / 6 * (Number(s.heuresSemaine) || 0) * tauxHoraire(s).brut);
    return {
      periode: `juin ${annee - 1} – mai ${annee}`,
      mois: mois.length, jours, brutReference, dixieme, maintien,
      du: Math.max(dixieme, maintien),
      regle: maintien > dixieme ? 'maintien de salaire' : `règle du ${s.cpTaux} %`
    };
  }

  /** Lignes de congés payés à ajouter au brut du mois `mk`, selon le mode choisi au contrat. */
  function lignesCP(mk, brutMois, days, s) {
    if (!cpEnSus(s)) return { lignes: [], detail: null };
    const [y, m] = mk.split('-').map(Number);
    const taux = Number(s.cpTaux) || 0;
    const lignes = [];
    let detail = null;

    if (s.cpMode === 'mensuel') {
      const cp = r2(brutMois * taux / 100);
      if (cp) lignes.push({ cle: 'cp', libelle: `Congés payés (${taux} % du mois)`, qte: null, taux: null, brut: cp });
      // En juin, on compare au maintien de salaire sur la période écoulée.
      if (m === 6) {
        detail = congesPayes(y, days, s);
        const complement = r2(detail.maintien - detail.dixieme);
        if (detail.mois && complement > 0) lignes.push({
          cle: 'cp-compl', libelle: `Complément congés payés ${detail.periode} (maintien de salaire)`,
          qte: null, taux: null, brut: complement
        });
      }
    } else {
      const moisPaiement = s.cpMode === 'prise' ? (Number(s.cpMoisPrise) || 6) : 6;
      if (m === moisPaiement) {
        detail = congesPayes(m >= 6 ? y : y - 1, days, s);
        if (detail.mois && detail.du) lignes.push({
          cle: 'cp', libelle: `Congés payés ${detail.periode} (${detail.jours} j, ${detail.regle})`,
          qte: null, taux: null, brut: detail.du
        });
      }
    }
    return { lignes, detail };
  }

  /* ---------- Régularisation annuelle (année incomplète) ---------- */

  /**
   * À la date anniversaire du contrat, compare les heures dues sur les 12 mois écoulés
   * (heures d'accueil dans la limite du contrat + absences rémunérées) aux heures payées
   * par la mensualisation. Un solde positif est versé ; un trop-payé n'est pas retenu.
   */
  function regularisation(mk, days, s) {
    const debut = dateContrat(s);
    if (!debut || s.mode !== 'mensualisation' || anneeComplete(s)) return null;
    if (mk.slice(5) !== debut.slice(5, 7) || mk <= debut.slice(0, 7)) return null;

    const mois = moisEntre(shiftMonth(mk, -12), shiftMonth(mk, -1)).filter(m => m >= debut.slice(0, 7));
    let heuresPayees = 0, heuresDues = 0;
    for (const m of mois) {
      const b = baseMois(m, days, s);
      heuresPayees += b.heuresBase;
      heuresDues += b.heuresDues;
    }
    heuresPayees = r2(heuresPayees);
    heuresDues = r2(heuresDues);
    const ecart = r2(heuresDues - heuresPayees);
    return {
      du: mois[0], au: mois.at(-1),
      heuresDues, heuresPayees, ecart,
      montant: ecart > 0 ? r2(ecart * tauxHoraire(s).brut) : 0
    };
  }

  /* ---------- Calcul mensuel complet ---------- */

  /**
   * @param {string} mk       mois 'YYYY-MM'
   * @param {object} days     dictionnaire { 'YYYY-MM-DD': jour } (tout l'historique :
   *                          congés payés et régularisation portent sur plusieurs mois)
   * @param {object} s        paramètres (settings)
   * @returns un objet de synthèse prêt à afficher.
   */
  function month(mk, days, s) {
    const b = baseMois(mk, days, s);
    const { t, entries, presents, sem, deduits, hComp, hMaj1, hMaj2 } = b;
    const cot = (Number(s.tauxCotisations) || 0) / 100;
    const repasActifs = (s.repas || []).filter(r => r.actif);

    const saisis = entries.filter(e => e.heures > 0 || e.statut !== 'present');
    const totalHeures = r4(presents.reduce((a, e) => a + e.heures, 0));
    const joursPresence = presents.length;
    const totalKm = r2(entries.reduce((a, e) => a + e.km, 0));

    const lignes = [...b.lignes];

    const regul = regularisation(mk, days, s);
    if (regul && regul.montant > 0) lignes.push({
      cle: 'regul', libelle: 'Régularisation annuelle',
      qte: regul.ecart, taux: t.brut, brut: regul.montant
    });

    // Le dixième mensuel porte sur la rémunération du mois, régularisation comprise.
    const brutAvantCP = r2(lignes.reduce((a, l) => a + l.brut, 0));
    const cp = lignesCP(mk, brutAvantCP, days, s);
    lignes.push(...cp.lignes);

    const brutTotal = r2(lignes.reduce((a, l) => a + l.brut, 0));
    const cotisations = r2(brutTotal * cot);
    const netSalaire = r2(brutTotal - cotisations);

    /* --- Indemnités (non soumises à cotisations) --- */
    const entretien = r2(presents.reduce((a, e) => a + entretienJour(e.heures, s), 0));

    const repasDetail = repasActifs.map(r => {
      const nb = presents.reduce((a, e) => a + (Number(e.repas[r.id]) || 0), 0);
      return { id: r.id, label: r.label, nb, prix: Number(r.prix) || 0, total: r2(nb * (Number(r.prix) || 0)) };
    }).filter(r => r.nb > 0);

    const repasTotal = r2(repasDetail.reduce((a, r) => a + r.total, 0));
    const kmTotal = s.kmActif ? r2(totalKm * (Number(s.kmTarif) || 0)) : 0;
    const indemnites = r2(entretien + repasTotal + kmTotal);

    return {
      mois: mk,
      taux: t,
      jours: entries,
      joursSaisis: saisis.length,
      joursPresence,
      totalHeures,
      totalKm,
      semaines: sem,
      heures: { normales: b.hNorm, complementaires: hComp, maj1: hMaj1, maj2: hMaj2 },
      lignes,
      brut: brutTotal,
      cotisations,
      netSalaire,
      entretien,
      repasDetail,
      repasTotal,
      kmTotal,
      indemnites,
      netAPayer: r2(netSalaire + indemnites),
      absencesDeduites: deduits.map(e => e.date),
      congesPayes: cp.detail,
      regularisation: regul,
      // Ce que Pajemploi attend dans la déclaration mensuelle
      pajemploi: {
        // Heures normales = salaire net de base versé ÷ taux horaire net, soit les heures
        // mensualisées réduites au prorata des absences non rémunérées, plus les heures
        // complémentaires et celles versées au titre de la régularisation.
        heures: r2(b.heuresBase + hComp + (regul && regul.ecart > 0 ? regul.ecart : 0)),
        heuresMajorees: r4(hMaj1 + hMaj2),
        joursActivite: s.mode === 'mensualisation'
          ? Math.max(joursMensualises(s) - deduits.length, 0) : joursPresence,
        salaireNet: netSalaire,
        indemnitesEntretien: entretien,
        indemnitesRepas: repasTotal,
        indemnitesKm: kmTotal
      }
    };
  }

  /* ---------- Formatage ---------- */

  const nfEur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
  const nfEur3 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const nfNum = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const fmtEur = n => nfEur.format(r2(Number(n) || 0));
  const fmtEurTaux = n => nfEur3.format(r3(Number(n) || 0));
  const fmtNum = n => nfNum.format(Number(n) || 0);

  /** Heures : « 9 h », « 9 h 30 ». */
  function fmtH(h) {
    const v = Number(h) || 0;
    const entier = Math.floor(v);
    const min = Math.round((v - entier) * 60);
    return min ? `${entier}h${pad(min)}` : `${entier}h`;
  }

  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
                'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

  function fmtMois(mk) {
    const [y, m] = mk.split('-').map(Number);
    return `${MOIS[m - 1]} ${y}`;
  }

  function fmtJour(dateStr) {
    return parseISO(dateStr).toLocaleDateString('fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long'
    });
  }

  return {
    DEFAULTS, ABSENCES, MOIS,
    isoDate, parseISO, monthKey, weekKey, daysOfMonth, shiftMonth,
    r2, r3, r4, tauxHoraire, salaireMensualise, heuresMensualisees, joursMensualises, absenceDeduite,
    anneeComplete, cpEnSus, congesPayes, regularisation, NOMS_MOIS,
    entretienJour, weeks, month,
    fmtEur, fmtEurTaux, fmtNum, fmtH, fmtMois, fmtJour
  };
})();

if (typeof module !== 'undefined') module.exports = Calc;
