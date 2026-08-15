// POST /api/send
// Appelé depuis revision.html, seulement par Samuel après approbation. Envoie
// le PDF final (généré et potentiellement corrigé dans le navigateur) au
// client, en pièce jointe, via Gmail.
//
// Protégé par un jeton statique (ADMIN_TOKEN) pour éviter que cette route ne
// serve de relais courriel ouvert : sans le jeton, personne d'autre que
// Samuel ne peut déclencher un envoi, même s'il devine l'URL de revision.html.
const { sendMail } = require('../lib/mailer.js');

const MAX_PDF_BYTES = 8 * 1024 * 1024; // 8 Mo — marge confortable sous les limites de délivrabilité usuelles

function validEmail(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || ''); }

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send('Method not allowed'); return; }

  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || req.headers['x-admin-token'] !== adminToken) {
    res.status(401).send('Non autorisé'); return;
  }

  const { to, name, pdfBase64, filename } = req.body || {};
  if (!validEmail(to)) { res.status(400).send('Courriel du client invalide'); return; }
  if (!pdfBase64 || typeof pdfBase64 !== 'string') { res.status(400).send('PDF manquant'); return; }

  const approxBytes = Math.floor(pdfBase64.length * 0.75);
  if (approxBytes > MAX_PDF_BYTES) {
    res.status(413).send(`PDF trop volumineux (${(approxBytes/1024/1024).toFixed(1)} Mo, max ${MAX_PDF_BYTES/1024/1024} Mo)`);
    return;
  }

  const safeFilename = (filename || 'score-sante-financiere.pdf').replace(/[^a-zA-Z0-9._-]/g, '-');
  const displayName = (name || '').trim();

  const html = `
    <p>Bonjour${displayName ? ' ' + displayName : ''},</p>
    <p>Merci d'avoir complété l'évaluation de ta santé financière. Tu trouveras ton portrait personnalisé en pièce jointe.</p>
    <p>Je te propose qu'on en discute ensemble — n'hésite pas à répondre à ce courriel pour fixer un moment.</p>
    <p>Samuel Russo<br>Conseiller en sécurité financière et planificateur financier</p>
  `;

  try {
    await sendMail({
      to,
      subject: 'Ton score de santé financière',
      html,
      attachments: [{ filename: safeFilename, content: Buffer.from(pdfBase64, 'base64') }],
    });
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).send(`Erreur d'envoi: ${e.message}`);
  }
};
