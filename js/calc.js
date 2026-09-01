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
    semainesAn: 52,           // 52 = année complète, sinon année incomplète
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
    cpActif: false,           // ligne « indemnité de CP 10 % » sur la fiche
    cpTaux: 10,               // %

    // Journée type (pré-remplissage rapide)
    typeHeures: 9,
    typeRepas: { pdej: 0, dej: 1, gouter: 0 }
  };

  const ABSENCES = {
    present:  { label: 'Présent',            paye: true  },
    absent:   { label: 'Absence enfant',     paye: false },
    conge:    { label: 'Congé assmat',       paye: false },
    ferie:    { label: 'Jour férié',         paye: false },
    maladie:  { label: 'Maladie enfant',     paye: false }
  };

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
  const r4 = n => Math.round((n + Number.EPSILON) * 10000) / 10000;

  /* ---------- Taux horaire ---------- */

  /** Renvoie { brut, net } à partir du taux saisi et du taux de cotisations. */
  function tauxHoraire(s) {
    const c = (s.tauxCotisations || 0) / 100;
    const saisi = Number(s.tauxSaisi) || 0;
    if (s.tauxType === 'net') {
      const brut = c >= 1 ? saisi : saisi / (1 - c);
      return { brut: r4(brut), net: r4(saisi) };
    }
    return { brut: r4(saisi), net: r4(saisi * (1 - c)) };
  }

  /** Salaire mensualisé brut = taux × heures/semaine × semaines/an ÷ 12. */
  function salaireMensualise(s) {
    const t = tauxHoraire(s);
    const heures = heuresMensualisees(s);
    return { brut: r2(t.brut * heures), net: r2(t.net * heures), heures: r4(heures) };
  }

  /** Heures rémunérées chaque mois au titre de la mensualisation. */
  function heuresMensualisees(s) {
    return (Number(s.heuresSemaine) || 0) * (Number(s.semainesAn) || 0) / 12;
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

  /* ---------- Calcul mensuel complet ---------- */

  /**
   * @param {string} mk       mois 'YYYY-MM'
   * @param {object} days     dictionnaire { 'YYYY-MM-DD': jour }
   * @param {object} s        paramètres (settings)
   * @returns un objet de synthèse prêt à afficher.
   */
  function month(mk, days, s) {
    const t = tauxHoraire(s);
    const cot = (Number(s.tauxCotisations) || 0) / 100;
    const repasActifs = (s.repas || []).filter(r => r.actif);

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

    const saisis = entries.filter(e => e.heures > 0 || e.statut !== 'present');
    const presents = entries.filter(e => e.heures > 0);

    const totalHeures = r4(presents.reduce((a, e) => a + e.heures, 0));
    const joursPresence = presents.length;
    const totalKm = r2(entries.reduce((a, e) => a + e.km, 0));

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

    let brutTotal = r2(lignes.reduce((a, l) => a + l.brut, 0));

    if (s.cpActif) {
      const cp = r2(brutTotal * (Number(s.cpTaux) || 0) / 100);
      lignes.push({ cle: 'cp', libelle: `Indemnité de congés payés (${s.cpTaux} %)`, qte: null, taux: null, brut: cp });
      brutTotal = r2(brutTotal + cp);
    }

    const cotisations = r2(brutTotal * cot);
    const netSalaire = r2(brutTotal - cotisations);

    /* --- Indemnités (non soumises à cotisations) --- */
    const entretien = r2(presents.reduce((a, e) => a + entretienJour(e.heures, s), 0));

    const repasDetail = repasActifs.map(r => {
      const nb = entries.reduce((a, e) => a + (Number(e.repas[r.id]) || 0), 0);
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
      heures: { normales: hNorm, complementaires: hComp, maj1: hMaj1, maj2: hMaj2 },
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
      // Ce que Pajemploi attend dans la déclaration mensuelle
      pajemploi: {
        heures: totalHeures,
        joursActivite: joursPresence,
        salaireNet: netSalaire,
        indemnitesEntretien: entretien,
        indemnitesRepas: repasTotal,
        indemnitesKm: kmTotal
      }
    };
  }

  /* ---------- Formatage ---------- */

  const nfEur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
  const nfNum = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const fmtEur = n => nfEur.format(r2(Number(n) || 0));
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
    r2, r4, tauxHoraire, salaireMensualise, heuresMensualisees,
    entretienJour, weeks, month,
    fmtEur, fmtNum, fmtH, fmtMois, fmtJour
  };
})();

if (typeof module !== 'undefined') module.exports = Calc;
