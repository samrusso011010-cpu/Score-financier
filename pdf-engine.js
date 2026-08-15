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
const SCORE_QUESTIONS = [
  { id:'s1', pillar:"Fonds d'urgence", title:"Combien de mois de dépenses ton fonds d'urgence couvre-t-il actuellement?",
    options:[{label:"Aucun fonds d'urgence",pts:0},{label:"Moins d'un mois",pts:2},{label:"1 à 3 mois",pts:5},{label:"3 à 6 mois",pts:8},{label:"Plus de 6 mois",pts:10}]},
  { id:'s2', pillar:"Fonds d'urgence", title:"Si une dépense imprévue de 2 000 $ survenait demain, comment réagirais-tu?",
    options:[{label:"Je devrais emprunter ou payer par carte de crédit",pts:0},{label:"Je devrais puiser dans mes REER ou placements",pts:4},{label:"J'ai les fonds, mais ça me stresserait",pts:7},{label:"Aucun impact, les fonds sont disponibles",pts:10}]},
  { id:'s3', pillar:"Épargne", title:"Quel pourcentage de ton revenu net épargnes-tu ou investis-tu chaque mois?",
    options:[{label:"0 %",pts:0},{label:"1 à 5 %",pts:3},{label:"6 à 10 %",pts:6},{label:"11 à 20 %",pts:8},{label:"Plus de 20 %",pts:10}]},
  { id:'s4', pillar:"Épargne", title:"Ton épargne se fait-elle automatiquement, ou seulement s'il te reste de l'argent en fin de mois?",
    options:[{label:"Seulement s'il reste de l'argent",pts:0},{label:"Occasionnellement, sans automatisation",pts:3},{label:"Automatique, mais irrégulière",pts:6},{label:"Automatique et régulière",pts:10}]},
  { id:'s5', pillar:"Endettement", title:"As-tu de la dette à taux d'intérêt élevé (carte de crédit, marge)?",
    options:[{label:"Oui, des soldes élevés non remboursés",pts:0},{label:"Oui, mais je rembourse graduellement",pts:4},{label:"Un solde minime, remboursé chaque mois",pts:8},{label:"Aucune dette à taux élevé",pts:10}]},
  { id:'s6', pillar:"Endettement", title:"En excluant l'hypothèque, quelle part de ton revenu annuel net va au remboursement de dettes?",
    options:[{label:"Plus de 40 %",pts:0},{label:"20 à 40 %",pts:4},{label:"10 à 20 %",pts:7},{label:"Moins de 10 %, ou aucune dette",pts:10}]},
  { id:'s7', pillar:"Protection", title:"As-tu une assurance vie qui protégerait adéquatement tes proches ou tes dettes?",
    options:[{label:"Aucune assurance vie",pts:0},{label:"Assurance collective (travail) seulement",pts:4},{label:"Assurance personnelle, mais non révisée depuis longtemps",pts:7},{label:"Assurance personnelle adéquate et à jour",pts:10}]},
  { id:'s8', pillar:"Protection", title:"As-tu une assurance invalidité qui protégerait ton revenu en cas d'incapacité de travailler?",
    options:[{label:"Aucune",pts:0},{label:"Assurance collective seulement",pts:4},{label:"Protection personnelle partielle",pts:7},{label:"Protection personnelle adéquate",pts:10}]},
  { id:'s9', pillar:"Retraite", title:"Cotises-tu régulièrement à un REER, un CELI ou un CELIAPP?",
    options:[{label:"Jamais",pts:0},{label:"Rarement, de façon ponctuelle",pts:3},{label:"Oui, mais sans plan précis",pts:6},{label:"Oui, de façon planifiée et régulière",pts:10}]},
  { id:'s10', pillar:"Retraite", title:"As-tu une idée claire du montant dont tu auras besoin à la retraite, et si tu es sur la bonne voie?",
    options:[{label:"Aucune idée",pts:0},{label:"Une vague estimation",pts:4},{label:"Une idée, mais pas de plan formel",pts:7},{label:"Oui, j'ai un plan clair",pts:10}]},
];

const PILLARS = ["Fonds d'urgence","Épargne","Endettement","Protection","Retraite"];

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
function scoreTotal(answers){
  let total = 0;
  SCORE_QUESTIONS.forEach(q=>{
    const i = answers[q.id];
    if(i!==undefined) total += q.options[i].pts;
  });
  return total;
}

function pillarScores(answers){
  const out = {};
  PILLARS.forEach(p=>{ out[p] = {score:0, max:0}; });
  SCORE_QUESTIONS.forEach(q=>{
    out[q.pillar].max += 10;
    const i = answers[q.id];
    if(i!==undefined) out[q.pillar].score += q.options[i].pts;
  });
  return out;
}

function scoreTier(total){
  if(total<40) return {tier:'Vulnérable', color:[180,67,46]};
  if(total<60) return {tier:'En construction', color:[185,134,47]};
  if(total<80) return {tier:'Solide', color:[185,134,47]};
  return {tier:'Excellente santé financière', color:[31,111,92]};
}

function computeSegment(answers){
  let level = 0; // 0 faible, 1 moyenne, 2 haute
  const e = answers.epargne;
  if(e===undefined) return 'moyenne';
  if(e<=1) level=0; else if(e<=4) level=1; else level=2;
  const survie = answers.survie;
  if(survie!==undefined && survie>=4) level = Math.min(2, level+1);
  if(answers.entreprise==='oui' || answers.immo_secondaire==='oui') level = Math.min(2, level+1);
  return ['faible','moyenne','haute'][level];
}

const SEGMENT_LABELS = {
  faible: 'Bâtir les bases (< 50 000 $)',
  moyenne: 'Valeur nette moyenne (50 000 $ – 1 M$)',
  haute: 'Haute valeur nette (1 M$+)'
};

// ======================= PROJECTIONS =======================
function decadeAges(age){
  const ages = [];
  let a = age;
  while(a < 100){ ages.push(a); a += 10; }
  ages.push(100);
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

function accountSeries(balance, contributionAnnual, rate, age){
  const ages = decadeAges(age);
  return ages.map(a => ({ age:a, valeur: futureValue(balance, contributionAnnual, rate, a-age) }));
}

function buildProjections(answers){
  const age = answers.age;
  const profilKey = answers.profil!==undefined ? profileKeyFromIndex(answers.profil) : undefined;
  const rate = weightedRate(profilKey);
  const selected = answers.accounts_selected || [];
  const details = answers.accounts_details || {};
  const accounts = [];

  selected.forEach(code=>{
    const d = details[code] || {};
    const solde = parseFloat(d.solde)||0;
    const isAccum = ACCUMULATION_ACCOUNTS.includes(code);
    let contribAnnual = 0;
    if(isAccum && d.cotisation){
      const c = parseFloat(d.cotisation)||0;
      contribAnnual = d.freq==='mensuelle' ? c*12 : c;
    }
    accounts.push({
      code, label: ACCOUNT_LABELS[code], isAccum,
      solde, contribAnnual,
      serie: accountSeries(solde, contribAnnual, rate, age)
    });
  });

  const immobilier = [];
  if(answers.residence==='oui' && answers.residence_valeur){
    immobilier.push({ label:'Résidence principale', valeur: parseFloat(answers.residence_valeur)||0,
      serie: accountSeries(parseFloat(answers.residence_valeur)||0, 0, IQPF.immobilier, age) });
  }
  if(answers.immo_secondaire==='oui' && answers.immo_secondaire_valeur){
    immobilier.push({ label:'Immobilier secondaire', valeur: parseFloat(answers.immo_secondaire_valeur)||0,
      serie: accountSeries(parseFloat(answers.immo_secondaire_valeur)||0, 0, IQPF.immobilier, age) });
  }

  const ages = decadeAges(age);
  const total = ages.map((a,i)=>{
    let sum = 0;
    accounts.forEach(acc=> sum += acc.serie[i].valeur);
    immobilier.forEach(im=> sum += im.serie[i].valeur);
    return { age:a, valeur: sum };
  });
  // Portefeuille de placements seulement (hors immobilier) — c'est la portion
  // réellement affectée par un choix d'allocation, donc la seule pertinente
  // pour la comparaison statu quo / plan optimisé.
  const investableTotal = ages.map((a,i)=>{
    let sum = 0;
    accounts.forEach(acc=> sum += acc.serie[i].valeur);
    return { age:a, valeur: sum };
  });

  // Comparatif statu quo (allocation actuelle déclarée) vs plan optimisé (profil déclaré)
  let statuQuo = null;
  const actuelIdx = answers.allocation_actuelle;
  if(accounts.length && actuelIdx!==undefined){
    const actuelKey = profileKeyFromIndex(actuelIdx);
    if(actuelKey!=='inconnu' && profilKey && profilKey!=='inconnu'){
      const rateActuel = weightedRate(actuelKey);
      const investableTotalActuel = ages.map((a,i)=>{
        let sum = 0;
        accounts.forEach(acc=> sum += futureValue(acc.solde, acc.contribAnnual, rateActuel, a-age));
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

  return { age, rate, accounts, immobilier, total, investableTotal, ages, statuQuo };
}

// ======================= NARRATIF =======================
const PILLAR_ADVICE = {
  "Fonds d'urgence": {
    faible: "Priorité 1 : bâtir un coussin de 3 à 6 mois de dépenses avant tout autre objectif de placement.",
    moyen: "Un fonds d'urgence est en place mais mérite d'être consolidé pour absorber un imprévu sans puiser dans les placements.",
    fort: "Le coussin de sécurité est solide — il protège bien le reste du plan financier."
  },
  "Épargne": {
    faible: "Priorité : automatiser un pourcentage fixe de chaque paie vers l'épargne, même modeste au départ.",
    moyen: "Le rythme d'épargne est correct — l'automatiser davantage réduirait le risque d'y déroger.",
    fort: "Le taux et la régularité de l'épargne sont parmi les meilleurs leviers de croissance à long terme."
  },
  "Endettement": {
    faible: "Priorité : réduire la dette à taux élevé avant d'accélérer l'épargne — c'est le rendement garanti le plus élevé disponible.",
    moyen: "La dette est gérable mais surveille la part du revenu qui y est consacrée.",
    fort: "Le niveau d'endettement est bien maîtrisé."
  },
  "Protection": {
    faible: "Priorité : une perte de revenu ou un décès prématuré fragiliserait significativement le plan — une révision de la protection s'impose.",
    moyen: "La protection couvre une partie des besoins mais un ajustement pourrait combler des angles morts.",
    fort: "La protection actuelle est bien alignée avec la situation."
  },
  "Retraite": {
    faible: "Priorité : clarifier l'objectif de retraite et démarrer des cotisations régulières et planifiées.",
    moyen: "Des cotisations sont en cours mais un plan précis manque pour confirmer la trajectoire.",
    fort: "La trajectoire de retraite est claire et bien engagée."
  }
};
function pillarLevel(score, max){ const pct = score/max; return pct<0.4?'faible':(pct<0.75?'moyen':'fort'); }

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

const VIE_LABELS = { dettes:"Couvrir les dettes (hypothèque, prêts)", niveau_vie:"Maintenir le niveau de vie des proches", heritage:"Laisser un héritage", continuite:"Assurer la continuité de l'entreprise", aucun:"Aucun objectif clair identifié" };
const INVAL_LABELS = { revenu:"Maintenir le revenu/train de vie", cotisations:"Continuer de cotiser au plan financier", depenses:"Couvrir les dépenses fixes/dettes", aucun:"Aucune priorité claire identifiée" };
const MALADIE_LABELS = { soins:"Fonds pour soins non couverts", proteger_plan:"Protéger le plan financier", enfants:"Protéger les enfants", aucun:"Aucune priorité claire identifiée" };
const SUCCESSION_LABELS = { enfants:"Léguer aux enfants", impot:"Minimiser l'impôt au décès", cause:"Donner à une cause" };

function fmtMoney(v){
  return (Math.round(v)).toLocaleString('fr-CA', {style:'currency', currency:'CAD', maximumFractionDigits:0});
}

// ======================= GRAPHIQUES (Chart.js -> image) =======================
function renderChartToImage(config, w, h){
  return new Promise(resolve=>{
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.style.position='fixed'; canvas.style.left='-9999px';
    document.body.appendChild(canvas);
    const merged = Object.assign({}, config, { options: Object.assign({responsive:false, animation:false}, config.options||{}) });
    const chart = new global.Chart(canvas.getContext('2d'), merged);
    // animation:false rend de façon synchrone, mais on laisse un tick pour être sûr
    requestAnimationFrame(()=>{
      const url = canvas.toDataURL('image/png', 1.0);
      chart.destroy();
      document.body.removeChild(canvas);
      resolve(url);
    });
  });
}

async function pillarChartImage(pillars){
  const labels = PILLARS;
  const data = labels.map(p=> pillars[p].score);
  return renderChartToImage({
    type:'bar',
    data:{ labels, datasets:[{ label:'Score / 20', data, backgroundColor:'#B9862F' }] },
    options:{ plugins:{legend:{display:false}}, scales:{ y:{ beginAtZero:true, max:20 } } }
  }, 900, 380);
}

async function accountChartImage(account){
  return renderChartToImage({
    type:'line',
    data:{ labels: account.serie.map(p=>p.age), datasets:[{ label:account.label, data:account.serie.map(p=>p.valeur), borderColor:'#1F6F5C', backgroundColor:'rgba(31,111,92,0.15)', fill:true, tension:0.25 }] },
    options:{ plugins:{legend:{display:false}}, scales:{ y:{ ticks:{ callback:v=> (v/1000)+'k' } } } }
  }, 900, 380);
}

async function totalChartImage(total){
  return renderChartToImage({
    type:'line',
    data:{ labels: total.map(p=>p.age), datasets:[{ label:'Patrimoine total projeté', data: total.map(p=>p.valeur), borderColor:'#122A2E', backgroundColor:'rgba(18,42,46,0.10)', fill:true, tension:0.25 }] },
    options:{ plugins:{legend:{display:false}}, scales:{ y:{ ticks:{ callback:v=> (v/1000)+'k' } } } }
  }, 900, 420);
}

async function statuQuoChartImage(statuQuo){
  return renderChartToImage({
    type:'line',
    data:{ labels: statuQuo.investableTotalOptimise.map(p=>p.age), datasets:[
      { label:'Plan optimisé', data: statuQuo.investableTotalOptimise.map(p=>p.valeur), borderColor:'#1F6F5C', backgroundColor:'rgba(31,111,92,0.12)', fill:true, tension:0.25 },
      { label:'Statu quo', data: statuQuo.investableTotalActuel.map(p=>p.valeur), borderColor:'#B4432E', backgroundColor:'rgba(180,67,46,0.08)', fill:true, tension:0.25, borderDash:[6,4] },
    ]},
    options:{ plugins:{legend:{display:true, position:'top'}}, scales:{ y:{ ticks:{ callback:v=> (v/1000)+'k' } } } }
  }, 900, 440);
}

// ======================= GÉNÉRATION PDF =======================
const COLORS = { ink:[18,42,46], inkSoft:[62,84,89], gold:[185,134,47], teal:[31,111,92], red:[180,67,46], line:[220,224,222] };

function PdfBuilder(doc){
  this.doc = doc;
  this.margin = 18;
  this.pageW = doc.internal.pageSize.getWidth();
  this.pageH = doc.internal.pageSize.getHeight();
  this.y = this.margin;
}
PdfBuilder.prototype.checkPage = function(needed){
  if(this.y + needed > this.pageH - this.margin){
    this.doc.addPage();
    this.y = this.margin;
  }
};
PdfBuilder.prototype.sectionTitle = function(text){
  this.checkPage(16);
  this.doc.setFont('helvetica','bold'); this.doc.setFontSize(15);
  this.doc.setTextColor.apply(this.doc, COLORS.ink);
  this.doc.text(text, this.margin, this.y);
  this.y += 3;
  this.doc.setDrawColor.apply(this.doc, COLORS.line);
  this.doc.line(this.margin, this.y, this.pageW-this.margin, this.y);
  this.y += 8;
};
PdfBuilder.prototype.paragraph = function(text, opts){
  opts = opts || {};
  this.doc.setFont('helvetica', opts.bold?'bold':'normal');
  this.doc.setFontSize(opts.size||10.5);
  this.doc.setTextColor.apply(this.doc, opts.color||COLORS.inkSoft);
  const lines = this.doc.splitTextToSize(text, this.pageW - this.margin*2);
  this.checkPage(lines.length * 5 + 2);
  this.doc.text(lines, this.margin, this.y);
  this.y += lines.length * 5 + (opts.gap!==undefined?opts.gap:4);
};
PdfBuilder.prototype.image = function(dataUrl, wMM, hMM){
  this.checkPage(hMM + 6);
  // compression 'MEDIUM' est essentiel : par défaut jsPDF stocke les PNG en bitmap RGBA
  // brut (non compressé), ce qui peut gonfler le PDF à plusieurs dizaines de Mo.
  this.doc.addImage(dataUrl, 'PNG', this.margin, this.y, wMM, hMM, undefined, 'MEDIUM');
  this.y += hMM + 8;
};

async function genererPDF(answers){
  const { jsPDF } = global.jspdf;
  const doc = new jsPDF({ unit:'mm', format:'a4' });
  const b = new PdfBuilder(doc);

  const total = scoreTotal(answers);
  const tierInfo = scoreTier(total);
  const pillars = pillarScores(answers);
  const segment = computeSegment(answers);
  const proj = buildProjections(answers);

  // ---- Page 1 : couverture ----
  doc.setFillColor(238,242,240); doc.rect(0,0,b.pageW,b.pageH,'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor.apply(doc, COLORS.gold);
  doc.text('ÉVALUATION GRATUITE', b.margin, 40);
  doc.setFontSize(26); doc.setTextColor.apply(doc, COLORS.ink);
  doc.text('Score de santé financière', b.margin, 52);
  doc.setFont('helvetica','normal'); doc.setFontSize(11); doc.setTextColor.apply(doc, COLORS.inkSoft);
  doc.text(answers.lead_name || '', b.margin, 62);
  doc.text(new Date().toLocaleDateString('fr-CA', {year:'numeric', month:'long', day:'numeric'}), b.margin, 68);

  doc.setFont('helvetica','bold'); doc.setFontSize(60); doc.setTextColor.apply(doc, COLORS.ink);
  doc.text(String(total), b.margin, 130);
  doc.setFontSize(14); doc.setTextColor.apply(doc, tierInfo.color);
  doc.text(tierInfo.tier.toUpperCase(), b.margin, 140);
  doc.setFont('helvetica','normal'); doc.setFontSize(11); doc.setTextColor.apply(doc, COLORS.inkSoft);
  doc.text(`Segment : ${SEGMENT_LABELS[segment]}`, b.margin, 150);

  doc.setFontSize(9); doc.setTextColor.apply(doc, COLORS.inkSoft);
  doc.text('Préparé par Samuel Russo, conseiller en sécurité financière et planificateur financier', b.margin, b.pageH-20);

  // ---- Page 2 : sommaire ----
  doc.addPage(); b.y = b.margin;
  b.sectionTitle('Sommaire');
  b.paragraph(SEGMENT_FOCUS[segment]);
  try {
    const img = await pillarChartImage(pillars);
    b.image(img, b.pageW-b.margin*2, 70);
  } catch(e) { console.warn('Graphique piliers non généré:', e); }

  // ---- Diagnostic par pilier ----
  b.sectionTitle('Diagnostic par pilier');
  PILLARS.forEach(p=>{
    const { score, max } = pillars[p];
    const level = pillarLevel(score, max);
    b.paragraph(`${p} — ${score}/${max}`, {bold:true, color:COLORS.ink, gap:1});
    b.paragraph(PILLAR_ADVICE[p][level]);
  });

  // ---- Objectifs ----
  const goals = answers.goals || [];
  if(goals.length){
    b.sectionTitle('Objectifs de placement');
    goals.forEach(g=>{
      const h = (answers.horizons||{})[g];
      b.paragraph(`• ${goalLabel(g, answers)}${h?` — horizon d'environ ${h} ans`:''}`, {gap:2});
    });
    b.y += 4;
  }

  // ---- Projection ----
  if(proj.accounts.length || proj.immobilier.length){
    doc.addPage(); b.y = b.margin;
    b.sectionTitle('Projection de croissance');
    b.paragraph(`Projection jusqu'à 100 ans, basée sur les montants réels déclarés et un taux de rendement pondéré selon le profil investisseur (${(proj.rate*100).toFixed(2)} % / an). L'immobilier est projeté à 4,2 % / an.`);
    try {
      const imgTotal = await totalChartImage(proj.total);
      b.image(imgTotal, b.pageW-b.margin*2, 75);
    } catch(e){ console.warn('Graphique patrimoine total non généré:', e); }
    for(const acc of proj.accounts){
      b.checkPage(90);
      b.paragraph(`${acc.label} — solde actuel ${fmtMoney(acc.solde)}${acc.contribAnnual?`, cotisation annuelle ${fmtMoney(acc.contribAnnual)}`:''}`, {bold:true, color:COLORS.ink, gap:2});
      try { const img = await accountChartImage(acc); b.image(img, b.pageW-b.margin*2, 65); } catch(e){ console.warn(`Graphique ${acc.label} non généré:`, e); }
    }
  }

  // ---- Statu quo vs Plan optimisé ----
  if(proj.statuQuo){
    const sq = proj.statuQuo;
    doc.addPage(); b.y = b.margin;
    b.sectionTitle('Statu quo vs plan optimisé');
    if(sq.aligned){
      b.paragraph(`Bonne nouvelle : la façon dont ton portefeuille est investi aujourd'hui correspond déjà à ton profil ${PROFILE_LABELS[sq.profilKey]} déclaré. Il n'y a pas d'écart de rendement à corriger ici — le focus peut rester sur les autres priorités identifiées dans ce portrait.`);
    } else {
      const serieOpt = sq.investableTotalOptimise, serieAct = sq.investableTotalActuel;
      const lastIdx = serieOpt.length-1;
      const ecart = serieOpt[lastIdx].valeur - serieAct[lastIdx].valeur;
      const ageFinal = serieOpt[lastIdx].age;
      b.paragraph(`Ton portefeuille de placements est actuellement investi de façon plus ${PROFILE_LABELS[sq.actuelKey]} que ton profil ${PROFILE_LABELS[sq.profilKey]} déclaré (${(sq.rateActuel*100).toFixed(2)} % / an au lieu de ${(sq.rateOptimise*100).toFixed(2)} % / an). Sur les montants et cotisations déclarés, voici l'écart projeté si rien ne change :`);
      try {
        const img = await statuQuoChartImage(sq);
        b.image(img, b.pageW-b.margin*2, 78);
      } catch(e){ console.warn('Graphique statu quo vs optimisé non généré:', e); }
      b.checkPage(20);
      doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.setTextColor.apply(doc, COLORS.teal);
      const ecartLines = doc.splitTextToSize(`Réaligner ton portefeuille sur ton profil ${PROFILE_LABELS[sq.profilKey]} pourrait représenter environ ${fmtMoney(ecart)} $ de plus à ${ageFinal} ans, comparé au statu quo.`, b.pageW - b.margin*2);
      doc.text(ecartLines, b.margin, b.y);
      b.y += ecartLines.length*6 + 6;
      b.paragraph("Cette estimation ne tient compte que du portefeuille de placements (hors immobilier) et suppose des rendements constants selon les normes IQPF — elle sert à illustrer l'ordre de grandeur, pas une garantie de rendement.", {size:9});
    }
  }

  // ---- Protection ----
  const vieRaisons = answers.vie_raisons||[], invalRaisons = answers.invalidite_raisons||[], maladieRaisons = answers.maladie_raisons||[];
  if(vieRaisons.length || invalRaisons.length || maladieRaisons.length){
    doc.addPage(); b.y = b.margin;
    b.sectionTitle('Protection');
    if(vieRaisons.length){ b.paragraph('Assurance vie — importante pour :', {bold:true, color:COLORS.ink, gap:2}); vieRaisons.forEach(v=> b.paragraph(`• ${VIE_LABELS[v]||v}`, {gap:1})); b.y+=3; }
    if(invalRaisons.length){ b.paragraph('Assurance invalidité — importante pour :', {bold:true, color:COLORS.ink, gap:2}); invalRaisons.forEach(v=> b.paragraph(`• ${INVAL_LABELS[v]||v}`, {gap:1})); b.y+=3; }
    if(maladieRaisons.length){ b.paragraph('Assurance maladie grave — importante pour :', {bold:true, color:COLORS.ink, gap:2}); maladieRaisons.forEach(v=> b.paragraph(`• ${MALADIE_LABELS[v]||v}`, {gap:1})); b.y+=3; }
    if(answers.hypotheque==='oui'){ b.paragraph("Une hypothèque est toujours active — la protection vie devrait couvrir ce solde pour éviter d'en transférer le poids aux proches."); }
  }

  // ---- Entreprise ----
  if(answers.entreprise==='oui'){
    doc.addPage(); b.y = b.margin;
    b.sectionTitle('Entreprise');
    const items = [];
    if(answers.biz_employe_cle==='oui') items.push("Présence d'employés/associés clés — une protection employé clé mérite d'être évaluée.");
    if(answers.biz_assurance_corpo==='non') items.push("Aucune assurance vie corporative en place actuellement.");
    if(answers.biz_dividendes==='oui') items.push("Des surplus/dividendes s'accumulent dans la société — des stratégies fiscales corporatives pourraient être pertinentes.");
    if(answers.biz_convention==='non') items.push("Aucune convention entre actionnaires — un enjeu à ne pas négliger si plusieurs actionnaires sont impliqués.");
    if(answers.biz_releve==='non') items.push("Aucun plan de relève prévu pour l'entreprise à ce jour.");
    if(!items.length) items.push('La structure actuelle semble bien couverte — une révision en rendez-vous permettra de confirmer.');
    items.forEach(t=> b.paragraph(`• ${t}`, {gap:2}));
  }

  // ---- Famille et succession ----
  if(answers.enfants==='oui' || answers.succession==='oui'){
    doc.addPage(); b.y = b.margin;
    b.sectionTitle('Famille et succession');
    if(answers.enfants==='oui'){
      const ages = answers.enfants_ages||[];
      b.paragraph(`Enfant(s) : ${ages.filter(a=>a).map(a=>`${a} ans`).join(', ') || (answers.enfants_nombre||'')}`, {gap:3});
    }
    if(answers.reei_admissible==='oui'){
      b.paragraph("Admissibilité au crédit d'impôt pour personne handicapée identifiée — le REEI pourrait être un levier important (subventions gouvernementales).", {gap:3});
    }
    if(answers.succession==='oui'){
      const prec = answers.succession_precision||[];
      b.paragraph('Objectif de planification successorale — priorités identifiées :', {bold:true, color:COLORS.ink, gap:2});
      prec.forEach(p=> b.paragraph(`• ${SUCCESSION_LABELS[p]||p}`, {gap:1}));
    }
  }

  // ---- Angles morts ----
  doc.addPage(); b.y = b.margin;
  b.sectionTitle("Ce qui reste à couvrir en rendez-vous");
  b.paragraph("Cette évaluation ne couvre pas encore les revenus gouvernementaux à la retraite (RRQ, PSV, régimes d'employeur) ni un budget mensuel détaillé. Ces éléments seront abordés lors d'une rencontre pour affiner les recommandations.");

  // ---- Prochaine étape ----
  b.sectionTitle('Prochaine étape');
  b.paragraph("Ce portrait donne une base solide, mais chaque situation mérite une analyse personnalisée. Réservons un moment pour en discuter et bâtir un plan concret.");
  b.paragraph('Samuel Russo — Conseiller en sécurité financière et planificateur financier', {bold:true, color:COLORS.ink, gap:1});

  return doc;
}

global.PDFEngine = {
  SCORE_QUESTIONS, PILLARS, ACCUMULATION_ACCOUNTS, DECAISSEMENT_ACCOUNTS, ACCOUNT_LABELS,
  IQPF, PROFILE_MIX, PROFILE_KEYS, PROFILE_LABELS, profileKeyFromIndex, SEGMENT_LABELS,
  scoreTotal, pillarScores, scoreTier, computeSegment, weightedRate,
  buildProjections, decadeAges, futureValue,
  genererPDF, fmtMoney,
};

})(typeof window !== 'undefined' ? window : this);
