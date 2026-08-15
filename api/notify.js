// POST /api/notify
// Appelé par le quiz public à la fin du parcours. Envoie à Samuel un courriel
// de notification avec un lien de révision contenant les réponses (encodées
// dans l'URL, aucune base de données).
const { PDFEngine } = require('../pdf-engine.js');
const { sendMail } = require('../lib/mailer.js');

function baseUrl(req){
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${req.headers.host}`;
}

function validEmail(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || ''); }

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send('Method not allowed'); return; }

  const answers = req.body;
  if (!answers || typeof answers !== 'object') { res.status(400).send('Corps de requête invalide'); return; }
  if (!validEmail(answers.lead_email) || !(answers.lead_name || '').trim()) {
    res.status(400).send('Nom et courriel du client requis'); return;
  }

  const notifyTo = process.env.NOTIFY_EMAIL_TO;
  if (!notifyTo) { res.status(500).send('Configuration serveur incomplète (NOTIFY_EMAIL_TO)'); return; }

  const json = JSON.stringify(answers);
  const encoded = Buffer.from(json, 'utf-8').toString('base64url');
  const link = `${baseUrl(req)}/revision.html?d=${encoded}`;

  const total = PDFEngine.scoreTotal(answers);
  const tier = PDFEngine.scoreTier(total);
  const segment = PDFEngine.computeSegment(answers);

  const html = `
    <p>Nouveau résultat de quiz reçu.</p>
    <p><b>${answers.lead_name}</b> — ${answers.lead_email}${answers.lead_phone ? ' — ' + answers.lead_phone : ''}</p>
    <p>Score : <b>${total}/100</b> (${tier.tier}) — Segment : <b>${PDFEngine.SEGMENT_LABELS[segment]}</b></p>
    <p><a href="${link}">Ouvrir la page de révision pour générer et approuver le PDF</a></p>
  `;

  try {
    await sendMail({ to: notifyTo, subject: `Nouveau résultat — ${answers.lead_name} (${total}/100)`, html });
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).send(`Erreur d'envoi: ${e.message}`);
  }
};
