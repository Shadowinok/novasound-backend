const nodemailer = require('nodemailer');

function getTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error('SMTP is not configured (SMTP_HOST/SMTP_USER/SMTP_PASS)');
  }

  // Короткие таймауты: долгий «зависший» SMTP ломает регистрацию и Postman Cloud (~30s)
  const connectionTimeout = Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 20000);
  const greetingTimeout = Number(process.env.SMTP_GREETING_TIMEOUT_MS || 20000);
  const socketTimeout = Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 20000);

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    connectionTimeout,
    greetingTimeout,
    socketTimeout,
    tls: { servername: host }
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

