/* Vérifications du stockage multi-contrats : node tests/store.test.js */
const assert = require('assert');
global.Calc = require('../js/calc.js');

// Faux localStorage en mémoire, remis à zéro avant chaque scénario.
let mem = {};
global.localStorage = {
  getItem: k => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: k => { delete mem[k]; }
};
const Store = require('../js/store.js');

let ok = 0;
const test = (nom, fn) => {
  mem = {};
  try { fn(); ok++; console.log(`  ✓ ${nom}`); }
  catch (e) { console.error(`  ✗ ${nom}\n    ${e.message}`); process.exitCode = 1; }
};

console.log('\nMigration depuis l’ancien format (un seul contrat)');
test('les anciennes données deviennent le contrat c1, sans perte', () => {
  mem['assmat.settings.v1'] = JSON.stringify({ enfant: 'Léo', tauxSaisi: 4.2 });
  mem['assmat.days.v1'] = JSON.stringify({ '2026-09-07': { statut: 'present', heures: 9 } });
  const liste = Store.contrats();
  assert.deepStrictEqual(liste.map(c => [c.id, c.enfant, c.actif]), [['c1', 'Léo', true]]);
  assert.strictEqual(Store.loadSettings().tauxSaisi, 4.2);
  assert.strictEqual(Store.loadDays()['2026-09-07'].heures, 9);
  assert.ok(!('assmat.settings.v1' in mem) && !('assmat.days.v1' in mem));
});
test('première utilisation : un contrat vide, couleur par défaut', () => {
  const [c] = Store.contrats();
  assert.strictEqual(c.id, 'c1');
  assert.strictEqual(c.couleur, 'ciel');
});

console.log('\nAjout, bascule, suppression');
test('ajout : paramètres copiés, prénom vidé, journées vides, autre couleur, devient actif', () => {
  Store.saveSettings({ ...Store.loadSettings(), enfant: 'Léo', tauxSaisi: 4.2 });
  Store.saveDays({ '2026-09-07': { statut: 'present', heures: 9 } });
  const id = Store.ajouterContrat();
  const s = Store.loadSettings();
  assert.strictEqual(s.tauxSaisi, 4.2);
  assert.strictEqual(s.enfant, '');
  assert.notStrictEqual(s.couleur, 'ciel');
  assert.deepStrictEqual(Store.loadDays(), {});
  assert.strictEqual(Store.contrats().find(c => c.actif).id, id);
});
test('chaque contrat garde ses propres journées', () => {
  Store.saveDays({ '2026-09-07': { statut: 'present', heures: 9 } });
  const id2 = Store.ajouterContrat();
  Store.saveDays({ '2026-09-08': { statut: 'present', heures: 7 } });
  Store.activer('c1');
  assert.deepStrictEqual(Object.keys(Store.loadDays()), ['2026-09-07']);
  Store.activer(id2);
  assert.deepStrictEqual(Object.keys(Store.loadDays()), ['2026-09-08']);
});
test('les 6 premiers contrats ont 6 couleurs différentes', () => {
  for (let i = 0; i < 5; i++) Store.ajouterContrat();
  const couleurs = Store.contrats().map(c => c.couleur);
  assert.strictEqual(new Set(couleurs).size, 6);
});
test('le dernier contrat ne peut pas être supprimé', () => {
  assert.strictEqual(Store.supprimerContrat('c1'), false);
  assert.strictEqual(Store.contrats().length, 1);
});
test('supprimer le contrat actif réactive le premier restant et efface ses données', () => {
  const id = Store.ajouterContrat();
  Store.saveDays({ '2026-09-08': { statut: 'present', heures: 7 } });
  assert.ok(Store.supprimerContrat(id));
  assert.deepStrictEqual(Store.contrats().map(c => [c.id, c.actif]), [['c1', true]]);
  assert.ok(!(`assmat.days.${id}` in mem));
});

console.log('\nSauvegarde et restauration');
test('export v2 puis import : tous les contrats sont restitués', () => {
  Store.saveSettings({ ...Store.loadSettings(), enfant: 'Léo' });
  Store.ajouterContrat();
  Store.saveSettings({ ...Store.loadSettings(), enfant: 'Emma' });
  Store.saveDays({ '2026-09-08': { statut: 'present', heures: 7 } });
  const json = Store.exportJSON();
  mem = {};
  const res = Store.importJSON(json);
  assert.ok(res.ok, res.message);
  assert.deepStrictEqual(Store.contrats().map(c => c.enfant), ['Léo', 'Emma']);
  assert.strictEqual(Store.contrats().find(c => c.actif).enfant, 'Emma');
  assert.strictEqual(Store.loadDays()['2026-09-08'].heures, 7);
});
test('import d’une sauvegarde v1 : remplace tout par un seul contrat', () => {
  Store.ajouterContrat();
  const res = Store.importJSON(JSON.stringify({
    version: 1, settings: { enfant: 'Léo', semainesAn: 40 }, days: { '2026-09-07': { heures: 9 } }
  }));
  assert.ok(res.ok);
  assert.strictEqual(Store.contrats().length, 1);
  assert.strictEqual(Store.loadSettings().enfant, 'Léo');
  assert.strictEqual(Store.loadSettings().typeAnnee, 'incomplete');   // migration conservée
});
test('fichier sans données : refusé, rien n’est effacé', () => {
  Store.saveSettings({ ...Store.loadSettings(), enfant: 'Léo' });
  assert.strictEqual(Store.importJSON('{"foo":1}').ok, false);
  assert.strictEqual(Store.loadSettings().enfant, 'Léo');
});
test('tout effacer : plus aucune donnée Pay Assmat', () => {
  Store.ajouterContrat();
  Store.effacerTout();
  assert.deepStrictEqual(Object.keys(mem), []);
});

console.log(`\n${ok} vérifications passées${process.exitCode ? ' — des échecs subsistent' : '.'}\n`);
