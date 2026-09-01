# Assmat — suivi de garde & fiche de paie

Application web installable (PWA) pour suivre les journées de garde d'un enfant chez son
assistante maternelle et produire la fiche de paie mensuelle.

Tout fonctionne **hors ligne** et **sans serveur** : les données ne quittent jamais l'appareil
(elles sont conservées dans le `localStorage` du navigateur).

## Utilisation

```bash
python3 -m http.server 8123
```

Puis ouvrir <http://localhost:8123>. Sur mobile, « Ajouter à l'écran d'accueil » installe
l'application ; sur Chrome de bureau, le bouton « Installer » apparaît dans l'en-tête.

Pour un usage réel, déposer le dossier sur n'importe quel hébergement statique en HTTPS
(GitHub Pages, Netlify, Cloudflare Pages…) — le service worker exige un contexte sécurisé,
`localhost` excepté.

## Fonctionnement

**Calendrier** — une case par jour. On y saisit les heures de présence (par pas de 15 min),
le nombre de repas, éventuellement des kilomètres et une note, ou un statut d'absence
(absence enfant, congé, jour férié, maladie). La colonne `Σ` donne le total hebdomadaire et
passe en orange au-delà du seuil de majoration. Le remplissage rapide applique la journée
type aux jours d'accueil du contrat sans écraser ce qui existe déjà.

**Paramètres** — taux horaire (saisi en brut ou en net, l'autre étant déduit du taux de
cotisations), mode de paiement, volume contractuel, seuils et taux de majoration, barème
d'entretien, prix des repas, frais kilométriques, congés payés.

**Fiche de paie** — bulletin imprimable (Ctrl/⌘+P produit un PDF propre), récapitulatif des
champs à reporter dans Pajemploi, export CSV, et détail semaine par semaine.

## Calculs

Barèmes 2026, tous modifiables dans les paramètres.

| Élément | Règle |
|---|---|
| Salaire mensualisé | `taux horaire × heures/semaine × semaines/an ÷ 12` |
| Paiement au réel | heures effectivement saisies × taux horaire |
| Heures complémentaires | au-delà du contrat hebdomadaire, jusqu'au seuil de majoration, au taux normal |
| Heures majorées | +25 % sur les 8 premières heures au-delà de 45 h/semaine, +50 % ensuite |
| Indemnité d'entretien | `0,425 €/h`, plancher 2,65 €/jour, plafond 3,83 €/jour |
| Repas | prix unitaire × nombre saisi |
| Net | `brut × (1 − taux de cotisations)`, ≈ 22 % par défaut |
| Net à payer | net salarial + indemnités (non soumises à cotisations) |

Deux points à connaître :

- Les majorations se calculent **par semaine ISO**. Une semaine à cheval sur deux mois n'est
  comptée, dans chaque mois, que pour sa portion — le détail hebdomadaire de la fiche rend ce
  découpage visible.
- Le passage brut → net est une **estimation** à taux unique. Les cotisations réelles dépendent
  de la situation de l'employeur ; Pajemploi fait foi.

## Design system

L'interface applique le design system **Nurture Payroll** (`Soft Minimalism`) : pastels
haute luminance, formes très arrondies, ombres presque absentes, respiration généreuse.

| | |
|---|---|
| Bleu ciel | zones de calcul, jours saisis, actions principales |
| Rose poudré | informations personnelles, absences, repas |
| Vert menthe | résultats : net à payer, totaux hebdomadaires |
| Jaune soleil | attention bienveillante : champ actif, dépassement du seuil, récap Pajemploi |

Typographie : **Quicksand** pour les titres et tous les montants, **Nunito Sans** pour le
texte courant et les formulaires. Les deux familles sont des polices variables
**auto-hébergées** dans `fonts/` (59 Ko au total) et mises en cache par le service worker :
aucune requête vers un CDN, l'application garde son rendu hors ligne.

Trois écarts assumés par rapport au document de référence :

- Le design system ne fournit **qu'une palette claire**. L'application est donc en clair
  uniquement (`color-scheme: light`), sans thème sombre.
- Le **jaune soleil** est nommé dans la prose mais aucun jeton ne l'accompagne : les valeurs
  (`--quaternary*`) ont été dérivées dans l'esprit de la palette.
- Les paddings de carte (48 px) et les tailles de titre sont **réduits sous 700 px** ; à
  pleine valeur, il ne restait pas assez de place pour le contenu sur un écran de téléphone.

## Développement

Aucune dépendance, aucune étape de build.

```bash
node tests/calc.test.js    # 37 vérifications du moteur de calcul
node tools/gen-icons.js    # régénère les icônes PNG
```

| Fichier | Rôle |
|---|---|
| `js/calc.js` | moteur de calcul, fonctions pures, testable sous Node |
| `js/store.js` | persistance, import/export JSON et CSV |
| `js/app.js` | interface : calendrier, éditeur de journée, paramètres, fiche de paie |
| `sw.js` | service worker (app shell en cache, fonctionnement hors ligne) |
| `css/style.css` | design system Nurture Payroll : jetons, composants, impression |
| `fonts/` | Quicksand et Nunito Sans, polices variables auto-hébergées |
