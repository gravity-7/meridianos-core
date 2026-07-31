/**
 * smtp-mailer — P5: minimal SMTP client using node:tls.
 *
 * Sends formatted email via user-configured SMTP relay. Supports AUTH LOGIN
 * and multipart MIME (text/plain + text/html). Zero npm dependencies.
 *
 * Usage:
 *   import { sendEmail } from './smtp-mailer.mjs';
 *   const result = await sendEmail({ host, port, user, pass, from, to, subject, textBody, htmlBody });
 *   // → { ok: true } or { ok: false, error: '...' }
 */

import tls from 'node:tls';
import net from 'node:net';

const TIMEOUT_MS = 5000;

/**
 * Read a single SMTP response line. Returns { code, lines[] }.
 */
function readResponse(socket, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const buf = [];
    const timer = setTimeout(() => {
      socket.removeAllListeners('data');
      reject(new Error('SMTP timeout'));
    }, timeoutMs);

    function onData(data) {
      buf.push(data.toString('utf8'));
      // Check if we have a complete response (line ends with \r\n and last line has space after code)
      const text = buf.join('');
      const lines = text.split('\r\n').filter(Boolean);
      const lastLine = lines[lines.length - 1] || '';
      // Multi-line responses have '-' after code, last line has ' '
      if (lastLine.length >= 4 && lastLine[3] === ' ') {
        clearTimeout(timer);
        socket.removeListener('data', onData);
        const code = parseInt(lastLine.slice(0, 3), 10);
        resolve({ code, lines });
      }
      if (buf.length > 10) {
        clearTimeout(timer);
        socket.removeListener('data', onData);
        reject(new Error('SMTP response too long'));
      }
    }

    socket.on('data', onData);
    socket.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    socket.once('close', () => {
      clearTimeout(timer);
      reject(new Error('SMTP connection closed'));
    });
  });
}

function sendLine(socket, line) {
  return new Promise((resolve, reject) => {
    socket.write(line + '\r\n', (err) => {
      if (err) reject(err); else resolve();
    });
  });
}

/**
 * Send an email via SMTP.
 *
 * @param {object} opts
 * @param {string} opts.host - SMTP server hostname
 * @param {number} opts.port - SMTP port (587 for STARTTLS, 465 for TLS)
 * @param {string} opts.user - SMTP AUTH username
 * @param {string} opts.pass - SMTP AUTH password
 * @param {string} opts.from - From address
 * @param {string} opts.to - Recipient address (comma-separated for multiple)
 * @param {string} opts.subject - Email subject
 * @param {string} opts.textBody - Plain text body
 * @param {string} opts.htmlBody - HTML body (optional)
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function sendEmail({ host, port = 587, user, pass, from, to, subject, textBody, htmlBody } = {}) {
  if (!host || !user || !pass || !from || !to) {
    return { ok: false, error: 'Missing required SMTP fields: host, user, pass, from, to' };
  }

  return new Promise((resolve) => {
    let socket;
    const cleanup = (result) => {
      try { socket?.destroy(); } catch { /* ignore */ }
      resolve(result);
    };

    try {
      const isSsl = port === 465;
      socket = tls.connect({ host, port, rejectUnauthorized: true, servername: host }, async () => {
        try {
          // Read greeting
          const greeting = await readResponse(socket);
          if (greeting.code !== 220) return cleanup({ ok: false, error: `SMTP greeting failed: ${greeting.code}` });

          // EHLO
          await sendLine(socket, `EHLO meridianos`);
          const ehlo = await readResponse(socket);
          if (ehlo.code !== 250) return cleanup({ ok: false, error: `EHLO failed: ${ehlo.code}` });

          // STARTTLS if not already SSL
          if (!isSsl) {
            await sendLine(socket, 'STARTTLS');
            const starttlsResp = await readResponse(socket);
            if (starttlsResp.code !== 220) return cleanup({ ok: false, error: `STARTTLS failed: ${starttlsResp.code}` });

            // Upgrade connection
            socket.removeAllListeners('data');
            const oldSocket = socket;
            socket = tls.connect({ socket: oldSocket, host, rejectUnauthorized: true, servername: host }, () => {});
            await new Promise((res) => socket.once('secureConnect', res));

            // Re-EHLO after STARTTLS
            await sendLine(socket, `EHLO meridianos`);
            const ehlo2 = await readResponse(socket);
            if (ehlo2.code !== 250) return cleanup({ ok: false, error: `EHLO after STARTTLS failed: ${ehlo2.code}` });
          }

          // AUTH LOGIN
          await sendLine(socket, 'AUTH LOGIN');
          const authPrompt = await readResponse(socket);
          if (authPrompt.code !== 334) return cleanup({ ok: false, error: `AUTH LOGIN not supported: ${authPrompt.code}` });

          await sendLine(socket, Buffer.from(user).toString('base64'));
          const userResp = await readResponse(socket);
          if (userResp.code !== 334) return cleanup({ ok: false, error: `AUTH username rejected: ${userResp.code}` });

          await sendLine(socket, Buffer.from(pass).toString('base64'));
          const passResp = await readResponse(socket);
          if (passResp.code !== 235) return cleanup({ ok: false, error: `AUTH password rejected: ${passResp.code}` });

          // MAIL FROM
          await sendLine(socket, `MAIL FROM:<${from}>`);
          const mailResp = await readResponse(socket);
          if (mailResp.code !== 250) return cleanup({ ok: false, error: `MAIL FROM rejected: ${mailResp.code}` });

          // RCPT TO
          const recipients = to.split(',').map(s => s.trim());
          for (const rcpt of recipients) {
            await sendLine(socket, `RCPT TO:<${rcpt}>`);
            const rcptResp = await readResponse(socket);
            if (rcptResp.code !== 250 && rcptResp.code !== 251) {
              return cleanup({ ok: false, error: `RCPT TO ${rcpt} rejected: ${rcptResp.code}` });
            }
          }

          // DATA
          await sendLine(socket, 'DATA');
          const dataResp = await readResponse(socket);
          if (dataResp.code !== 354) return cleanup({ ok: false, error: `DATA not accepted: ${dataResp.code}` });

          // Build MIME message
          const boundary = `boundary-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const message = [
            `From: ${from}`,
            `To: ${to}`,
            `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`,
            'MIME-Version: 1.0',
            `Content-Type: multipart/alternative; boundary="${boundary}"`,
            '',
            `--${boundary}`,
            'Content-Type: text/plain; charset=UTF-8',
            'Content-Transfer-Encoding: base64',
            '',
            Buffer.from(textBody || '', 'utf8').toString('base64'),
            '',
          ];

          if (htmlBody) {
            message.push(
              `--${boundary}`,
              'Content-Type: text/html; charset=UTF-8',
              'Content-Transfer-Encoding: base64',
              '',
              Buffer.from(htmlBody, 'utf8').toString('base64'),
              '',
            );
          }

          message.push(`--${boundary}--`);
          message.push('.');

          // Send message body
          const bodyText = message.join('\r\n');
          // Break long lines at 1000 chars per RFC
          for (let i = 0; i < bodyText.length; i += 900) {
            await sendLine(socket, bodyText.slice(i, i + 900));
          }

          const sentResp = await readResponse(socket);
          if (sentResp.code !== 250) return cleanup({ ok: false, error: `Message rejected: ${sentResp.code}` });

          // QUIT
          await sendLine(socket, 'QUIT');
          try { await readResponse(socket, 2000); } catch { /* best-effort */ }

          cleanup({ ok: true });
        } catch (e) {
          cleanup({ ok: false, error: e.message || String(e) });
        }
      });

      socket.once('error', (err) => {
        cleanup({ ok: false, error: `SMTP connection error: ${err.message}` });
      });

      setTimeout(() => {
        cleanup({ ok: false, error: 'SMTP connection timeout' });
      }, TIMEOUT_MS);
    } catch (e) {
      cleanup({ ok: false, error: e.message || String(e) });
    }
  });
}
