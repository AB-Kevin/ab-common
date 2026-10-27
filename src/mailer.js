'use strict';

// Sending email over SMTP. `smtp` is { host, port, secure, user, password,
// fromName, fromEmail }: an app's own settings, or AB Apps' mail server
// (abapps.sharedServices) with no user or password.

const nodemailer = require('nodemailer');

function createTransport(smtp) {
  const options = {
    host: smtp.host,
    port: Number(smtp.port) || 587,
    secure: Boolean(smtp.secure),
    // A server that never answers fails after 30 seconds instead of hanging a send.
    connectionTimeout: 30000,
  };
  // No username means a relay that trusts this computer's address instead of a
  // sign-in. Such relays can reject even an empty sign-in, so don't send one.
  if (smtp.user) options.auth = { user: smtp.user, pass: smtp.password };
  return nodemailer.createTransport(options);
}

/** Connects and says hello without sending anything. Throws if the server can't be reached or refuses. */
async function verifyConnection(smtp) {
  await createTransport(smtp).verify();
  return true;
}

/** Sends one email. nodemailer quotes the From name itself, so any name makes a valid header. */
async function sendMail(smtp, { to, subject, text, html, attachments }) {
  const address = smtp.fromEmail || smtp.user;
  const from = smtp.fromName ? { name: smtp.fromName, address } : address;
  return createTransport(smtp).sendMail({ from, to, subject, text, html, attachments });
}

module.exports = { createTransport, verifyConnection, sendMail };
