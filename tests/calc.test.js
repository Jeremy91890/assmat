/* Vérifications du moteur de calcul : node tests/calc.test.js */
const assert = require('assert');
const Calc = require('../js/calc.js');

let ok = 0;
const test = (nom, fn) => {
  try { fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { console.error(`  ✗ ${nom}\n    ${e.message}`); process.exitCode = 1; }
};

const S = (over = {}) => ({ ...Calc.DEFAULTS, ...over });

console.log('\nMensualisation');
test('année complète : 3,64 € × 45 h × 52 ÷ 12 = 709,80 €', () => {
  assert.strictEqual(Calc.salaireMensualise(S()).brut, 709.80);
});
test('année incomplète (47 semaines) = 641,55 €', () => {
  assert.strictEqual(Calc.salaireMensualise(S({ semainesAn: 47 })).brut, 641.55);
});

console.log('\nTaux horaire brut / net');
test('brut 3,64 € à 22 % → net 2,8392 €', () => {
  assert.strictEqual(Calc.tauxHoraire(S()).net, 2.8392);
});
test('saisie en net : 2,84 € net → 3,641 € brut', () => {
  const t = Calc.tauxHoraire(S({ tauxType: 'net', tauxSaisi: 2.84 }));
  assert.strictEqual(t.net, 2.84);
  assert.ok(Math.abs(t.brut - 3.641) < 0.001, `brut = ${t.brut}`);
});

console.log('\nIndemnités d’entretien (barème 2026)');
const bareme = [[4, 2.65], [6, 2.65], [6.25, 2.66], [8, 3.4], [9, 3.83], [11, 3.83], [0, 0]];
for (const [h, attendu] of bareme) {
  test(`${h} h → ${attendu.toFixed(2)} €`, () => {
    assert.strictEqual(Calc.entretienJour(h, S()), attendu);
  });
}
test('mode fixe : toujours le même montant', () => {
  assert.strictEqual(Calc.entretienJour(3, S({ entretienMode: 'fixe', entretienFixe: 3.5 })), 3.5);
});
test('mode aucun : zéro', () => {
  assert.strictEqual(Calc.entretienJour(9, S({ entretienMode: 'aucun' })), 0);
});

console.log('\nMajorations hebdomadaires (seuil 45 h)');
const semaine = (heures, dates) => dates.map((d, i) => ({ date: d, heures: heures[i] }));
test('50 h → 5 h majorées à 25 %, 0 à 50 %', () => {
  const w = Calc.weeks(semaine([10, 10, 10, 10, 10],
    ['2026-09-07','2026-09-08','2026-09-09','2026-09-10','2026-09-11']), S());
  assert.strictEqual(w.length, 1);
  assert.strictEqual(w[0].maj1, 5);
  assert.strictEqual(w[0].maj2, 0);
  assert.strictEqual(w[0].normales, 45);
});
test('56 h → 8 h à 25 % puis 3 h à 50 %', () => {
  const w = Calc.weeks(semaine([12, 11, 11, 11, 11],
    ['2026-09-07','2026-09-08','2026-09-09','2026-09-10','2026-09-11']), S());
  assert.strictEqual(w[0].maj1, 8);
  assert.strictEqual(w[0].maj2, 3);
});
test('40 h avec contrat 36 h → 4 h complémentaires non majorées', () => {
  const w = Calc.weeks(semaine([10, 10, 10, 10],
    ['2026-09-07','2026-09-08','2026-09-09','2026-09-10']), S({ heuresSemaine: 36 }));
  assert.strictEqual(w[0].complementaires, 4);
  assert.strictEqual(w[0].maj1, 0);
});
test('paiement au réel : pas d’heures complémentaires distinctes', () => {
  const w = Calc.weeks(semaine([10, 10, 10, 10],
    ['2026-09-07','2026-09-08','2026-09-09','2026-09-10']), S({ mode: 'reel', heuresSemaine: 36 }));
  assert.strictEqual(w[0].complementaires, 0);
  assert.strictEqual(w[0].normales, 40);
});

console.log('\nSemaines ISO');
test('1er septembre 2026 (mardi) est en semaine 36', () => {
  assert.strictEqual(Calc.weekKey('2026-09-01'), '2026-W36');
});
test('1er janvier 2027 (vendredi) appartient à la semaine 53 de 2026', () => {
  assert.strictEqual(Calc.weekKey('2027-01-01'), '2026-W53');
});
test('lundi et dimanche d’une même semaine ont la même clé', () => {
  assert.strictEqual(Calc.weekKey('2026-09-07'), Calc.weekKey('2026-09-13'));
});
test('lundi suivant change de semaine', () => {
  assert.notStrictEqual(Calc.weekKey('2026-09-13'), Calc.weekKey('2026-09-14'));
});

console.log('\nMois complet — mensualisation, 4 j/sem. × 9 h');
{
  const s = S({ heuresSemaine: 36, joursSemaine: 4, semainesAn: 47, tauxSaisi: 4.20 });
  const days = {};
  // Tous les lundis-jeudis de septembre 2026, 9 h + un déjeuner.
  for (const d of Calc.daysOfMonth('2026-09')) {
    const dow = (Calc.parseISO(d).getDay() + 6) % 7;
    if (dow <= 3) days[d] = { statut: 'present', heures: 9, repas: { dej: 1 }, km: 0 };
  }
  const r = Calc.month('2026-09', days, s);
  const nbJours = Object.keys(days).length;

  test(`${nbJours} jours d’accueil détectés`, () => {
    assert.strictEqual(r.joursPresence, nbJours);
  });
  test('heures totales = 9 h × nombre de jours', () => {
    assert.strictEqual(r.totalHeures, nbJours * 9);
  });
  test('salaire de base = mensualisation, indépendant des heures réelles', () => {
    assert.strictEqual(r.lignes[0].brut, Calc.salaireMensualise(s).brut);
  });
  test('indemnité d’entretien = 3,83 € × nombre de jours', () => {
    assert.strictEqual(r.entretien, Calc.r2(3.83 * nbJours));
  });
  test('repas = 5,50 € × nombre de jours', () => {
    assert.strictEqual(r.repasTotal, Calc.r2(5.50 * nbJours));
  });
  test('net à payer = net salarial + indemnités', () => {
    assert.strictEqual(r.netAPayer, Calc.r2(r.netSalaire + r.indemnites));
  });
  test('cotisations = 22 % du brut', () => {
    assert.strictEqual(r.cotisations, Calc.r2(r.brut * 0.22));
  });
  test('le récap Pajemploi reprend les mêmes totaux', () => {
    assert.strictEqual(r.pajemploi.heures, r.totalHeures);
    assert.strictEqual(r.pajemploi.salaireNet, r.netSalaire);
    assert.strictEqual(r.pajemploi.indemnitesEntretien, r.entretien);
  });
}

console.log('\nAbsences');
{
  const s = S({ mode: 'reel', tauxSaisi: 4 });
  const days = {
    '2026-09-07': { statut: 'present', heures: 9, repas: { dej: 1 } },
    '2026-09-08': { statut: 'absent',  heures: 9, repas: { dej: 1 } },
    '2026-09-09': { statut: 'ferie',   heures: 9, repas: {} }
  };
  const r = Calc.month('2026-09', days, s);
  test('une journée d’absence ne compte ni heures ni entretien', () => {
    assert.strictEqual(r.totalHeures, 9);
    assert.strictEqual(r.joursPresence, 1);
    assert.strictEqual(r.entretien, 3.83);
  });
  test('mais les repas déjà saisis restent comptés tels quels', () => {
    assert.strictEqual(r.repasDetail[0].nb, 2);
  });
}

console.log('\nMois vide');
{
  const r = Calc.month('2026-12', {}, S());
  test('mensualisation : le salaire de base reste dû', () => {
    assert.strictEqual(r.brut, 709.80);
    assert.strictEqual(r.indemnites, 0);
  });
  const r2 = Calc.month('2026-12', {}, S({ mode: 'reel' }));
  test('paiement au réel : rien à payer', () => {
    assert.strictEqual(r2.brut, 0);
    assert.strictEqual(r2.netAPayer, 0);
  });
}

console.log('\nCongés payés');
{
  const r = Calc.month('2026-12', {}, S({ cpActif: true }));
  test('ligne CP = 10 % du brut, ajoutée au total', () => {
    assert.strictEqual(r.lignes.at(-1).brut, 70.98);
    assert.strictEqual(r.brut, 780.78);
  });
}

console.log('\nNavigation mensuelle');
test('janvier − 1 mois = décembre de l’année précédente', () => {
  assert.strictEqual(Calc.shiftMonth('2026-01', -1), '2025-12');
});
test('décembre + 1 mois = janvier suivant', () => {
  assert.strictEqual(Calc.shiftMonth('2026-12', 1), '2027-01');
});
test('février 2028 compte 29 jours', () => {
  assert.strictEqual(Calc.daysOfMonth('2028-02').length, 29);
});

console.log(`\n${ok} vérifications passées${process.exitCode ? ' — des échecs subsistent' : '.'}\n`);
