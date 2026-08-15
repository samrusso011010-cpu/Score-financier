// Envoi de courriel via Gmail SMTP (compte personnel, aucun domaine requis).
// Variables d'environnement attendues :
//   GMAIL_USER           adresse Gmail complète (ex. samrusso011010@gmail.com)
//   GMAIL_APP_PASSWORD   mot de passe d'application à 16 caractères (pas le mot de passe du compte)
//
// À migrer plus tard vers un envoi par domaine propre (Resend ou autre) quand
// le site web de Samuel sera prêt — voir sendMail() ci-dessous, c'est le seul
// endroit à modifier.
const nodemailer = require('nodemailer');

let cachedTransporter = null;
function getTransporter(){
  if (cachedTransporter) return cachedTransporter;
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error('Configuration manquante : GMAIL_USER / GMAIL_APP_PASSWORD');
  cachedTransporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
  return cachedTransporter;
}

// options: { to, subject, html, attachments? }
async function sendMail(options){
  const transporter = getTransporter();
  const from = process.env.GMAIL_USER;
  return transporter.sendMail({
    from: `Samuel Russo <${from}>`,
    to: options.to,
    subject: options.subject,
    html: options.html,
    attachments: options.attachments,
  });
}

module.exports = { sendMail };
