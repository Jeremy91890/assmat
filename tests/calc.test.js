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
test('année incomplète (40 semaines) : 3,64 € × 45 h × 40 ÷ 12 = 546,00 €', () => {
  assert.strictEqual(Calc.salaireMensualise(S({ typeAnnee: 'incomplete', semainesAn: 40 })).brut, 546.00);
});
test('année complète : le nombre de semaines saisi est ignoré (52 payées)', () => {
  assert.strictEqual(Calc.salaireMensualise(S({ semainesAn: 40 })).brut, 709.80);
});
test('jours mensualisés : 4 j × 40 sem. ÷ 12 = 13,33 → 14', () => {
  assert.strictEqual(Calc.joursMensualises(S({ typeAnnee: 'incomplete', semainesAn: 40, joursSemaine: 4 })), 14);
});

console.log('\nTaux horaire brut / net');
test('brut 3,64 € à 22 % → net 2,839 € (arrondi au millième)', () => {
  assert.strictEqual(Calc.tauxHoraire(S()).net, 2.839);
});
test('saisie brut à 3 décimales conservée telle quelle', () => {
  assert.strictEqual(Calc.tauxHoraire(S({ tauxSaisi: 3.645 })).brut, 3.645);
});
test('saisie en net : 2,84 € net → 3,641 € brut (arrondi au millième)', () => {
  const t = Calc.tauxHoraire(S({ tauxType: 'net', tauxSaisi: 2.84 }));
  assert.strictEqual(t.net, 2.84);
  assert.strictEqual(t.brut, 3.641);
});
test('saisie en net à 3 décimales conservée telle quelle', () => {
  assert.strictEqual(Calc.tauxHoraire(S({ tauxType: 'net', tauxSaisi: 2.845 })).net, 2.845);
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
  const s = S({ heuresSemaine: 36, joursSemaine: 4, typeAnnee: 'incomplete', semainesAn: 46, tauxSaisi: 4.20, cpMode: 'juin' });
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
    assert.strictEqual(r.pajemploi.heures, Calc.r2(Calc.heuresMensualisees(s)));
    assert.strictEqual(r.pajemploi.salaireNet, r.netSalaire);
    assert.strictEqual(r.pajemploi.indemnitesEntretien, r.entretien);
  });
  test('Pajemploi : jours d’activité = jours mensualisés arrondis au supérieur', () => {
    assert.strictEqual(r.pajemploi.joursActivite, 16); // 4 × 46 / 12 = 15,33
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
  test('les repas ne sont dus que les jours de présence', () => {
    assert.strictEqual(r.repasDetail[0].nb, 1);
  });
}

console.log('\nAbsences — mensualisation (Pajemploi)');
{
  // 4 j/sem. (lun.–jeu.) × 9 h, 52 sem. : 156 h et 18 jours mensualisés.
  // Septembre 2026 compte 18 lundis–jeudis.
  const s = S({ heuresSemaine: 36, joursSemaine: 4, semainesAn: 52, tauxSaisi: 4, debutContrat: '2026-01-05' });
  const presence = () => {
    const days = {};
    for (const d of Calc.daysOfMonth('2026-09')) {
      const dow = (Calc.parseISO(d).getDay() + 6) % 7;
      if (dow <= 3) days[d] = { statut: 'present', heures: 9, repas: { dej: 1 } };
    }
    return days;
  };
  const avec = (statuts, avant = {}) => {
    const days = { ...avant, ...presence() };
    for (const [d, st] of Object.entries(statuts)) days[d] = { statut: st, heures: 0, repas: {} };
    return Calc.month('2026-09', days, s);
  };
  const normal = avec({});

  test('mois complet : 156 h et 18 jours déclarés', () => {
    assert.strictEqual(normal.pajemploi.heures, 156);
    assert.strictEqual(normal.pajemploi.joursActivite, 18);
  });

  for (const st of ['absent', 'maladie', 'conge', 'ferie']) {
    const r = avec({ '2026-09-08': st, '2026-09-09': st });
    test(`${Calc.ABSENCES[st].label} : salaire et déclaration inchangés`, () => {
      assert.strictEqual(r.brut, normal.brut);
      assert.strictEqual(r.pajemploi.heures, 156);
      assert.strictEqual(r.pajemploi.joursActivite, 18);
    });
    test(`${Calc.ABSENCES[st].label} : entretien et repas retirés`, () => {
      assert.strictEqual(r.entretien, Calc.r2(normal.entretien - 2 * 3.83));
      assert.strictEqual(r.repasTotal, Calc.r2(normal.repasTotal - 2 * 5.50));
    });
  }

  const aa = avec({ '2026-09-08': 'absenceAssmat', '2026-09-09': 'absenceAssmat' });
  test('absence assmat : retenue Cour de cassation = base × 2 / 18', () => {
    const base = Calc.salaireMensualise(s).brut;
    assert.strictEqual(aa.lignes[1].brut, -Calc.r2(base * 2 / 18));
    assert.strictEqual(aa.brut, Calc.r2(base - Calc.r2(base * 2 / 18)));
  });
  test('absence assmat : jours = 18 − 2, heures = net versé ÷ taux net', () => {
    assert.strictEqual(aa.pajemploi.joursActivite, 16);
    assert.strictEqual(aa.pajemploi.heures, Calc.r2(156 * 16 / 18));
    assert.ok(Math.abs(aa.pajemploi.heures - aa.netSalaire / aa.taux.net) < 0.05);
  });

  test('enfant malade avec certificat, dans le quota : retenu', () => {
    const r = avec({ '2026-09-08': 'maladieCertif' });
    assert.strictEqual(r.pajemploi.joursActivite, 17);
    assert.ok(r.brut < normal.brut);
  });
  test('enfant malade avec certificat, au-delà de 5 j sur l’année contractuelle : maintenu', () => {
    const avant = {};
    for (const d of ['2026-03-02', '2026-03-03', '2026-03-04', '2026-06-01'])
      avant[d] = { statut: 'maladieCertif', heures: 0 };
    const r = avec({ '2026-09-08': 'maladieCertif', '2026-09-09': 'maladieCertif' }, avant);
    // 5e jour retenu, 6e maintenu
    assert.deepStrictEqual(r.absencesDeduites, ['2026-09-08']);
    assert.strictEqual(r.pajemploi.joursActivite, 17);
  });
  test('le quota repart à la date anniversaire du contrat', () => {
    const avant = {};
    for (const d of ['2025-09-01', '2025-09-02', '2025-09-03', '2025-09-04', '2025-12-01'])
      avant[d] = { statut: 'maladieCertif', heures: 0 };
    const r = Calc.month('2026-09', { ...avant, '2026-09-08': { statut: 'maladieCertif' } },
      { ...s, debutContrat: '2025-01-05' });
    assert.deepStrictEqual(r.absencesDeduites, ['2026-09-08']);
  });

  test('hospitalisation : 14 jours consécutifs retenus, weekends compris, puis maintenu', () => {
    const st = {};
    for (const d of Calc.daysOfMonth('2026-09')) {
      const dow = (Calc.parseISO(d).getDay() + 6) % 7;
      if (d >= '2026-09-07' && d <= '2026-09-24' && dow <= 3) st[d] = 'hospitalisation';
    }
    const r = avec(st);
    // Du lun. 7 au dim. 20 : 8 jours d'accueil retenus ; 21–24 au-delà du 14e jour.
    assert.strictEqual(r.absencesDeduites.length, 8);
    assert.ok(r.absencesDeduites.every(d => d <= '2026-09-20'));
  });

  const reel = Calc.month('2026-09', { '2026-09-08': { statut: 'absenceAssmat' } }, S({ mode: 'reel' }));
  test('paiement au réel : jours réels, pas de retenue', () => {
    assert.strictEqual(reel.pajemploi.joursActivite, 0);
    assert.strictEqual(reel.absencesDeduites.length, 0);
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
  // Année incomplète, 40 sem. × 45 h à 3,64 € brut : 546,00 € brut par mois.
  const inc = over => S({ typeAnnee: 'incomplete', semainesAn: 40, debutContrat: '2025-06-01', ...over });

  test('année complète : aucun congé payé en sus, même en juin', () => {
    const r = Calc.month('2026-06', {}, S({ debutContrat: '2025-06-01' }));
    assert.strictEqual(r.lignes.length, 1);
    assert.strictEqual(r.brut, 709.80);
  });

  const cp = Calc.congesPayes(2026, {}, inc());
  test('période complète : 12 mois → 30 jours ouvrables acquis', () => {
    assert.strictEqual(cp.mois, 12);
    assert.strictEqual(cp.jours, 30);
  });
  test('dixième = 10 % de 12 × 546,00 € = 655,20 €', () => {
    assert.strictEqual(cp.dixieme, 655.20);
  });
  test('maintien = 5 sem. × 45 h × 3,64 € = 819,00 €, retenu car plus avantageux', () => {
    assert.strictEqual(cp.maintien, 819.00);
    assert.strictEqual(cp.du, 819.00);
    assert.strictEqual(cp.regle, 'maintien de salaire');
  });

  test('paiement en juin : ligne CP en juin, rien les autres mois', () => {
    const juin = Calc.month('2026-06', {}, inc({ cpMode: 'juin' }));
    assert.strictEqual(juin.lignes.at(-1).brut, 819.00);
    assert.strictEqual(juin.brut, Calc.r2(546 + 819));
    assert.strictEqual(Calc.month('2026-07', {}, inc({ cpMode: 'juin' })).brut, 546);
  });
  test('paiement à la prise principale (août) : payé en août', () => {
    const s = inc({ cpMode: 'prise', cpMoisPrise: 8 });
    assert.strictEqual(Calc.month('2026-06', {}, s).brut, 546);
    assert.strictEqual(Calc.month('2026-08', {}, s).brut, Calc.r2(546 + 819));
  });
  test('au fur et à mesure : 10 % chaque mois, complément au maintien en juin', () => {
    const s = inc({ cpMode: 'mensuel' });
    assert.strictEqual(Calc.month('2026-03', {}, s).brut, Calc.r2(546 + 54.60));
    const juin = Calc.month('2026-06', {}, s);
    assert.strictEqual(juin.lignes.find(l => l.cle === 'cp-compl').brut, Calc.r2(819 - 655.20));
  });
  test('contrat démarré en janvier : 5 mois → 13 jours acquis', () => {
    const c = Calc.congesPayes(2026, {}, inc({ debutContrat: '2026-01-10' }));
    assert.strictEqual(c.mois, 5);
    assert.strictEqual(c.jours, 13);  // 12,5 arrondi au supérieur
  });
  test('paiement au réel : congés payés dus en sus', () => {
    assert.ok(Calc.cpEnSus(S({ mode: 'reel' })));
  });
}

console.log('\nRégularisation annuelle (année incomplète)');
{
  // Contrat du 1er septembre 2025, 4 j (lun.–jeu.) × 9 h = 36 h/sem., 40 semaines programmées :
  // 120 h payées par mois, soit 1 440 h sur l'année.
  const s = S({ typeAnnee: 'incomplete', semainesAn: 40, heuresSemaine: 36, joursSemaine: 4,
    tauxSaisi: 4, debutContrat: '2025-09-01', cpMode: 'juin' });
  const remplir = semaines => {
    const days = {};
    let n = 0;
    for (const mk of ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03',
      '2026-04', '2026-05', '2026-06', '2026-07', '2026-08']) {
      for (const d of Calc.daysOfMonth(mk)) {
        const dow = (Calc.parseISO(d).getDay() + 6) % 7;
        if (dow === 0) n++;               // une nouvelle semaine commence le lundi
        if (dow <= 3 && n <= semaines) days[d] = { statut: 'present', heures: 9 };
      }
    }
    return days;
  };

  test('pas de régularisation hors mois anniversaire ni en année complète', () => {
    assert.strictEqual(Calc.regularisation('2026-08', {}, s), null);
    assert.strictEqual(Calc.regularisation('2026-09', {}, { ...s, typeAnnee: 'complete' }), null);
    assert.strictEqual(Calc.regularisation('2025-09', {}, s), null);   // premier mois du contrat
  });

  const plus = Calc.regularisation('2026-09', remplir(45), s);
  test('45 semaines effectuées au lieu de 40 : 5 × 36 h = 180 h à régulariser', () => {
    assert.strictEqual(plus.heuresPayees, 1440);
    assert.strictEqual(plus.heuresDues, 1620);
    assert.strictEqual(plus.ecart, 180);
    assert.strictEqual(plus.montant, 720);
  });
  test('la régularisation apparaît sur la fiche du mois anniversaire', () => {
    const r = Calc.month('2026-09', remplir(45), s);
    const l = r.lignes.find(x => x.cle === 'regul');
    assert.strictEqual(l.brut, 720);
    assert.strictEqual(r.pajemploi.heures, Calc.r2(120 + 180));
  });
  test('moins de semaines que prévu : trop-payé non retenu', () => {
    const moins = Calc.regularisation('2026-09', remplir(38), s);
    assert.ok(moins.ecart < 0);
    assert.strictEqual(moins.montant, 0);
    assert.ok(!Calc.month('2026-09', remplir(38), s).lignes.some(x => x.cle === 'regul'));
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
