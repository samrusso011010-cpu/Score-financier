/*
  pdf-engine.js
  Moteur partagé (quiz + page de révision) : source unique de vérité pour les
  données de score/segment/comptes, les calculs de projection, et la
  génération du PDF de résultats.

  Dépendances à charger AVANT ce script dans la page hôte :
    - jsPDF (UMD)            https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js
    - jspdf-autotable (UMD)  https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js
    - Chart.js                https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js

  Expose window.PDFEngine
*/
(function(global){
'use strict';

// ======================= DONNÉES PARTAGÉES (identiques au quiz) =======================
// Philosophie : comprendre le besoin réel (mise en situation) avant de questionner
// la possession d'un produit d'assurance — voir s8.
// Note : "dans quels comptes investis-tu" n'est pas notée ici — elle est déjà
// couverte plus loin par accounts_selected + accounts_details (montants réels).
const SCORE_QUESTIONS = [
  { id:'s1', pillar:"Fonds d'urgence", title:"Combien de mois de dépenses ton fonds d'urgence couvre-t-il actuellement?",
    options:[{label:"Aucun fonds d'urgence",pts:0},{label:"Moins d'un mois",pts:2},{label:"1 à 3 mois",pts:5},{label:"3 à 6 mois",pts:8},{label:"Plus de 6 mois",pts:10}],
    explications:[
      "Sans coussin de sécurité, une dépense imprévue t'obligerait à emprunter ou à puiser dans tes placements — potentiellement au pire moment, comme lors d'une baisse de marché. Le fonds d'urgence existe justement pour éviter de vendre tes placements à perte quand un imprévu survient.",
      "Ton coussin actuel ne couvrirait qu'une fraction d'un imprévu. Le fonds d'urgence sert à éviter de puiser dans tes placements — possiblement en baisse — pour couvrir une dépense inattendue, et à ce niveau, la protection reste fragile.",
      "Un bon début, mais encore insuffisant pour éviter de devoir puiser dans tes placements, possiblement au mauvais moment, en cas d'imprévu prolongé ou de perte de revenu.",
      "Un bon niveau de protection, proche de la norme recommandée — ce coussin te permet d'absorber la plupart des imprévus sans avoir à vendre tes placements, même en période de baisse.",
      "Super, une bonne somme est disponible en cas d'urgence. Mais attention : une trop grosse somme non investie peut être une erreur — cet argent hors marché perd du pouvoir d'achat face à l'inflation et pourrait autrement travailler pour toi.",
    ]},
  { id:'s3', pillar:"Épargne", title:"Quel pourcentage de ton revenu épargnes-tu ou investis-tu chaque mois?",
    options:[{label:"0 %",pts:0},{label:"1 à 5 %",pts:3},{label:"6 à 10 %",pts:6},{label:"11 à 20 %",pts:8},{label:"Plus de 20 %",pts:10}],
    explications:[
      "Épargner une partie de ton revenu, même modeste, est ce qui permet à l'intérêt composé de travailler pour toi. À 0 %, aucune accumulation n'est possible par l'épargne seule, peu importe le rendement — ton patrimoine dépend uniquement de facteurs externes (héritage, immobilier, etc.).",
      "Un début, mais à ce rythme, il faut environ 14 ans pour accumuler l'équivalent d'une année de salaire (à 5 % de rendement annuel) — l'augmenter ferait une différence importante.",
      "Un taux raisonnable — à ce rythme, environ 8 ans suffisent pour accumuler l'équivalent d'une année de salaire (à 5 % de rendement annuel).",
      "Un excellent taux — à ce rythme, environ 4,5 ans suffisent pour accumuler l'équivalent d'une année de salaire (à 5 % de rendement annuel).",
      "Un taux exceptionnel — à ce rythme, environ 3,5 à 4 ans suffisent pour accumuler l'équivalent d'une année de salaire (à 5 % de rendement annuel).",
    ]},
  { id:'s4', pillar:"Épargne", title:"Ton épargne se fait-elle automatiquement, ou seulement s'il te reste de l'argent en fin de mois?",
    options:[{label:"Seulement s'il reste de l'argent",pts:0},{label:"Occasionnellement, sans automatisation",pts:3},{label:"Automatique, mais irrégulière",pts:6},{label:"Automatique et régulière",pts:10}],
    explications:[
      "Épargner seulement ce qui reste en fin de mois inverse le bon ordre : les dépenses s'ajustent pour combler l'argent disponible. En plus de retarder l'épargne, cette approche prive aussi de l'investissement périodique automatique (dollar cost averaging) — investir un montant fixe à intervalles réguliers, peu importe les conditions de marché, ce qui réduit le risque de mal synchroniser tes achats et abaisse ton coût moyen avec le temps.",
      "Sans automatisation, l'épargne dépend de la discipline et de la mémoire. Automatiser tes cotisations te ferait aussi profiter de l'investissement périodique automatique, qui réduit le risque d'investir au mauvais moment en lissant ton prix d'achat moyen.",
      "Tu profites déjà en partie de l'investissement périodique automatique, mais la régularité amplifierait cet effet de lissage sur ton coût moyen d'achat.",
      "Tu pratiques déjà l'investissement périodique automatique dans sa forme optimale — chaque cotisation régulière achète plus de parts quand les prix sont bas et moins quand ils sont élevés, réduisant ton coût moyen et le risque de mal synchroniser le marché.",
    ]},
  { id:'s5', pillar:"Endettement", title:"As-tu de la dette à taux d'intérêt élevé (carte de crédit, marge)?",
    options:[{label:"Oui, des soldes élevés non remboursés",pts:0},{label:"Oui, mais je rembourse graduellement",pts:4},{label:"Un solde minime, remboursé chaque mois",pts:8},{label:"Aucune dette à taux élevé",pts:10}],
    explications:[
      "Les taux d'intérêt des cartes de crédit et marges dépassent souvent 20 % par année — un coût que très peu de placements peuvent battre de façon fiable. Rembourser cette dette en priorité équivaut à un rendement garanti équivalent à ce taux, sans aucun risque.",
      "Tu es sur la bonne voie, mais tant que le solde n'est pas éliminé, les intérêts élevés continuent de s'accumuler plus vite que la plupart des rendements de placement — accélérer le remboursement reste la priorité la plus rentable.",
      "En remboursant le solde au complet chaque mois, tu évites les intérêts élevés tout en gardant la flexibilité du crédit — une gestion saine.",
      "Aucune dette à taux élevé ne vient éroder ta capacité d'épargne — cette base solide te permet de concentrer tes efforts sur la croissance de ton patrimoine plutôt que sur le remboursement d'intérêts.",
    ],
    noteGenerale:"Toute dette n'est pas nécessairement mauvaise : une dette peut être productive si elle sert à générer un revenu ou à augmenter ta valeur nette (ex. prêt investissement, hypothèque locative, dette d'entreprise). Des stratégies de levier existent pour accélérer l'enrichissement, mais elles doivent être utilisées avec discipline et à bon escient. La dette visée ici est spécifiquement la dette de consommation à taux élevé (carte de crédit, marge personnelle) — celle-là est presque toujours défavorable." },
  { id:'s8', pillar:"Protection", title:"Qu'arriverait-il à ta situation financière si une invalidité, une maladie ou un accident t'empêchait de travailler et de générer un revenu?",
    options:[{label:"Aucune solution pour l'instant",pts:0},{label:"Je devrais emprunter",pts:3},{label:"Je devrais puiser dans mes placements",pts:6},{label:"J'ai une assurance collective",pts:8},{label:"J'ai une assurance individuelle",pts:10}],
    explications:[
      "Sans protection, une invalidité prolongée pourrait rapidement mettre à risque ton train de vie et t'obliger à emprunter ou à vendre des actifs en catastrophe. C'est l'angle mort le plus critique à combler en priorité.",
      "Emprunter pour combler une perte de revenu ajoute un fardeau de dette à un moment déjà difficile — les intérêts s'accumulent pendant que ta capacité de rembourser est réduite.",
      "Puiser dans tes placements pour combler une perte de revenu dérange ta stratégie à long terme — retirer des sommes importantes, potentiellement en période de baisse de marché, réduit ta capacité future de croissance et peut entraîner des impacts fiscaux.",
      "L'assurance collective peut être suffisante, mais elle est souvent limitée (montant, durée) et cesse généralement si tu quittes ton emploi — il s'agit de confirmer que la couverture actuelle protège réellement ton train de vie et évite de devoir puiser dans ton épargne.",
      "Une assurance individuelle t'offre généralement la protection la plus complète et te suit peu importe les changements d'emploi — encore faut-il qu'elle soit à jour par rapport à tes besoins actuels (revenu, train de vie, personnes à charge).",
    ]},
  { id:'s10', pillar:"Retraite", title:"As-tu une idée claire du montant dont tu auras besoin à la retraite, et si tu es sur la bonne voie?",
    options:[{label:"Aucune idée",pts:0},{label:"Une vague estimation",pts:4},{label:"Une idée, mais pas de plan formel",pts:7},{label:"Oui, j'ai un plan clair",pts:10}],
    explications:[
      "Sans cible claire, il est impossible de savoir si tes cotisations actuelles suffiront — tu pourrais épargner trop peu sans le savoir, ou plus que nécessaire au détriment d'autres objectifs. Établir un montant cible est la base de toute planification de retraite.",
      "Une estimation approximative est un bon point de départ, mais sans calcul précis (inflation, espérance de vie, revenus gouvernementaux), il est difficile de savoir si tu es réellement sur la bonne voie.",
      "Tu as une bonne intuition de ton objectif, mais l'absence d'un plan formel rend difficile de suivre ta progression année après année et d'ajuster au bon moment si l'écart se creuse.",
      "Un plan clair te permet de suivre ta progression, d'ajuster tes cotisations au besoin, et d'aborder la retraite avec confiance plutôt qu'incertitude.",
    ]},
];

const PILLARS = ["Fonds d'urgence","Épargne","Endettement","Protection","Retraite"];

// Tranches de valeur pour l'immobilier secondaire (un ou plusieurs actifs, valeur
// totale approximative) — value = point représentatif utilisé pour les projections.
const IMMO_SECONDAIRE_TRANCHES = [
  {label:"Moins de 100 000 $", value:75000},
  {label:"100 000 $ à 250 000 $", value:175000},
  {label:"250 000 $ à 500 000 $", value:375000},
  {label:"500 000 $ à 1 000 000 $", value:750000},
  {label:"1 000 000 $ et plus", value:1250000},
];

const ACCUMULATION_ACCOUNTS = ['REER','CELI','CELIAPP','REEE','NONENR','REEI'];
const DECAISSEMENT_ACCOUNTS = ['CRI','FRV','FERR','REERIMMO'];
const ACCOUNT_LABELS = {
  REER:"REER", CELI:"CELI", CELIAPP:"CELIAPP", REEE:"REEE", NONENR:"Compte non enregistré", REEI:"REEI",
  CRI:"CRI", FRV:"FRV", FERR:"FERR", REERIMMO:"REER immobilisé"
};

// Normes d'hypothèses de projection IQPF, édition 2026
const IQPF = {
  inflation: 0.0210,
  courtTerme: 0.0240,
  revenuFixe: 0.0320,
  actionsCA: 0.0630,
  actionsUS: 0.0640,
  actionsIntl: 0.0660,
  actionsEmergents: 0.0750,
  tauxEmprunt: 0.0440,
  croissanceSalaire: 0.0310,
  immobilier: 0.0420, // remplace 3,10% IQPF — choix délibéré du projet
};
// Bloc "actions" moyenné également entre les 4 catégories boursières IQPF (hypothèse
// simplificatrice documentée — aucune pondération géographique précise n'a été demandée).
const ACTIONS_BLEND = (IQPF.actionsCA + IQPF.actionsUS + IQPF.actionsIntl + IQPF.actionsEmergents) / 4;

// Répartitions standards par profil (revenu fixe / actions)
const PROFILE_MIX = {
  prudent:   { fixe:0.70, actions:0.30 },
  equilibre: { fixe:0.40, actions:0.60 },
  audacieux: { fixe:0.15, actions:0.85 },
};
// Ordre des options des questions "profil" (tolérance au risque) et
// "allocation_actuelle" (comment l'argent est réellement investi) dans le quiz —
// les deux questions partagent volontairement les mêmes 4 catégories pour
// permettre une comparaison directe statu quo / plan optimisé.
const PROFILE_KEYS = ['prudent','equilibre','audacieux','inconnu'];
function profileKeyFromIndex(i){ return PROFILE_KEYS[i]; }
const PROFILE_LABELS = { prudent:'prudent', equilibre:'équilibré', audacieux:'audacieux', inconnu:'inconnu' };

function weightedRate(profil){
  if(profil==='inconnu' || !profil) return IQPF.inflation;
  const mix = PROFILE_MIX[profil];
  if(!mix) return IQPF.inflation;
  return mix.fixe*IQPF.revenuFixe + mix.actions*ACTIONS_BLEND;
}

// ======================= SCORE / SEGMENT (logique identique au quiz) =======================
// Normalisé sur 100 à partir du nombre de questions notées réellement présentes —
// le score reste toujours "/100" même si des questions sont ajoutées/retirées.
function scoreTotal(answers){
  let total = 0, max = 0;
  SCORE_QUESTIONS.forEach(q=>{
    max += 10;
    const i = answers[q.id];
    if(i!==undefined) total += q.options[i].pts;
  });
  return max ? Math.round((total / max) * 100) : 0;
}

// Chaque pilier peut avoir un nombre différent de questions notées (donc un max
// différent) — pct ramène toujours chaque pilier sur 100 pour un affichage cohérent.
function pillarScores(answers){
  const out = {};
  PILLARS.forEach(p=>{ out[p] = {score:0, max:0}; });
  SCORE_QUESTIONS.forEach(q=>{
    out[q.pillar].max += 10;
    const i = answers[q.id];
    if(i!==undefined) out[q.pillar].score += q.options[i].pts;
  });
  PILLARS.forEach(p=>{
    const { score, max } = out[p];
    out[p].pct = max ? Math.round((score / max) * 100) : 0;
  });
  return out;
}

function scoreTier(total){
  if(total<40) return {tier:'Vulnérable', color:[139,58,58]};
  if(total<60) return {tier:'En construction', color:[184,147,90]};
  if(total<80) return {tier:'Solide', color:[184,147,90]};
  return {tier:'Excellente santé financière', color:[27,42,74]};
}

function computeSegment(answers){
  let level = 0; // 0 faible, 1 moyenne, 2 haute
  const e = answers.epargne;
  if(e===undefined) return 'moyenne';
  if(e<=1) level=0; else if(e<=4) level=1; else level=2;
  if(answers.entreprise==='oui' || answers.immo_secondaire==='oui') level = Math.min(2, level+1);
  return ['faible','moyenne','haute'][level];
}

const SEGMENT_LABELS = {
  faible: 'Bâtir les bases (< 50 000 $)',
  moyenne: 'Valeur nette moyenne (50 000 $ – 1 M$)',
  haute: 'Haute valeur nette (1 M$+)'
};

// ======================= PROJECTIONS =======================
// Les comptes de placement (REER/CELI/etc.) sont projetés jusqu'à 65 ans seulement —
// au-delà, on ne présume plus d'une accumulation continue au même rythme (ce n'est pas
// réaliste). L'immobilier, lui, continue jusqu'à 100 ans (l'actif reste généralement
// détenu jusqu'au décès).
const INVEST_PROJECTION_CAP_AGE = 65;
// Le CELIAPP a une durée de vie légale maximale de 15 ans (après quoi il doit être
// fermé, généralement transféré au REER) — sa projection s'arrête à cette limite plutôt
// qu'à 65 ans si elle survient avant.
const ACCOUNT_MAX_YEARS = { CELIAPP: 15 };
function accountCapAge(code, age){
  const maxYears = ACCOUNT_MAX_YEARS[code];
  return maxYears!==undefined ? Math.min(INVEST_PROJECTION_CAP_AGE, age+maxYears) : INVEST_PROJECTION_CAP_AGE;
}

function decadeAges(age){
  const ages = [];
  let a = age;
  while(a < 100){ ages.push(a); a += 10; }
  ages.push(100);
  return ages;
}
// Comme decadeAges, mais s'arrête à `cap` plutôt qu'à 100 (utilisé pour les comptes de
// placement). Si l'âge de départ dépasse déjà le cap, retourne un seul point (pas
// d'horizon d'accumulation supplémentaire défini dans ce modèle simplifié).
function decadeAgesCapped(age, cap){
  const effectiveCap = Math.max(cap, age);
  const ages = [];
  let a = age;
  while(a < effectiveCap){ ages.push(a); a += 10; }
  ages.push(effectiveCap);
  return ages;
}

// FV avec cotisation annuelle constante (rente ordinaire, versée en fin d'année)
function futureValue(balance, contributionAnnual, rate, years){
  const b = balance||0, c = contributionAnnual||0;
  if(years<=0) return b;
  if(rate===0) return b + c*years;
  const growth = Math.pow(1+rate, years);
  return b*growth + c*((growth-1)/rate);
}

function accountSeries(balance, contributionAnnual, rate, age, agesList){
  return agesList.map(a => ({ age:a, valeur: futureValue(balance, contributionAnnual, rate, a-age) }));
}
// Valeur d'un compte de placement à targetAge, en gelant la croissance après `cap`
// (utilisé pour le graphique de patrimoine total, qui continue jusqu'à 100 ans même si
// les comptes de placement, eux, arrêtent de croître après 65 dans ce modèle).
function investmentValueAtAge(balance, contribAnnual, rate, age, targetAge, cap){
  const effectiveAge = Math.min(targetAge, Math.max(cap, age));
  return futureValue(balance, contribAnnual, rate, effectiveAge - age);
}

function buildProjections(answers){
  const age = answers.age;
  const profilKey = answers.profil!==undefined ? profileKeyFromIndex(answers.profil) : undefined;
  const rate = weightedRate(profilKey);
  const selected = answers.accounts_selected || [];
  const details = answers.accounts_details || {};
  const accounts = [];

  const investAges = decadeAgesCapped(age, INVEST_PROJECTION_CAP_AGE);
  const fullAges = decadeAges(age);

  selected.forEach(code=>{
    const d = details[code] || {};
    const solde = parseFloat(d.solde)||0;
    const isAccum = ACCUMULATION_ACCOUNTS.includes(code);
    let contribAnnual = 0;
    if(isAccum && d.cotisation){
      const c = parseFloat(d.cotisation)||0;
      contribAnnual = d.freq==='mensuelle' ? c*12 : c;
    }
    const capAge = accountCapAge(code, age);
    accounts.push({
      code, label: ACCOUNT_LABELS[code], isAccum,
      solde, contribAnnual, capAge,
      serie: accountSeries(solde, contribAnnual, rate, age, decadeAgesCapped(age, capAge))
    });
  });

  const immobilier = [];
  if(answers.residence==='oui' && answers.residence_valeur){
    immobilier.push({ label:'Résidence principale', valeur: parseFloat(answers.residence_valeur)||0,
      serie: accountSeries(parseFloat(answers.residence_valeur)||0, 0, IQPF.immobilier, age, fullAges) });
  }
  if(answers.immo_secondaire==='oui' && answers.immo_secondaire_valeur!==undefined){
    const tranche = IMMO_SECONDAIRE_TRANCHES[answers.immo_secondaire_valeur];
    const valeurImmoSecondaire = tranche ? tranche.value : 0;
    immobilier.push({ label:'Immobilier secondaire (autres actifs)', valeur: valeurImmoSecondaire,
      serie: accountSeries(valeurImmoSecondaire, 0, IQPF.immobilier, age, fullAges) });
  }

  // Patrimoine total jusqu'à 100 ans : les comptes de placement sont gelés à leur
  // valeur de 65 ans (pas de décroissance présumée, mais plus de croissance non plus),
  // pendant que l'immobilier continue de s'apprécier.
  const total = fullAges.map(a=>{
    let sum = 0;
    accounts.forEach(acc=> sum += investmentValueAtAge(acc.solde, acc.contribAnnual, rate, age, a, acc.capAge));
    immobilier.forEach(im=> sum += futureValue(im.valeur, 0, IQPF.immobilier, a-age));
    return { age:a, valeur: sum };
  });
  // Portefeuille de placements seulement (hors immobilier), jusqu'à 65 ans — c'est la
  // portion réellement affectée par un choix d'allocation, donc la seule pertinente
  // pour la comparaison statu quo / plan optimisé. Chaque compte respecte son propre
  // plafond (ex. CELIAPP gelé après 15 ans) via investmentValueAtAge.
  const investableTotal = investAges.map(a=>{
    let sum = 0;
    accounts.forEach(acc=> sum += investmentValueAtAge(acc.solde, acc.contribAnnual, rate, age, a, acc.capAge));
    return { age:a, valeur: sum };
  });

  // Comparatif statu quo (allocation actuelle déclarée) vs plan optimisé (profil déclaré)
  let statuQuo = null;
  const actuelIdx = answers.allocation_actuelle;
  if(accounts.length && actuelIdx!==undefined){
    const actuelKey = profileKeyFromIndex(actuelIdx);
    if(actuelKey!=='inconnu' && profilKey && profilKey!=='inconnu'){
      const rateActuel = weightedRate(actuelKey);
      const investableTotalActuel = investAges.map(a=>{
        let sum = 0;
        accounts.forEach(acc=> sum += investmentValueAtAge(acc.solde, acc.contribAnnual, rateActuel, age, a, acc.capAge));
        return { age:a, valeur: sum };
      });
      statuQuo = {
        actuelKey, profilKey,
        aligned: actuelKey===profilKey,
        rateActuel, rateOptimise: rate,
        investableTotalActuel, investableTotalOptimise: investableTotal,
      };
    }
  }

  return { age, rate, accounts, immobilier, total, investableTotal, ages: fullAges, investAges, statuQuo };
}

// ======================= NARRATIF =======================
const SEGMENT_FOCUS = {
  faible: "À ce stade, l'objectif principal est de bâtir des bases solides : fonds d'urgence, réduction de la dette à taux élevé, et démarrage d'une épargne automatisée — avant de complexifier la stratégie.",
  moyenne: "Le focus est sur l'optimisation : maximiser l'usage des bons comptes (REER/CELI/CELIAPP), structurer les cotisations selon les objectifs, et s'assurer que la protection suit la croissance du patrimoine.",
  haute: "Le focus se déplace vers l'optimisation fiscale, la planification de décaissement et la planification successorale, en plus de la croissance du patrimoine."
};

function goalLabel(g, answers){
  const map = {retraite:"Retraite", propriete:"Achat d'une propriété", etudes:"Études des enfants", entreprise_obj:"Démarrer/faire croître une entreprise"};
  if(g==='autre') return answers.goals_other || 'Autre objectif';
  return map[g] || g;
}
// Autre = volontairement sans explication (objectif trop variable pour un texte générique).
const GOALS_EXPLANATIONS = {
  retraite: "Un horizon de retraite bien identifié permet de calibrer le niveau de risque et le rythme d'épargne appropriés pour atteindre cet objectif à temps.",
  propriete: "Un achat immobilier implique plusieurs étapes de préparation : bâtir une bonne cote de crédit, accumuler la mise de fonds nécessaire, et respecter les ratios d'endettement exigés par les prêteurs. Connaître ton horizon permet de structurer tes placements en fonction du temps disponible pour ces préparatifs.",
  etudes: "Un horizon d'études bien défini permet de profiter d'outils fiscalement avantageux (comme le REEE) et d'ajuster le niveau de risque à mesure que l'échéance approche.",
  entreprise_obj: "Un objectif entrepreneurial implique souvent des besoins de liquidités à court ou moyen terme — un facteur important dans la structuration de ton portefeuille.",
};

const RESIDENCE_EXPLANATION_OUI = "Ta résidence principale représente souvent l'actif le plus important de ton bilan. Plutôt que de laisser toute cette valeur immobilisée « entre quatre murs », un prêt investissement adossé à cette équité peut permettre de mettre cet argent au travail — le levier peut être un outil puissant d'accélération de la croissance de ton patrimoine, lorsqu'il est bien utilisé. Cette stratégie s'adresse toutefois à certains profils et à des moments stratégiques précis — elle mérite d'être évaluée en fonction de ta situation.";
const IMMO_SECONDAIRE_EXPLANATION_OUI = "Un actif immobilier secondaire peut générer un revenu locatif ou une plus-value à long terme, mais contrairement à la résidence principale, l'impôt sur le gain en capital s'appliquera lors de la vente. Si l'objectif est de léguer cet actif, différentes stratégies existent pour faciliter ce transfert et en minimiser l'impact fiscal.";
const ENFANTS_EXPLANATION_OUI = "Épargner tôt pour tes enfants permet de profiter pleinement des subventions gouvernementales offertes via le REEE — un rendement garanti minimum de 30 % sur tes cotisations, ce qui est vraiment formidable — en plus de la croissance composée sur un horizon souvent prévisible (18 ans avant les études).";
const REEI_EXPLANATION_OUI = "L'admissibilité au crédit d'impôt pour personne handicapée ouvre la porte au REEI, un régime qui offre des subventions et bons gouvernementaux généreux (jusqu'à 3 500 $/an en subvention) — un outil souvent sous-utilisé qui mérite d'être exploré.";
const SUCCESSION_EXPLANATION_OUI = "Une planification successorale bien structurée permet de minimiser l'impôt au décès, d'assurer que tes volontés soient respectées, et de simplifier le processus pour tes proches à un moment déjà difficile.";

const DEPENDANTS_EXPLANATIONS = {
  oui: "Si des personnes dépendent de ton revenu, une protection adéquate (assurance vie, invalidité) devient essentielle pour assurer leur sécurité financière advenant un imprévu — c'est souvent le signal le plus clair du besoin réel de protection.",
  non: "Sans personne à charge, le besoin de protection est généralement moins urgent, mais une assurance peut tout de même être pertinente pour couvrir des dettes ou des frais finaux.",
};
const ASSURANCE_VIE_EXPLANATIONS = {
  oui: "Une protection est déjà en place — il reste à confirmer qu'elle couvre adéquatement tes besoins actuels (dettes, train de vie des proches, objectifs successoraux), puisque ceux-ci évoluent avec le temps.",
  non: "Sans assurance vie, advenant un décès prématuré, tes proches pourraient devoir assumer seuls tes dettes et une perte de revenu importante — un enjeu à évaluer selon ta situation.",
};

const BIZ_EXPLANATIONS = {
  biz_employe_cle: {
    oui: "La perte d'un employé ou associé clé pourrait fragiliser l'entreprise — une assurance personne clé permettrait de compenser financièrement cette perte le temps de s'ajuster.",
    non: "Sans dépendance critique à une personne en particulier, l'entreprise est mieux protégée contre ce risque spécifique.",
  },
  biz_assurance_corpo: {
    oui: "Une assurance vie corporative en place peut servir à plusieurs fins : protection des associés, financement d'une convention entre actionnaires, ou stratégies de retrait fiscalement avantageuses — il reste pertinent de confirmer qu'elle correspond toujours à tes besoins actuels.",
    non: "Aucune assurance vie corporative n'est en place — un outil qui pourrait pourtant servir à protéger l'entreprise, financer une convention entre actionnaires, ou optimiser des stratégies de retrait futures.",
  },
  biz_dividendes: {
    oui: "Des surplus s'accumulent dans la société — des stratégies fiscales corporatives (comme l'assurance vie ou le compte de dividende en capital) pourraient permettre de les faire fructifier ou d'en optimiser la sortie.",
    non: "Sans surplus accumulés, il y a moins d'enjeux immédiats de structuration fiscale corporative, bien que ça puisse évoluer avec la croissance de l'entreprise.",
  },
  biz_convention: {
    oui: "Une convention entre actionnaires en place aide à clarifier les règles en cas de désaccord, de départ ou de décès d'un actionnaire — encore faut-il vérifier qu'elle est à jour et bien financée (souvent par assurance).",
    non: "Sans convention entre actionnaires, un désaccord, un départ ou un décès pourrait créer une impasse coûteuse — un enjeu à ne pas négliger si plusieurs actionnaires sont impliqués.",
  },
  biz_releve: {
    oui: "Un plan de relève en place aide à assurer la continuité de l'entreprise et à préparer une transition ordonnée, que ce soit vers la famille, des employés ou un acheteur externe.",
    non: "Sans plan de relève, la continuité de l'entreprise pourrait être compromise en cas de départ imprévu — une réflexion à entamer tôt, même si la retraite semble lointaine.",
  },
};
const PENSION_LABELS = [
  "Tu cotises actuellement à un fonds de pension d'employeur — un actif important à intégrer dans le portrait de retraite global.",
  "Tu as déjà eu un fonds de pension d'employeur mais n'en as plus — ces sommes sont souvent transférables dans un compte personnel (comme un CRI) pour les investir selon tes propres choix, ce qui offre plus de flexibilité. Conserver les sommes dans le régime pour obtenir une rente garantie peut toutefois aussi être une bonne option selon ta situation — cela reste à évaluer.",
  "Tu n'as jamais eu de fonds de pension d'employeur — ta retraite dépendra principalement de ton épargne personnelle et des régimes gouvernementaux.",
];
const SUCCESSION_LABELS = { enfants:"Léguer aux enfants", impot:"Minimiser l'impôt au décès", cause:"Donner à une cause" };

function fmtMoney(v){
  return (Math.round(v)).toLocaleString('fr-CA', {style:'currency', currency:'CAD', maximumFractionDigits:0});
}
// Format compact pour les graduations d'axe des graphiques — "10 000$" / "100 000$"
// sous le million, "1.5M" au-dessus (plutôt que fmtMoney(), trop long pour un axe, ou
// le "150k" ambigu utilisé avant).
function fmtAxisMoney(v){
  const n = Math.round(v);
  const abs = Math.abs(n);
  if (abs >= 1000000){
    const m = Math.round((n/1000000)*10)/10;
    return m + 'M';
  }
  return n.toLocaleString('fr-CA').replace(/ /g,' ') + '$';
}

// ======================= GRAPHIQUES (Chart.js -> image) =======================
// Chart.js dessine sur fond transparent par défaut. jsPDF gère mal la transparence
// lors de la compression des images (les zones transparentes deviennent noires dans
// le PDF) — ce plugin peint un fond blanc opaque derrière le graphique avant capture.
// Dessine une image avec les coins arrondis : on définit un rectangle arrondi comme
// chemin de découpe (clip), on peint l'image dedans, puis on restaure l'état
// graphique pour ne pas affecter le reste du dessin. Utilisé pour toutes les photos
// et tous les graphiques du document plutôt que des coins vifs.
function addRoundedImage(doc, dataUrl, format, x, y, w, h, radius, compression){
  doc.saveGraphicsState();
  doc.roundedRect(x, y, w, h, radius, radius, null);
  doc.clip();
  if (typeof doc.discardPath === 'function') doc.discardPath();
  doc.addImage(dataUrl, format, x, y, w, h, undefined, compression);
  doc.restoreGraphicsState();
}
function makeBackgroundPlugin(color){
  return {
    id: 'solidBackground',
    beforeDraw: (chart) => {
      const { ctx } = chart;
      ctx.save();
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, chart.width, chart.height);
      ctx.restore();
    }
  };
}
// bgColor optionnel (3e paramètre) : couleur de fond du canevas avant capture — blanc
// par défaut, mais paramétrable pour qu'une image (ex. la jauge circulaire) se fonde
// dans une page qui n'est pas blanche (ex. la couverture, fond crème).
function renderChartToImage(config, w, h, bgColor){
  return new Promise(resolve=>{
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.style.position='fixed'; canvas.style.left='-9999px';
    document.body.appendChild(canvas);
    // Texte de légende/graduations et lignes de grille plus foncés par défaut — le gris
    // pâle par défaut de Chart.js manquait de contraste sur les graphiques imprimés.
    global.Chart.defaults.color = '#1B2A4A';
    global.Chart.defaults.borderColor = 'rgba(27,42,74,0.18)';
    const merged = Object.assign({}, config, {
      options: Object.assign({responsive:false, animation:false}, config.options||{}),
      plugins: [...(config.plugins||[]), makeBackgroundPlugin(bgColor||'#ffffff')],
    });
    const chart = new global.Chart(canvas.getContext('2d'), merged);
    // animation:false rend de façon synchrone, mais on laisse un court délai pour être
    // sûr. setTimeout plutôt que requestAnimationFrame : rAF se met en pause quand
    // l'onglet n'est pas au premier plan, ce qui bloquerait la génération du PDF.
    setTimeout(()=>{
      const url = canvas.toDataURL('image/png', 1.0);
      chart.destroy();
      document.body.removeChild(canvas);
      resolve(url);
    }, 30);
  });
}

// Jauge circulaire pour le score (page couverture) — anneau de progression 0-100,
// couleur du palier atteint (bourgogne/or/navy), texte du score ajouté par-dessus
// séparément en jsPDF (l'image ne contient que l'anneau, pas le chiffre).
async function scoreGaugeChartImage(score, tierColorRgb, bgColor){
  const tierHex = '#' + tierColorRgb.map(v=>v.toString(16).padStart(2,'0')).join('');
  return renderChartToImage({
    type:'doughnut',
    data:{ datasets:[{ data:[score, 100-score], backgroundColor:[tierHex, 'rgba(184,147,90,0.22)'], borderWidth:0 }] },
    options:{
      circumference:360, rotation:-90, cutout:'78%',
      plugins:{legend:{display:false}, tooltip:{enabled:false}},
    }
  }, 520, 520, bgColor || '#1B2A4A');
}

// Résolution du canevas alignée sur le ratio largeur/hauteur réel d'affichage dans le
// PDF (voir b.image()/addRoundedImage plus loin) — sans ça, l'image est étirée de façon
// non uniforme pour remplir des dimensions différentes de son ratio d'origine, ce qui
// déforme le texte des graduations (lettres écrasées ou étirées, chiffres qui se
// chevauchent).
async function accountChartImage(account){
  return renderChartToImage({
    type:'line',
    data:{ labels: account.serie.map(p=>p.age), datasets:[{ label:account.label, data:account.serie.map(p=>p.valeur), borderColor:'#4B9AE8', backgroundColor:'rgba(75,154,232,0.30)', borderWidth:3, fill:true, tension:0.25 }] },
    options:{
      plugins:{legend:{display:false}},
      scales:{
        y:{ ticks:{ font:{size:15}, callback:fmtAxisMoney } },
        x:{ title:{display:true, text:'Âge', font:{size:13}}, ticks:{ font:{size:14}, maxTicksLimit:6 } }
      }
    }
  }, 650, 313); // ratio 54/26 mm — largeur/hauteur réelles de chaque case de la grille de comptes
}

async function totalChartImage(total){
  return renderChartToImage({
    type:'line',
    data:{ labels: total.map(p=>p.age), datasets:[{ label:'Patrimoine total projeté', data: total.map(p=>p.valeur), borderColor:'#4B9AE8', backgroundColor:'rgba(75,154,232,0.30)', borderWidth:3, fill:true, tension:0.25 }] },
    options:{
      plugins:{legend:{display:false}},
      scales:{
        y:{ ticks:{ font:{size:17}, callback:fmtAxisMoney } },
        x:{ title:{display:true, text:'Âge', font:{size:15}}, ticks:{ font:{size:16}, maxTicksLimit:9 } }
      }
    }
  }, 1050, 241); // ratio 174/40 mm
}

async function statuQuoChartImage(statuQuo){
  return renderChartToImage({
    type:'line',
    data:{ labels: statuQuo.investableTotalOptimise.map(p=>p.age), datasets:[
      { label:'Plan optimisé', data: statuQuo.investableTotalOptimise.map(p=>p.valeur), borderColor:'#4B9AE8', backgroundColor:'rgba(75,154,232,0.30)', borderWidth:3, fill:true, tension:0.25 },
      { label:'Statu quo', data: statuQuo.investableTotalActuel.map(p=>p.valeur), borderColor:'#8B3A3A', backgroundColor:'rgba(139,58,58,0.20)', borderWidth:2.5, fill:true, tension:0.25, borderDash:[6,4] },
    ]},
    options:{
      plugins:{legend:{display:true, position:'top', labels:{font:{size:15}}}},
      scales:{
        y:{ ticks:{ font:{size:15}, callback:fmtAxisMoney } },
        x:{ title:{display:true, text:'Âge', font:{size:13}}, ticks:{ font:{size:14}, maxTicksLimit:8 } }
      }
    }
  }, 1050, 314); // ratio 174/52 mm
}

// Illustration universelle de l'investissement périodique automatique (IPA / dollar
// cost averaging) — exemple fixe, indépendant des réponses, sur 24 mois : la valeur du
// marché fluctue (parfois on achète plus cher, parfois moins cher) mais progresse à
// long terme, tandis que le coût moyen d'achat cumulatif reste beaucoup plus lisse.
const DCA_EXAMPLE = {
  prices: [10,9.5,8.8,9.6,11,10.5,9.8,11.5,12,11.2,10.5,12.5,13,12.2,11.8,13.5,14,13.2,15,14.5,13.8,16,16.5,17],
  montant: 100,
};
function dcaStats(){
  let cumUnits = 0, cumInvesti = 0;
  const avgCostSeries = [];
  DCA_EXAMPLE.prices.forEach(p => {
    cumUnits += DCA_EXAMPLE.montant / p;
    cumInvesti += DCA_EXAMPLE.montant;
    avgCostSeries.push(cumInvesti / cumUnits);
  });
  const coutMoyenIPA = cumInvesti / cumUnits;
  const prixMoyenSimple = DCA_EXAMPLE.prices.reduce((a,b)=>a+b,0) / DCA_EXAMPLE.prices.length;
  return { avgCostSeries, totalUnits:cumUnits, totalInvesti:cumInvesti, coutMoyenIPA, prixMoyenSimple };
}
// Étiquettes directement sur les 2 lignes (fin de courbe) — la description des points
// d'achat, elle, est ajoutée comme 3e entrée de légende (voir generateLabels ci-dessous).
// Étiquette avec plaque de fond opaque derrière le texte — pour qu'elle reste lisible
// même quand une ligne passe juste derrière (fini le texte à moitié superposé au trait).
function drawLabelChip(ctx, text, x, y, align, textColor, bgColor){
  const padX = 6, padY = 4;
  const w = ctx.measureText(text).width;
  const chipX = align === 'right' ? x - w - padX : x - padX;
  ctx.fillStyle = bgColor;
  ctx.fillRect(chipX, y - 9 - padY, w + padX*2, 18 + padY*2);
  ctx.fillStyle = textColor;
  ctx.fillText(text, x, y);
}
const dcaAnnotationsPlugin = {
  id: 'dcaAnnotations',
  afterDraw: (chart) => {
    const { ctx, scales, chartArea } = chart;
    const x = scales.x, y = scales.y;
    const avgSeries = dcaStats().avgCostSeries;
    const lastIdx = DCA_EXAMPLE.prices.length - 1;
    ctx.save();
    ctx.font = '600 15px Inter, Arial, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';

    // "Valeur du placement" reste ancrée en haut de la zone de tracé (les prix
    // fluctuent trop en fin de parcours pour s'y accrocher sans risque). "Coût moyen
    // d'achat" est ramenée près de sa propre ligne (plus lisse, donc sans danger de
    // croisement) — la plaque de fond blanche absorbe le reste.
    const xPos = x.getPixelForValue(lastIdx) - 8;
    drawLabelChip(ctx, 'Valeur du placement', xPos, chartArea.top + 18, 'right', '#B8935A', '#ffffff');
    drawLabelChip(ctx, "Coût moyen d'achat", xPos, y.getPixelForValue(avgSeries[lastIdx]) + 16, 'right', '#4A78B0', '#ffffff');

    ctx.restore();
  }
};
async function dcaChartImage(){
  const stats = dcaStats();
  return renderChartToImage({
    type:'line',
    data:{ labels: DCA_EXAMPLE.prices.map((_,i)=>`Mois ${i+1}`), datasets:[
      // backgroundColor identique à borderColor sur les deux séries : avec fill:false
      // elle ne sert qu'à la pastille de légende (les points du tracé gardent leur
      // propre couleur via pointBackgroundColor/pointBorderColor) — pastille "Valeur
      // du placement" entièrement or, "Coût moyen d'achat" entièrement bleu pâle, au
      // lieu d'un mélange de couleurs ou d'un aplat délavé. Le bleu pâle (plutôt que
      // le navy d'origine) évite aussi la confusion avec les points navy de l'autre
      // série, trop semblables.
      { label:'Valeur du placement', data: DCA_EXAMPLE.prices, borderColor:'#B8935A', backgroundColor:'#B8935A', pointBackgroundColor:'#1B2A4A', pointBorderColor:'#1B2A4A', pointRadius:4, tension:0.25, fill:false },
      { label:"Coût moyen d'achat", data: stats.avgCostSeries.map(v=>+v.toFixed(2)), borderColor:'#A9C9EE', backgroundColor:'#A9C9EE', borderWidth:3, pointRadius:0, tension:0.25, fill:false },
    ]},
    options:{
      plugins:{legend:{display:true, position:'top', labels:{
        generateLabels: (chart) => {
          const items = global.Chart.defaults.plugins.legend.labels.generateLabels(chart);
          items.push({ text: "Point = moment d'achat", fillStyle:'#1B2A4A', strokeStyle:'#1B2A4A', pointStyle:'circle' });
          return items;
        }
      }}},
      scales:{
        y:{ title:{display:true, text:'Valeur du placement ($)', font:{size:14}}, ticks:{font:{size:14}, callback:fmtAxisMoney} },
        x:{ ticks:{font:{size:13}, maxTicksLimit:8} }
      }
    },
    plugins:[dcaAnnotationsPlugin],
  }, 1050, 290); // ratio 174/48 mm
}

// Illustration de l'intérêt composé : dépôts seuls (ligne droite) vs même somme
// investie à rendement composé (courbe qui s'accélère) — sur 30 ans, 3 000 $/an.
async function compoundInterestChartImage(){
  const years = Array.from({length:31}, (_,i)=>i);
  const annualDeposit = 3000, rate = 0.06;
  let balCompound = 0;
  const deposits = [], compound = [];
  years.forEach(y=>{
    deposits.push(annualDeposit * y);
    if(y>0) balCompound = balCompound*(1+rate) + annualDeposit;
    compound.push(Math.round(balCompound));
  });
  return renderChartToImage({
    type:'line',
    data:{ labels: years, datasets:[
      { label:'Dépôts seulement (aucun rendement)', data: deposits, borderColor:'#8B3A3A', backgroundColor:'rgba(139,58,58,0.06)', borderDash:[6,4], pointRadius:0, tension:0, fill:false },
      { label:'Avec intérêt composé (6 %/an)', data: compound, borderColor:'#4B9AE8', backgroundColor:'rgba(75,154,232,0.30)', borderWidth:3, pointRadius:0, tension:0.25, fill:true },
    ]},
    options:{
      plugins:{legend:{display:true, position:'bottom', labels:{boxWidth:16, font:{size:14}}}},
      scales:{
        y:{ ticks:{ font:{size:15}, callback:fmtAxisMoney } },
        x:{ title:{display:true, text:'Années', font:{size:14}}, ticks:{font:{size:14}, maxTicksLimit:8} }
      }
    }
  }, 1050, 272); // ratio 174/45 mm
}

// Illustration de l'inflation : pouvoir d'achat réel de 10 000 $ laissés non investis
// (érodé par l'inflation) vs la même somme investie à rendement — sur 25 ans.
// Une seule courbe, ascendante : combien faudra-t-il dans le futur pour équivaloir à
// 100 $ d'aujourd'hui — plus intuitif que la perte de pouvoir d'achat d'une somme fixe
// (même idée, mais présentée comme un coût qui augmente plutôt qu'une valeur qui fond).
async function inflationChartImage(){
  const years = Array.from({length:26}, (_,i)=>i);
  const start = 100, inflation = 0.025;
  const cost = years.map(y=> Math.round(start * Math.pow(1+inflation, y)));
  return renderChartToImage({
    type:'line',
    data:{ labels: years, datasets:[
      { label:"Coût futur équivalent à 100 $ aujourd'hui", data: cost, borderColor:'#8B3A3A', backgroundColor:'rgba(139,58,58,0.30)', borderWidth:3, pointRadius:0, tension:0.25, fill:true },
    ]},
    options:{
      plugins:{legend:{display:true, position:'bottom', labels:{boxWidth:16, font:{size:14}}}},
      scales:{
        y:{ ticks:{ font:{size:15}, callback:fmtAxisMoney } },
        x:{ title:{display:true, text:'Années', font:{size:14}}, ticks:{font:{size:14}, maxTicksLimit:8} }
      }
    }
  }, 1050, 272); // ratio 174/45 mm
}

// Illustration de la diversification : répartition-exemple d'un portefeuille entre
// classes d'actifs, plutôt qu'être concentré dans un seul placement.
async function diversificationChartImage(){
  return renderChartToImage({
    type:'doughnut',
    data:{
      labels:['Actions canadiennes','Actions américaines','Actions internationales','Obligations','Autres (immobilier, liquidités)'],
      // Palette pâle (plutôt que les tons foncés d'origine) — ce graphique vit sur la
      // page bleu marine pleine de "Concepts essentiels", il a besoin de couleurs
      // claires pour ressortir. Le contour des tranches reprend le bleu marine de la
      // page plutôt qu'un blanc dur, pour un rendu qui s'y fond.
      datasets:[{ data:[20,30,20,25,5], backgroundColor:['#AAB9D6','#7F94C0','#E9CE90','#D9BA7B','#D59C97'], borderColor:'#0F172A', borderWidth:2 }]
    },
    options:{
      plugins:{ legend:{ display:true, position:'bottom', labels:{boxWidth:40, boxHeight:30, font:{size:30}, padding:24, color:'#EBEEF5'} } }
    }
  }, 900, 900, '#0F172A');
}

// ======================= GÉNÉRATION PDF =======================
const COLORS = { ink:[27,42,74], inkSoft:[74,91,122], body:[0,0,0], gold:[184,147,90], teal:[27,42,74], red:[139,58,58], line:[223,225,231], cream:[246,241,231], goldLight:[240,230,210], redLight:[245,229,224], paleNavy:[228,232,240], cardDark:[15,23,42], pale:[235,238,245], paleSoft:[195,202,218] };

// Couleur de puce selon le palier de la réponse donnée (bourgogne = faible, or =
// moyen, navy = fort) — basé sur les points de l'option choisie par rapport au
// maximum possible pour cette question, pas juste sa position dans la liste.
function answerTierColor(question, index){
  const opts = question.options || [];
  const maxPts = Math.max.apply(null, opts.map(o=>o.pts));
  const pts = opts[index] ? opts[index].pts : 0;
  const frac = maxPts>0 ? pts/maxPts : 1;
  if(frac < 0.4) return COLORS.red;
  if(frac < 0.75) return COLORS.gold;
  return COLORS.ink;
}

// Ratios largeur/hauteur des photos "sur le long" (recadrées en portrait) utilisées en
// colonne à côté du texte — Immobilier et Famille et succession.
const IMMOBILIER_IMAGE_RATIO = 1366/1700;
const FAMILLE_IMAGE_RATIO = 1200/1584;

function PdfBuilder(doc){
  this.doc = doc;
  this.margin = 18;
  this.pageW = doc.internal.pageSize.getWidth();
  this.pageH = doc.internal.pageSize.getHeight();
  this.y = this.margin;
  this.colX = null; // décalage horizontal du texte quand une image occupe une colonne
  this.colW = null; // largeur de texte disponible dans cette colonne
  this.cardTextColor = null; // couleur de texte par défaut à l'intérieur d'une carte (voir card())
}
PdfBuilder.prototype.checkPage = function(needed){
  if(this.y + needed > this.pageH - this.margin){
    this.doc.addPage();
    this.y = this.margin;
  }
};
// Bascule le texte dans une colonne étroite (à côté d'une photo "sur le long") — toutes
// les paragraph() suivantes utilisent ce décalage/largeur jusqu'à endTextColumn().
PdfBuilder.prototype.startTextColumn = function(x, w){ this.colX = x; this.colW = w; };
PdfBuilder.prototype.endTextColumn = function(){ this.colX = null; this.colW = null; };
PdfBuilder.prototype.sectionTitle = function(text){
  const bandH = 15;
  // Espace de sécurité avant le bandeau : garantit qu'il ne mord jamais sur le bas de
  // la section précédente, peu importe ce qui vient d'être dessiné juste avant (texte,
  // image, ou carte avec son propre remplissage) — voir card() qui inclut déjà son
  // padding bas dans this.y. checkPage() réserve cet espace en plus du bandeau, donc si
  // ça ne rentre pas, tout bascule proprement à la page suivante plutôt que de chevaucher.
  const gapBefore = 4;
  this.checkPage(gapBefore + bandH + 10);
  // Bandeau plein bleu marine avec titre blanc — sépare chaque section comme un
  // en-tête de site web/app plutôt qu'un simple filet, tout en gardant le même
  // repère visuel (barre or) que le reste du document.
  const bandTop = this.y + gapBefore;
  this.doc.setFillColor.apply(this.doc, COLORS.ink);
  this.doc.roundedRect(this.margin, bandTop, this.pageW - this.margin*2, bandH, 4, 4, 'F');
  // Filet or en contour plutôt qu'une ligne droite sous le bandeau — colle aux coins
  // arrondis au lieu de déborder dessus.
  this.doc.setDrawColor.apply(this.doc, COLORS.gold);
  this.doc.setLineWidth(0.6);
  this.doc.roundedRect(this.margin, bandTop, this.pageW - this.margin*2, bandH, 4, 4, 'S');
  this.doc.setLineWidth(0.2);
  this.doc.setFont('times','bold'); this.doc.setFontSize(14.5);
  this.doc.setTextColor(255,255,255);
  this.doc.text(text, this.margin+5, bandTop + bandH/2 + 3);
  this.y = bandTop + bandH + 10;
};
// Titre utilisé à l'intérieur d'une carte (voir card() ci-dessous) — reprend le
// traitement éditorial d'origine (serif + courte barre or) plutôt qu'un bandeau
// plein, pour éviter un effet de boîte dans la boîte.
PdfBuilder.prototype.cardTitle = function(text){
  this.checkPage(18);
  const x = this.colX!=null ? this.colX : this.margin;
  this.doc.setFont('times','bold'); this.doc.setFontSize(16);
  this.doc.setTextColor.apply(this.doc, this.cardTextColor || COLORS.ink);
  this.doc.text(text, x, this.y);
  this.y += 4;
  this.doc.setDrawColor.apply(this.doc, COLORS.gold);
  this.doc.setLineWidth(1.1);
  this.doc.line(x, this.y, x+24, this.y);
  this.doc.setLineWidth(0.2);
  this.y += 8;
};
// Encapsule tout le contenu dessiné par contentFn(b) dans une carte à fond teinté et
// coins arrondis — la section ENTIÈRE devient une carte, pas seulement son titre.
// jsPDF ne permet pas de dessiner un rectangle « derrière » du contenu déjà tracé,
// donc ça se fait en 2 passes : une passe de mesure (tous les appels du doc sont
// interceptés et enregistrés au lieu d'être exécutés) pour connaître la hauteur
// exacte à couvrir — y compris à travers un saut de page — puis on pose le(s)
// fond(s) sur la ou les pages concernées, et on rejoue les appels enregistrés
// par-dessus. Le contenu de contentFn doit dessiner via `b` (ou `b.doc`), jamais
// via une variable `doc` capturée à l'extérieur — sinon ces appels contournent
// l'enregistrement et se dessinent directement, avant le fond.
PdfBuilder.prototype.card = async function(contentFn, opts){
  opts = opts || {};
  const bg = opts.bg || COLORS.cream;
  const pad = opts.pad != null ? opts.pad : 6;
  const radius = opts.radius != null ? opts.radius : 6;
  const fullPage = !!opts.fullPage; // fond plein page (bord à bord) plutôt qu'une carte avec marge
  const realDoc = this.doc;
  const startPage = realDoc.internal.getNumberOfPages();
  const x = (this.colX!=null ? this.colX : this.margin) - pad;
  const w = (this.colW!=null ? this.colW : (this.pageW - this.margin*2)) + pad*2;

  const STATE_SETTERS = new Set(['setFont','setFontSize','setTextColor','setFillColor','setDrawColor','setLineWidth']);
  const MEASURE_FNS = new Set(['splitTextToSize','getTextWidth']);
  const segments = [{ startY: this.y - pad }];
  const calls = [];

  const proxyDoc = new Proxy({}, {
    get: (_, prop) => {
      if (MEASURE_FNS.has(prop)) return realDoc[prop].bind(realDoc);
      if (prop === 'internal') return realDoc.internal;
      if (typeof realDoc[prop] === 'function') {
        return (...args) => {
          if (prop === 'addPage') {
            segments[segments.length-1].endY = this.y;
            segments.push({ startY: this.margin - pad });
            return proxyDoc;
          }
          // Les changeurs d'état (police, couleurs) sont appliqués tout de suite sur
          // le vrai doc en plus d'être enregistrés — sinon splitTextToSize mesurerait
          // le texte avec une police périmée pendant la passe de mesure.
          if (STATE_SETTERS.has(prop)) realDoc[prop](...args);
          calls.push({ seg: segments.length-1, method: prop, args });
          return proxyDoc;
        };
      }
      return realDoc[prop];
    }
  });

  this.doc = proxyDoc;
  const prevCardTextColor = this.cardTextColor;
  if (opts.textColor) this.cardTextColor = opts.textColor;
  try {
    await contentFn(this);
  } finally {
    this.doc = realDoc;
    this.cardTextColor = prevCardTextColor;
  }
  segments[segments.length-1].endY = this.y;

  // Pose le(s) fond(s) d'abord — une carte (ou une page pleine) par page couverte
  // par la section.
  const pagesUsed = [];
  for (let s = 0; s < segments.length; s++) {
    if (s === 0) realDoc.setPage(startPage);
    else realDoc.addPage();
    pagesUsed.push(startPage + s);
    realDoc.setFillColor.apply(realDoc, bg);
    if (fullPage) {
      realDoc.rect(0, 0, this.pageW, this.pageH, 'F');
    } else {
      const top = segments[s].startY;
      const bottom = (s === segments.length-1) ? segments[s].endY + pad : (this.pageH - this.margin);
      realDoc.roundedRect(x, top, w, bottom - top, radius, radius, 'F');
    }
  }
  if (opts.pagesOut) opts.pagesOut.push(...pagesUsed);

  // Rejoue les appels de dessin enregistrés, par-dessus les fonds, page par page.
  realDoc.setPage(startPage);
  let seg = 0;
  for (const call of calls) {
    while (call.seg > seg) { seg++; realDoc.setPage(startPage + seg); }
    realDoc[call.method].apply(realDoc, call.args);
  }
  // Inclut le padding bas (celui réellement peint sous le contenu, voir `bottom` plus
  // haut) dans this.y — sinon l'appelant suivant (souvent sectionTitle()) repart d'un y
  // situé DANS le fond de la carte plutôt qu'en dessous, et finit par chevaucher son bas.
  this.y = segments[segments.length-1].endY + pad;
};
// Point avec puce colorée — pour présenter le contenu en « point form » plutôt qu'en
// paragraphes continus. dotColor par défaut = or (accent neutre) ; passer une couleur
// de palier (voir answerTierColor) pour les réponses évaluées du diagnostic.
PdfBuilder.prototype.bulletPoint = function(text, opts){
  opts = opts || {};
  const dotColor = opts.dotColor || COLORS.gold;
  const x = this.colX!=null ? this.colX : this.margin;
  const w = this.colW!=null ? this.colW : (this.pageW - this.margin*2);
  const indent = 5.5;
  const textX = x + indent, textW = w - indent;
  this.doc.setFont('helvetica', opts.bold?'bold':'normal');
  this.doc.setFontSize(opts.size||10.5);
  const lines = this.doc.splitTextToSize(text, textW);
  this.checkPage(lines.length * 5 + 6);
  this.doc.setFillColor.apply(this.doc, dotColor);
  this.doc.circle(x + 1.1, this.y - 1.5, 1.15, 'F');
  this.doc.setTextColor.apply(this.doc, opts.color||this.cardTextColor||COLORS.body);
  this.doc.text(lines, textX, this.y, { maxWidth: textW, align: 'justify' });
  this.y += lines.length * 5 + (opts.gap!==undefined?opts.gap:4);
};
PdfBuilder.prototype.paragraph = function(text, opts){
  opts = opts || {};
  this.doc.setFont('helvetica', opts.bold?'bold':'normal');
  this.doc.setFontSize(opts.size||10.5);
  this.doc.setTextColor.apply(this.doc, opts.color||this.cardTextColor||COLORS.body);
  const x = this.colX!=null ? this.colX : this.margin;
  const w = this.colW!=null ? this.colW : (this.pageW - this.margin*2);
  const lines = this.doc.splitTextToSize(text, w);
  this.checkPage(lines.length * 5 + 2);
  // Justifié (bord droit aligné, comme le reste du texte) plutôt qu'en drapeau —
  // jsPDF ne justifie que les lignes qui se poursuivent, la dernière ligne d'un
  // paragraphe reste alignée à gauche comme il se doit typographiquement.
  this.doc.text(lines, x, this.y, { maxWidth: w, align: 'justify' });
  this.y += lines.length * 5 + (opts.gap!==undefined?opts.gap:4);
};
// Hauteur qu'occuperait paragraph(text, opts) sans le dessiner — sert à réserver
// l'espace d'un bloc entier (titre + texte + image) avant de le tracer, pour que
// checkPage() envoie tout le bloc à la page suivante plutôt que de le couper en deux.
PdfBuilder.prototype.paragraphHeight = function(text, opts){
  opts = opts || {};
  this.doc.setFont('helvetica', opts.bold?'bold':'normal');
  this.doc.setFontSize(opts.size||10.5);
  const w = this.colW!=null ? this.colW : (this.pageW - this.margin*2);
  const lines = this.doc.splitTextToSize(text, w);
  return lines.length * 5 + (opts.gap!==undefined?opts.gap:4);
};
// Équivalent de paragraphHeight() pour bulletPoint() — tient compte du retrait de la
// puce dans le calcul de largeur, pour une réservation d'espace fidèle.
PdfBuilder.prototype.bulletPointHeight = function(text, opts){
  opts = opts || {};
  this.doc.setFont('helvetica', opts.bold?'bold':'normal');
  this.doc.setFontSize(opts.size||10.5);
  const w = this.colW!=null ? this.colW : (this.pageW - this.margin*2);
  const lines = this.doc.splitTextToSize(text, w - 5.5);
  return lines.length * 5 + (opts.gap!==undefined?opts.gap:4);
};
PdfBuilder.prototype.image = function(dataUrl, wMM, hMM){
  this.checkPage(hMM + 6);
  const x = this.colX!=null ? this.colX : this.margin;
  // compression 'MEDIUM' est essentiel : par défaut jsPDF stocke les PNG en bitmap RGBA
  // brut (non compressé), ce qui peut gonfler le PDF à plusieurs dizaines de Mo.
  addRoundedImage(this.doc, dataUrl, 'PNG', x, this.y, wMM, hMM, 3, 'MEDIUM');
  this.y += hMM + 8;
};
// Bandeau photo pleine largeur (traitement éditorial) — utilisé en tête de certaines
// sections (Immobilier, Famille et succession) pour ancrer le propos dans une image,
// à la manière d'un magazine. Légende optionnelle en italique sous la photo.
PdfBuilder.prototype.photoBanner = function(dataUrl, opts){
  opts = opts || {};
  const w = this.pageW - this.margin*2;
  const h = opts.height || 62;
  const format = opts.format || 'JPEG';
  this.checkPage(h + (opts.caption ? 16 : 10));
  addRoundedImage(this.doc, dataUrl, format, this.margin, this.y, w, h, 3, 'MEDIUM');
  this.y += h + 4;
  if (opts.caption) {
    this.doc.setFont('times','italic'); this.doc.setFontSize(8.5);
    this.doc.setTextColor.apply(this.doc, COLORS.inkSoft);
    this.doc.text(opts.caption, this.margin, this.y);
    this.y += 5;
  }
  this.y += 4;
};
// Encadré "chiffre choc" — fond teinté, barre d'accent à gauche, texte en gras. Pour les
// statistiques qui méritent de sauter aux yeux plutôt que de se fondre dans le texte.
PdfBuilder.prototype.statCard = function(text, opts){
  opts = opts || {};
  const bg = opts.bg || COLORS.goldLight;
  const accent = opts.accent || COLORS.gold;
  const textColor = opts.textColor || COLORS.ink;
  const fontSize = opts.fontSize || 12.5;
  const padX = 10, padY = 9;
  this.doc.setFont('helvetica','bold'); this.doc.setFontSize(fontSize);
  const maxW = this.pageW - this.margin*2 - padX*2 - 4;
  const lines = this.doc.splitTextToSize(text, maxW);
  const boxH = lines.length*6.2 + padY*2;
  this.checkPage(boxH + 8);
  this.doc.setFillColor.apply(this.doc, bg);
  this.doc.roundedRect(this.margin, this.y, this.pageW-this.margin*2, boxH, 3, 3, 'F');
  this.doc.setFillColor.apply(this.doc, accent);
  this.doc.roundedRect(this.margin, this.y, 3.5, boxH, 1.5, 1.5, 'F');
  this.doc.setTextColor.apply(this.doc, textColor);
  this.doc.text(lines, this.margin+padX+4, this.y+padY+4);
  this.y += boxH + 10;
};

// Bandeau navy en en-tête de chaque page + pied de page (numérotation, attribution) —
// appliqué en une passe à la toute fin, une fois le nombre total de pages connu. La
// page couverture reçoit le bandeau du haut (pour l'harmonie) mais pas le pied de page
// (elle a déjà sa propre attribution en bas).
function addHeaderFooter(doc, clientName, darkPages){
  darkPages = darkPages || [];
  const totalPages = doc.internal.getNumberOfPages();
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  for(let i=2; i<=totalPages; i++){ // la couverture a son propre habillage, on ne la touche pas
    doc.setPage(i);
    // Sur une page pleine bleu marine (section "Concepts essentiels"), le masthead et
    // le pied de page basculent en teintes pâles/or pour rester lisibles.
    const isDark = darkPages.includes(i);
    const textColor = isDark ? COLORS.pale : COLORS.inkSoft;
    const footerLineColor = isDark ? COLORS.gold : COLORS.line;
    // masthead fin : filet or + petites capitales, plus éditorial qu'un bloc de couleur plein
    doc.setDrawColor.apply(doc, COLORS.gold); doc.setLineWidth(0.6);
    doc.line(18, 12, pageW-18, 12);
    doc.setFont('helvetica','bold'); doc.setFontSize(7.5); doc.setTextColor.apply(doc, textColor);
    doc.text('SCORE DE SANTÉ FINANCIÈRE', 18, 9);
    if(clientName){
      doc.setFont('helvetica','normal');
      doc.text(clientName.toUpperCase(), pageW-18, 9, {align:'right'});
    }
    doc.setDrawColor.apply(doc, footerLineColor); doc.setLineWidth(0.3);
    doc.line(18, pageH-14, pageW-18, pageH-14);
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor.apply(doc, textColor);
    doc.text(`${i-1} / ${totalPages-1}`, pageW-18, pageH-9, {align:'right'});
    doc.text('SAMUEL RUSSO', 18, pageH-9);
  }
}

async function genererPDF(answers){
  const { jsPDF } = global.jspdf;
  const doc = new jsPDF({ unit:'mm', format:'a4' });
  const b = new PdfBuilder(doc);

  // Police manuscrite pour la signature de Samuel en toute fin de document — chargée
  // une fois ici (VFS jsPDF), utilisée plus bas via doc.setFont('AlexBrush','normal').
  let hasSignatureFont = false;
  if (global.SIGNATURE_FONT_B64) {
    try {
      doc.addFileToVFS('AlexBrush-Regular.ttf', global.SIGNATURE_FONT_B64);
      doc.addFont('AlexBrush-Regular.ttf', 'AlexBrush', 'normal');
      hasSignatureFont = true;
    } catch(e){ console.warn('Police de signature non chargée:', e); }
  }

  const total = scoreTotal(answers);
  const tierInfo = scoreTier(total);
  const pillars = pillarScores(answers);
  const segment = computeSegment(answers);
  const proj = buildProjections(answers);

  // ---- Page 1 : couverture — fond clair, typographie serif encre, traitement
  // "magazine éditorial" (cf. gabarit de référence) plutôt que le fond navy plein
  // d'origine. Or en filets/accents, photo de la porte ouverte comme image d'accueil.
  doc.setFillColor(255,255,255); doc.rect(0,0,b.pageW,b.pageH,'F');

  doc.setDrawColor.apply(doc, COLORS.gold); doc.setLineWidth(0.5);
  doc.line(16,16,b.pageW-16,16);
  doc.line(16,b.pageH-16,b.pageW-16,b.pageH-16);
  doc.setLineWidth(0.3);
  doc.circle(b.pageW-6, 6, 26, 'S'); // accent géométrique discret, coin supérieur droit

  doc.setFont('times','normal'); doc.setFontSize(30); doc.setTextColor.apply(doc, COLORS.ink);
  doc.text('Score de santé', b.pageW/2, 54, {align:'center'});
  doc.text('financière', b.pageW/2, 66, {align:'center'});

  doc.setFont('helvetica','normal'); doc.setFontSize(11); doc.setTextColor.apply(doc, COLORS.inkSoft);
  doc.text(answers.lead_name || '', b.pageW/2, 80, {align:'center'});
  doc.setFontSize(9.5);
  doc.text(new Date().toLocaleDateString('fr-CA', {year:'numeric', month:'long', day:'numeric'}), b.pageW/2, 86, {align:'center'});

  // Jauge circulaire du score, avec le chiffre et le palier superposés au centre.
  const gaugeSize = 58, gaugeX = (b.pageW-gaugeSize)/2, gaugeY = 98;
  try {
    const gaugeImg = await scoreGaugeChartImage(total, tierInfo.color, '#FFFFFF');
    addRoundedImage(doc, gaugeImg, 'PNG', gaugeX, gaugeY, gaugeSize, gaugeSize, 4, 'MEDIUM');
  } catch(e){ console.warn('Jauge non générée:', e); }
  const gaugeCenterX = gaugeX + gaugeSize/2, gaugeCenterY = gaugeY + gaugeSize/2;
  doc.setFont('helvetica','bold'); doc.setFontSize(27); doc.setTextColor.apply(doc, COLORS.ink);
  doc.text(String(total), gaugeCenterX, gaugeCenterY+2, {align:'center'});
  doc.setFont('helvetica','bold'); doc.setFontSize(7.5); doc.setTextColor.apply(doc, tierInfo.color);
  const tierLines = doc.splitTextToSize(tierInfo.tier.toUpperCase(), 34);
  doc.text(tierLines, gaugeCenterX, gaugeCenterY+8, {align:'center'});

  doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor.apply(doc, COLORS.inkSoft);
  doc.text('PRÉPARÉ PAR SAMUEL RUSSO', b.pageW/2, gaugeY+gaugeSize+10, {align:'center'});
  doc.setFont('helvetica','normal'); doc.setFontSize(8);
  doc.text('Conseiller en sécurité financière', b.pageW/2, gaugeY+gaugeSize+15, {align:'center'});

  // Photo d'accueil : une porte ouverte, symbole de bienvenue dans la démarche —
  // encadrée d'un filet or fin, centrée. La citation (écho direct de la photo) est
  // placée juste en dessous, dans l'espace réservé avant le bas de page.
  const noteBottom = gaugeY + gaugeSize + 15;
  let imgBottom = noteBottom;
  if (global.COVER_DOOR_IMAGE) {
    try {
      const imgTop = noteBottom + 12;
      const doorRatio = 497/800; // largeur/hauteur de la photo recadrée
      const quoteBlockH = 26; // espace réservé pour la citation sous la photo
      const imgH = (b.pageH - 16 - 4 - quoteBlockH) - imgTop;
      const imgW = imgH * doorRatio;
      const imgX = (b.pageW - imgW)/2;
      doc.setDrawColor.apply(doc, COLORS.gold); doc.setLineWidth(0.4);
      doc.roundedRect(imgX-1.2, imgTop-1.2, imgW+2.4, imgH+2.4, 4, 4, 'S');
      addRoundedImage(doc, global.COVER_DOOR_IMAGE, 'JPEG', imgX, imgTop, imgW, imgH, 3, 'MEDIUM');
      imgBottom = imgTop + imgH;
    } catch(e){ console.warn('Image de couverture non générée:', e); }
  }

  // Citation — parallèle entre la porte qui s'ouvre (photo ci-dessus) et l'accueil dans
  // la démarche financière du client.
  doc.setDrawColor.apply(doc, COLORS.gold); doc.setLineWidth(0.7);
  doc.line(b.pageW/2-9, imgBottom+8, b.pageW/2+9, imgBottom+8);
  doc.setFont('times','italic'); doc.setFontSize(11.5); doc.setTextColor.apply(doc, COLORS.ink);
  const quoteLines = doc.splitTextToSize(
    "Une porte qui s'ouvre est une invitation. Ce plan en est une aussi — bienvenue dans ton parcours financier.",
    142
  );
  doc.text(quoteLines, b.pageW/2, imgBottom+15, {align:'center'});

  // ---- Page 2 : Diagnostic par pilier ----
  // Chaque question notée affiche l'explication propre à la réponse donnée (pas un
  // texte générique par pilier) — s5 a sa note générale sur la bonne/mauvaise dette.
  doc.addPage(); b.y = b.margin;
  b.sectionTitle('Diagnostic par pilier');
  for(const p of PILLARS){
    b.paragraph(p, {bold:true, color:COLORS.ink, gap:1});
    const questions = SCORE_QUESTIONS.filter(q=>q.pillar===p);
    for(const q of questions){
      const i = answers[q.id];
      if(i===undefined) continue;
      const exp = q.explications && q.explications[i];
      // Puce colorée selon le palier de la réponse (bourgogne/or/navy) — donne un
      // repère visuel immédiat sur la force de chaque réponse, en un coup d'œil.
      if(exp) b.bulletPoint(exp, {gap:3, dotColor: answerTierColor(q, i)});
      if(q.noteGenerale) b.bulletPoint(q.noteGenerale, {gap:3, dotColor: COLORS.gold});
    }
  }
  if(answers.fonds_pension!==undefined && PENSION_LABELS[answers.fonds_pension]){
    b.bulletPoint(PENSION_LABELS[answers.fonds_pension], {dotColor: COLORS.gold});
  }

  // ---- Objectifs ---- section entière en carte (fond teinté, coins arrondis).
  const goals = answers.goals || [];
  if(goals.length){
    b.checkPage(60);
    await b.card(async (b) => {
      b.cardTitle('Objectifs de placement');
      goals.forEach(g=>{
        const h = (answers.horizons||{})[g];
        b.bulletPoint(`${goalLabel(g, answers)}${h?` — horizon d'environ ${h} ans`:''}`, {bold:true, color:COLORS.gold, gap:1, dotColor:COLORS.gold});
        const exp = GOALS_EXPLANATIONS[g];
        if(exp){
          b.startTextColumn(b.margin+5.5, b.pageW-b.margin*2-5.5);
          b.paragraph(exp, {gap:3});
          b.endTextColumn();
        }
      });
    }, {bg: COLORS.cardDark, textColor: COLORS.pale});
    b.y += 4;
  }

  // ---- Immobilier ---- photo "sur le long" à gauche, texte en colonne à droite.
  // checkPage (plutôt qu'un addPage systématique) réserve juste l'espace nécessaire à
  // la section (titre + photo) — elle continue sur la page en cours s'il reste assez
  // de place, pour éviter les demi-pages blanches entre les sections.
  if(answers.residence==='oui' || answers.immo_secondaire==='oui'){
    b.checkPage(120);
    b.sectionTitle('Immobilier');
    const immoColTop = b.y;
    let immoImgBottom = immoColTop;
    if (global.IMMOBILIER_IMAGE) {
      try {
        const imgW = 74, imgH = imgW / IMMOBILIER_IMAGE_RATIO, imgX = b.margin;
        doc.setDrawColor.apply(doc, COLORS.gold); doc.setLineWidth(0.4);
        doc.roundedRect(imgX-1, immoColTop-1, imgW+2, imgH+2, 4, 4, 'S');
        addRoundedImage(doc, global.IMMOBILIER_IMAGE, 'JPEG', imgX, immoColTop, imgW, imgH, 3, 'MEDIUM');
        immoImgBottom = immoColTop + imgH;
        b.startTextColumn(imgX + imgW + 9, b.pageW - b.margin - (imgX + imgW + 9));
      } catch(e){ console.warn('Image immobilier non générée:', e); }
    }
    if(answers.residence==='oui'){
      b.paragraph('Résidence principale', {bold:true, color:COLORS.ink, gap:2});
      b.bulletPoint(RESIDENCE_EXPLANATION_OUI, {gap:3, dotColor:COLORS.gold});
    }
    if(answers.immo_secondaire==='oui'){
      b.paragraph('Immobilier secondaire', {bold:true, color:COLORS.ink, gap:2});
      b.bulletPoint(IMMO_SECONDAIRE_EXPLANATION_OUI, {gap:3, dotColor:COLORS.gold});
    }
    b.endTextColumn();
    b.y = Math.max(b.y, immoImgBottom + 10);
  }

  // ---- Projection ---- graphiques réduits, réunis sur une seule page en grille
  // compacte (plutôt qu'un grand graphique par compte étalé sur plusieurs pages).
  if(proj.accounts.length || proj.immobilier.length){
    b.checkPage(100);
    await b.card(async (b) => {
      b.cardTitle('Projection de croissance');
      b.bulletPoint(`Projection basée sur les montants réels déclarés. Les comptes de placement sont projetés jusqu'à 65 ans (taux pondéré selon le profil investisseur, ${(proj.rate*100).toFixed(2)} % / an), un horizon plus réaliste que 100 ans pour une accumulation continue. L'immobilier, généralement conservé plus longtemps, est projeté jusqu'à 100 ans à 4,2 % / an.`, {dotColor:COLORS.gold});
      try {
        const imgTotal = await totalChartImage(proj.total);
        b.paragraph('Patrimoine total projeté', {bold:true, color:COLORS.gold, gap:2, size:10});
        b.image(imgTotal, b.pageW-b.margin*2, 40);
      } catch(e){ console.warn('Graphique patrimoine total non généré:', e); }

      if(proj.accounts.length){
        // Toutes les images sont générées d'abord (async), puis posées en grille de
        // façon synchrone pour contrôler précisément les rangées/colonnes. Dessine
        // via b.doc (pas la variable `doc` externe) pour que card() puisse
        // enregistrer ces appels durant sa passe de mesure.
        const accImages = await Promise.all(proj.accounts.map(acc =>
          accountChartImage(acc).catch(e=>{ console.warn(`Graphique ${acc.label} non généré:`, e); return null; })
        ));
        const cols = 3, gap = 6;
        const cellW = (b.pageW - b.margin*2 - gap*(cols-1)) / cols;
        const chartH = 26, rowH = chartH + 17;
        let hasCeliapp = false;
        for(let i=0; i<proj.accounts.length; i++){
          const acc = proj.accounts[i];
          const col = i % cols;
          if(col===0) b.checkPage(rowH);
          const rowTop = b.y;
          const x = b.margin + col*(cellW+gap);
          b.doc.setFont('helvetica','bold'); b.doc.setFontSize(8); b.doc.setTextColor.apply(b.doc, COLORS.pale);
          const labelLines = b.doc.splitTextToSize(acc.label + (acc.code==='CELIAPP' ? ' *' : ''), cellW).slice(0,1);
          b.doc.text(labelLines, x, rowTop+3);
          b.doc.setFont('helvetica','normal'); b.doc.setFontSize(7);
          b.doc.setTextColor.apply(b.doc, COLORS.paleSoft);
          b.doc.text(fmtMoney(acc.solde), x, rowTop+7);
          if(acc.code==='CELIAPP') hasCeliapp = true;
          if(accImages[i]) addRoundedImage(b.doc, accImages[i], 'PNG', x, rowTop+9, cellW, chartH, 2, 'MEDIUM');
          if(col===cols-1 || i===proj.accounts.length-1) b.y = rowTop + rowH;
        }
        if(hasCeliapp){
          b.paragraph("* Le CELIAPP doit être fermé au plus tard 15 ans après son ouverture — les sommes sont généralement transférées au REER sans impact fiscal si l'achat d'une propriété n'a pas eu lieu.", {size:8, gap:2, color:COLORS.paleSoft});
        }
      }
    }, {bg: COLORS.cardDark, textColor: COLORS.pale});
  }

  // ---- Statu quo vs Plan optimisé ----
  if(proj.statuQuo){
    const sq = proj.statuQuo;
    b.checkPage(95);
    b.sectionTitle('Statu quo vs plan optimisé');
    if(sq.aligned){
      b.bulletPoint(`Bonne nouvelle : la façon dont ton portefeuille est investi aujourd'hui correspond déjà à ton profil ${PROFILE_LABELS[sq.profilKey]} déclaré. Il n'y a pas d'écart de rendement à corriger ici — le focus peut rester sur les autres priorités identifiées dans ce portrait.`, {dotColor:COLORS.ink});
    } else {
      const serieOpt = sq.investableTotalOptimise, serieAct = sq.investableTotalActuel;
      const lastIdx = serieOpt.length-1;
      const ecart = serieOpt[lastIdx].valeur - serieAct[lastIdx].valeur;
      const ageFinal = serieOpt[lastIdx].age;
      b.bulletPoint(`Ton portefeuille de placements est actuellement investi de façon plus ${PROFILE_LABELS[sq.actuelKey]} que ton profil ${PROFILE_LABELS[sq.profilKey]} déclaré (${(sq.rateActuel*100).toFixed(2)} % / an au lieu de ${(sq.rateOptimise*100).toFixed(2)} % / an). Sur les montants et cotisations déclarés, voici l'écart projeté si rien ne change :`, {dotColor:COLORS.red});
      try {
        const img = await statuQuoChartImage(sq);
        b.image(img, b.pageW-b.margin*2, 52);
      } catch(e){ console.warn('Graphique statu quo vs optimisé non généré:', e); }
      b.statCard(`Réaligner ton portefeuille sur ton profil ${PROFILE_LABELS[sq.profilKey]} pourrait représenter environ ${fmtMoney(ecart)} de plus à ${ageFinal} ans, comparé au statu quo.`);
      b.paragraph("Cette estimation ne tient compte que du portefeuille de placements (hors immobilier) et suppose des rendements constants selon les normes IQPF — elle sert à illustrer l'ordre de grandeur, pas une garantie de rendement.", {size:9, color:COLORS.inkSoft});
    }
  }

  // ---- Protection ----
  // s8 est déjà couvert en détail dans "Diagnostic par pilier" — on ne le répète pas ici.
  const hasProtectionContent = answers.dependants_financiers!==undefined || answers.assurance_vie_actuelle!==undefined;
  if(hasProtectionContent){
    b.checkPage(50);
    b.sectionTitle('Protection');
    if(answers.dependants_financiers!==undefined){
      b.bulletPoint(DEPENDANTS_EXPLANATIONS[answers.dependants_financiers], {gap:3, dotColor:COLORS.gold});
    }
    if(answers.assurance_vie_actuelle!==undefined){
      b.bulletPoint(ASSURANCE_VIE_EXPLANATIONS[answers.assurance_vie_actuelle], {gap:3, dotColor:COLORS.gold});
    }
    if(answers.hypotheque==='oui'){ b.bulletPoint("Une hypothèque est toujours active — la protection vie devrait couvrir ce solde pour éviter d'en transférer le poids aux proches.", {dotColor:COLORS.red}); }
  }

  // ---- Entreprise ----
  if(answers.entreprise==='oui'){
    b.checkPage(90);
    b.sectionTitle('Entreprise');
    ['biz_employe_cle','biz_assurance_corpo','biz_dividendes','biz_convention','biz_releve'].forEach(id=>{
      const ans = answers[id];
      if(ans===undefined) return;
      const exp = BIZ_EXPLANATIONS[id] && BIZ_EXPLANATIONS[id][ans];
      if(exp) b.bulletPoint(exp, {gap:3, dotColor: COLORS.gold});
    });
  }

  // ---- Famille et succession ---- photo "sur le long" à droite, texte à gauche.
  if(answers.enfants==='oui' || answers.succession==='oui'){
    b.checkPage(125);
    b.sectionTitle('Famille et succession');
    const familleColTop = b.y;
    let familleImgBottom = familleColTop;
    if (global.FAMILLE_IMAGE) {
      try {
        const imgW = 74, imgH = imgW / FAMILLE_IMAGE_RATIO, imgX = b.pageW - b.margin - imgW;
        doc.setDrawColor.apply(doc, COLORS.gold); doc.setLineWidth(0.4);
        doc.roundedRect(imgX-1, familleColTop-1, imgW+2, imgH+2, 4, 4, 'S');
        addRoundedImage(doc, global.FAMILLE_IMAGE, 'JPEG', imgX, familleColTop, imgW, imgH, 3, 'MEDIUM');
        familleImgBottom = familleColTop + imgH;
        b.startTextColumn(b.margin, imgX - 9 - b.margin);
      } catch(e){ console.warn('Image famille non générée:', e); }
    }
    if(answers.enfants==='oui'){
      const ages = answers.enfants_ages||[];
      b.paragraph(`Enfant(s) : ${ages.filter(a=>a).map(a=>`${a} ans`).join(', ') || (answers.enfants_nombre||'')}`, {bold:true, color:COLORS.ink, gap:2});
      b.bulletPoint(ENFANTS_EXPLANATION_OUI, {gap:3, dotColor:COLORS.gold});
    }
    if(answers.reei_admissible==='oui'){
      b.bulletPoint(REEI_EXPLANATION_OUI, {gap:3, dotColor:COLORS.gold});
    }
    if(answers.succession==='oui'){
      const prec = answers.succession_precision||[];
      b.paragraph('Objectif de planification successorale — priorités identifiées :', {bold:true, color:COLORS.ink, gap:2});
      prec.forEach(p=> b.bulletPoint(p==='autre' ? (answers.succession_precision_other||'Autre') : (SUCCESSION_LABELS[p]||p), {gap:1, dotColor:COLORS.ink}));
      b.bulletPoint(SUCCESSION_EXPLANATION_OUI, {gap:3, dotColor:COLORS.gold});
    }
    b.endTextColumn();
    b.y = Math.max(b.y, familleImgBottom + 10);
  }

  // ---- Concepts essentiels ---- juste avant la conclusion, comme référence à
  // conserver — l'investissement périodique automatique (avec son graphique),
  // l'intérêt composé, l'inflation et la diversification. Fond bleu plein page
  // (bord à bord, pas juste une carte) sur toutes les pages qu'occupe la section —
  // toujours démarrée sur une page neuve pour ne jamais repeindre le contenu qui
  // précède sur la même page.
  doc.addPage(); b.y = b.margin;
  const conceptsDarkPages = [];
  await b.card(async (b) => {
    b.cardTitle('Concepts essentiels en finance');
    b.bulletPoint("Quelques concepts qui reviennent tout au long de ce portrait — les comprendre aide à mieux interpréter les points qui précèdent.", {dotColor:COLORS.gold});

    // Chaque bloc (titre + texte + graphique) réserve son espace total d'un coup — le
    // titre d'un concept ne doit jamais se retrouver seul en bas d'une page pendant
    // que son graphique atterrit sur la suivante.
    const dcaTitle = "Investissement périodique automatique (dollar cost averaging)";
    const dcaText = "Investir un montant fixe à intervalles réguliers, peu importe les conditions de marché, réduit le risque de mal synchroniser tes achats. Quand les prix baissent, le même montant achète plus de parts; quand ils montent, il en achète moins — ce qui abaisse ton coût moyen d'achat avec le temps, sans avoir à deviner le bon moment d'investir.";
    b.checkPage(b.paragraphHeight(dcaTitle,{bold:true,gap:2}) + b.bulletPointHeight(dcaText,{gap:3}) + 48 + 8 + 35);
    b.paragraph(dcaTitle, {bold:true, color:COLORS.gold, gap:2});
    b.bulletPoint(dcaText, {gap:3, dotColor:COLORS.gold});
    try { const img = await dcaChartImage(); b.image(img, b.pageW-b.margin*2, 48); }
    catch(e){ console.warn('Graphique IPA non généré:', e); }
    const dca = dcaStats();
    b.statCard(`Sur cet exemple, l'investissement périodique automatique donne un coût moyen de ${dca.coutMoyenIPA.toFixed(2)} $/part — sous le prix moyen simple de ${dca.prixMoyenSimple.toFixed(2)} $/part.`, {fontSize:11});

    const compoundTitle = "Intérêt composé";
    const compoundText = "Les rendements générés par un placement génèrent eux-mêmes des rendements année après année — c'est l'effet boule de neige de l'intérêt composé. Plus l'horizon est long, plus cet effet est puissant : commencer tôt, même avec de petits montants, peut faire une différence plus importante que d'investir plus tard des sommes plus élevées.";
    b.checkPage(b.paragraphHeight(compoundTitle,{bold:true,gap:2}) + b.bulletPointHeight(compoundText,{gap:3}) + 45 + 8);
    b.paragraph(compoundTitle, {bold:true, color:COLORS.gold, gap:2});
    b.bulletPoint(compoundText, {gap:3, dotColor:COLORS.gold});
    try { const img = await compoundInterestChartImage(); b.image(img, b.pageW-b.margin*2, 45); }
    catch(e){ console.warn('Graphique intérêt composé non généré:', e); }

    const inflationTitle = "Inflation";
    const inflationText = "L'inflation fait augmenter le coût des choses année après année — ce qui coûte 100 $ aujourd'hui coûtera plus cher dans le futur. Une somme laissée en encaisse ou dans un compte à faible rendement perd donc de la valeur réelle avec le temps. C'est ce qui nous oblige à investir plutôt que seulement épargner : pour préserver (et faire croître) ton pouvoir d'achat, le rendement de tes placements doit surpasser le taux d'inflation.";
    b.checkPage(b.paragraphHeight(inflationTitle,{bold:true,gap:2}) + b.bulletPointHeight(inflationText,{gap:3}) + 45 + 8);
    b.paragraph(inflationTitle, {bold:true, color:COLORS.gold, gap:2});
    b.bulletPoint(inflationText, {gap:3, dotColor:COLORS.red});
    try { const img = await inflationChartImage(); b.image(img, b.pageW-b.margin*2, 45); }
    catch(e){ console.warn('Graphique inflation non généré:', e); }

    const diversifTitle = "Diversification";
    const diversifText = "Répartir ses placements entre différents types d'actifs, secteurs et régions réduit l'impact qu'un seul mauvais placement peut avoir sur l'ensemble du portefeuille. Une bonne diversification vise à réduire le risque global sans nécessairement sacrifier le rendement à long terme.";
    const diversifImgSize = 92;
    b.checkPage(b.paragraphHeight(diversifTitle,{bold:true,gap:2}) + b.bulletPointHeight(diversifText,{gap:3}) + diversifImgSize + 8);
    b.paragraph(diversifTitle, {bold:true, color:COLORS.gold, gap:2});
    b.bulletPoint(diversifText, {gap:3, dotColor:COLORS.gold});
    try {
      const img = await diversificationChartImage();
      const x = (b.pageW - diversifImgSize)/2;
      addRoundedImage(b.doc, img, 'PNG', x, b.y, diversifImgSize, diversifImgSize, 4, 'MEDIUM');
      b.y += diversifImgSize + 8;
    } catch(e){ console.warn('Graphique diversification non généré:', e); }
  }, {bg: COLORS.cardDark, textColor: COLORS.pale, fullPage: true, pagesOut: conceptsDarkPages});

  // ---- Prochaine étape ---- toujours sur une page neuve (même logique que le début de
  // "Concepts essentiels" ci-dessus) : sans ça, si la dernière page bleue de Concepts
  // avait encore de la place, ce texte en couleur normale se dessinerait par-dessus le
  // fond bleu marine restant — illisible et visuellement superposé à la section d'avant.
  doc.addPage(); b.y = b.margin;
  b.checkPage(95);
  b.sectionTitle('La prochaine étape ?');
  b.bulletPoint("Ce portrait donne une vue d'ensemble, mais chaque situation mérite une analyse personnalisée.", {dotColor:COLORS.gold});
  b.bulletPoint("Les revenus de retraite ne sont pas tous couverts dans cette évaluation. Le moment optimal pour déclencher tes rentes gouvernementales (RRQ, PSV) et ton fonds de pension, s'il y a lieu, varie beaucoup d'une personne à l'autre — c'est une décision qui mérite une analyse dédiée.", {dotColor:COLORS.gold});
  b.bulletPoint("Le but de cette démarche est de te donner une idée claire de ta situation actuelle, de mettre en lumière tes angles morts possibles et de dégager des recommandations d'un professionnel de la finance. Tes placements ne peuvent toutefois être analysés en profondeur que dans le cadre d'une analyse complète — les recommandations présentées ici ne sont pas à appliquer automatiquement, mais à évaluer avec un professionnel.", {dotColor:COLORS.gold});
  // Photo + coordonnées — objectif : donner un moyen de le joindre, pas pousser à agir
  // tout de suite (le volet conversion se fait séparément via une séquence CRM
  // courriel/texto automatisée).
  b.checkPage(58);
  const sigTop = b.y;
  let sigImgBottom = sigTop;
  if (global.SAMUEL_PHOTO) {
    try {
      const imgW = 36, imgH = imgW / (655/840), imgX = b.margin;
      doc.setDrawColor.apply(doc, COLORS.gold); doc.setLineWidth(0.4);
      doc.roundedRect(imgX-1, sigTop-1, imgW+2, imgH+2, 3, 3, 'S');
      addRoundedImage(doc, global.SAMUEL_PHOTO, 'JPEG', imgX, sigTop, imgW, imgH, 2.5, 'MEDIUM');
      sigImgBottom = sigTop + imgH;
      b.startTextColumn(imgX + imgW + 8, b.pageW - b.margin - (imgX + imgW + 8));
      // Centre le bloc de texte (nom + titre + coordonnées) sur la hauteur de la photo,
      // plutôt que de l'aligner avec le haut — visuellement mieux balancé à côté du portrait.
      const nameLineH = hasSignatureFont ? 10 : 6;
      const textBlockH = nameLineH
        + b.paragraphHeight('Conseiller en sécurité financière', {gap:2})
        + b.paragraphHeight('samuel.russo@agc.ia.ca', {gap:1})
        + b.paragraphHeight('450-712-1430', {gap:1});
      b.y = sigTop + Math.max(0, (imgH - textBlockH) / 2);
    } catch(e){ console.warn('Photo de signature non générée:', e); }
  }
  // Nom en signature manuscrite (police chargée en tête de genererPDF) plutôt qu'en
  // texte gras standard — repli sur le style habituel si la police n'a pas pu charger.
  {
    const sx = b.colX!=null ? b.colX : b.margin;
    doc.setFont(hasSignatureFont ? 'AlexBrush' : 'helvetica', hasSignatureFont ? 'normal' : 'bold');
    doc.setFontSize(hasSignatureFont ? 30 : 12);
    doc.setTextColor.apply(doc, COLORS.ink);
    doc.text('Samuel Russo', sx, b.y + (hasSignatureFont ? 4 : 0));
    b.y += hasSignatureFont ? 10 : 6;
  }
  b.paragraph('Conseiller en sécurité financière', {gap:2});
  b.paragraph('samuel.russo@agc.ia.ca', {gap:1});
  b.paragraph('450-712-1430', {gap:1});
  b.endTextColumn();
  b.y = Math.max(b.y, sigImgBottom + 6);

  addHeaderFooter(doc, answers.lead_name, conceptsDarkPages);
  return doc;
}

global.PDFEngine = {
  SCORE_QUESTIONS, PILLARS, ACCUMULATION_ACCOUNTS, DECAISSEMENT_ACCOUNTS, ACCOUNT_LABELS,
  IMMO_SECONDAIRE_TRANCHES,
  IQPF, PROFILE_MIX, PROFILE_KEYS, PROFILE_LABELS, profileKeyFromIndex, SEGMENT_LABELS,
  scoreTotal, pillarScores, scoreTier, computeSegment, weightedRate,
  buildProjections, decadeAges, futureValue,
  genererPDF, fmtMoney, dcaChartImage, dcaStats,
};

})(typeof window !== 'undefined' ? window : this);
