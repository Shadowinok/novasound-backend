const nodemailer = require('nodemailer');

function getTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error('SMTP is not configured (SMTP_HOST/SMTP_USER/SMTP_PASS)');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });
}

exports.sendEmail = async ({ to, subject, html, text }) => {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const transport = getTransport();
  await transport.sendMail({ from, to, subject, html, text });
};

exports.verifyEmailTransport = async () => {
  const transport = getTransport();
  await transport.verify();
  return true;
};

