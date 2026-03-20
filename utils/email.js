const nodemailer = require('nodemailer');

function getSmtpTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error('SMTP is not configured (SMTP_HOST/SMTP_USER/SMTP_PASS)');
  }

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

/**
 * Отправка через Resend (HTTPS) — рекомендуется для Render и других облаков, где SMTP часто режется.
 * Документация: https://resend.com/docs
 */
function getResendApiKey() {
  const k = process.env.RESEND_API_KEY;
  return typeof k === 'string' ? k.trim() : '';
}

async function sendViaResend({ to, subject, html, text }) {
  const apiKey = getResendApiKey();
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not set');
  }

  const from = process.env.RESEND_FROM || process.env.SMTP_FROM;
  if (!from) {
    throw new Error('RESEND_FROM is not set (или укажите SMTP_FROM для поля From)');
  }

  const recipients = Array.isArray(to) ? to : [to].filter(Boolean);
  if (!recipients.length) {
    throw new Error('Resend: no recipients');
  }

  const payload = {
    from,
    to: recipients,
    subject: subject || '(no subject)'
  };
  if (html) payload.html = html;
  if (text) payload.text = text;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const raw = await res.text();
  if (!res.ok) {
    let detail = raw;
    try {
      const j = JSON.parse(raw);
      detail = j.message || j.error || JSON.stringify(j);
    } catch (_) {}
    throw new Error(`Resend error ${res.status}: ${detail}`);
  }
  return true;
}

exports.sendEmail = async ({ to, subject, html, text }) => {
  if (getResendApiKey()) {
    return sendViaResend({ to, subject, html, text });
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const transport = getSmtpTransport();
  await transport.sendMail({ from, to, subject, html, text });
};

/**
 * Проверка канала отправки: для Resend — пропуск (реальная проверка = успешный send);
 * для SMTP — nodemailer.verify().
 */
exports.verifyEmailTransport = async () => {
  if (getResendApiKey()) {
    return true;
  }
  const transport = getSmtpTransport();
  await transport.verify();
  return true;
};

/** Диагностика (без секретов) — видно, Resend видит сервер или всё ещё падает в SMTP */
exports.getEmailModeInfo = () => {
  const useResend = !!getResendApiKey();
  return {
    mode: useResend ? 'resend' : 'smtp',
    resendKeySet: useResend,
    resendFromSet: !!(process.env.RESEND_FROM && String(process.env.RESEND_FROM).trim()),
    smtpHostSet: !!process.env.SMTP_HOST
  };
};
