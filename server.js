'use strict';

const http = require('http');
const net = require('net');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const MAILPIT_SMTP_HOST = process.env.MAILPIT_SMTP_HOST || '127.0.0.1';
const MAILPIT_SMTP_PORT = Number(process.env.MAILPIT_SMTP_PORT || 1025);
const MAIL_FROM = process.env.MAIL_FROM || 'Scoops <hello@scoops.local>';
const CODE_TTL_MS = Number(process.env.CODE_TTL_MS || 10 * 60 * 1000);
const HTML_CANDIDATES = ['index.html', 'scoops_mailpit_connected.html'];
function resolveHtmlFile() {
  const match = HTML_CANDIDATES.map(name => path.join(__dirname, name)).find(file => fs.existsSync(file));
  return match || path.join(__dirname, 'index.html');
}
const HTML_FILE = resolveHtmlFile();

const verificationCodes = new Map();
const parentCodes = new Map();

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function cleanHeader(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

function generateCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function storeCode(map, email) {
  const code = generateCode();
  map.set(normalizeEmail(email), {
    code,
    expiresAt: Date.now() + CODE_TTL_MS,
    attempts: 0
  });
  return code;
}

function verifyStoredCode(map, email, code) {
  const key = normalizeEmail(email);
  const record = map.get(key);
  if (!record) return { ok: false, error: 'No active code was found. Request a new code.' };
  if (Date.now() > record.expiresAt) {
    map.delete(key);
    return { ok: false, error: 'That code expired. Request a new code.' };
  }
  record.attempts += 1;
  if (record.attempts > 8) {
    map.delete(key);
    return { ok: false, error: 'Too many attempts. Request a new code.' };
  }
  if (String(code || '') !== record.code) {
    return { ok: false, error: 'That code is not correct.' };
  }
  map.delete(key);
  return { ok: true };
}

function envelopeAddress(fromHeader) {
  const match = String(fromHeader).match(/<([^>]+)>/);
  return cleanHeader(match ? match[1] : fromHeader);
}

function makeMessage({ to, subject, text, html }) {
  const boundary = `scoops-${crypto.randomBytes(12).toString('hex')}`;
  const messageId = `<${Date.now()}.${crypto.randomBytes(8).toString('hex')}@scoops.local>`;
  return [
    `From: ${cleanHeader(MAIL_FROM)}`,
    `To: ${cleanHeader(to)}`,
    `Subject: ${cleanHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    String(text || ''),
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    String(html || ''),
    '',
    `--${boundary}--`,
    ''
  ].join('\r\n');
}

function smtpSend({ to, subject, text, html }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: MAILPIT_SMTP_HOST, port: MAILPIT_SMTP_PORT });
    socket.setTimeout(8000);

    let lineBuffer = '';
    let responseLines = [];
    const responseQueue = [];
    const waiters = [];
    let settled = false;

    function finishError(error) {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error instanceof Error ? error : new Error(String(error)));
    }

    function pushResponse(response) {
      const waiter = waiters.shift();
      if (waiter) waiter.resolve(response);
      else responseQueue.push(response);
    }

    function readResponse() {
      if (responseQueue.length) return Promise.resolve(responseQueue.shift());
      return new Promise((resolveResponse, rejectResponse) => {
        waiters.push({ resolve: resolveResponse, reject: rejectResponse });
      });
    }

    function assertCode(response, acceptedCodes) {
      const code = Number(String(response).slice(0, 3));
      if (!acceptedCodes.includes(code)) {
        throw new Error(`Mailpit SMTP rejected the message (${response}).`);
      }
    }

    async function command(commandText, acceptedCodes) {
      if (commandText !== null) socket.write(`${commandText}\r\n`);
      const response = await readResponse();
      assertCode(response, acceptedCodes);
      return response;
    }

    socket.on('data', chunk => {
      lineBuffer += chunk.toString('utf8');
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop() || '';
      for (const line of lines) {
        if (!line) continue;
        responseLines.push(line);
        if (/^\d{3} /.test(line)) {
          pushResponse(responseLines.join('\n'));
          responseLines = [];
        }
      }
    });

    socket.on('timeout', () => finishError(new Error('Timed out connecting to Mailpit SMTP.')));
    socket.on('error', error => finishError(new Error(`Could not connect to Mailpit SMTP at ${MAILPIT_SMTP_HOST}:${MAILPIT_SMTP_PORT}. ${error.message}`)));
    socket.on('close', () => {
      if (!settled && waiters.length) finishError(new Error('Mailpit closed the SMTP connection unexpectedly.'));
    });

    socket.on('connect', async () => {
      try {
        await command(null, [220]);
        await command('EHLO scoops.local', [250]);
        await command(`MAIL FROM:<${envelopeAddress(MAIL_FROM)}>`, [250]);
        await command(`RCPT TO:<${cleanHeader(to)}>`, [250, 251]);
        await command('DATA', [354]);
        const message = makeMessage({ to, subject, text, html })
          .replace(/(^|\r\n)\./g, '$1..');
        socket.write(`${message}\r\n.\r\n`);
        const accepted = await readResponse();
        assertCode(accepted, [250]);
        socket.write('QUIT\r\n');
        settled = true;
        socket.end();
        resolve();
      } catch (error) {
        finishError(error);
      }
    });
  });
}

function emailLayout({ eyebrow, title, body, code, footer }) {
  return `<!doctype html>
<html><body style="margin:0;background:#f4effb;font-family:Arial,sans-serif;color:#333;">
  <div style="max-width:560px;margin:28px auto;padding:0 16px;">
    <div style="background:white;border-radius:22px;padding:28px;border:3px solid #b39ddb;box-shadow:0 8px 24px rgba(84,64,115,.12);">
      <div style="font-size:13px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#7c5cbf;">${escapeHtml(eyebrow)}</div>
      <h1 style="margin:8px 0 12px;font-size:28px;color:#7c5cbf;">${escapeHtml(title)}</h1>
      <div style="font-size:16px;line-height:1.6;">${body}</div>
      ${code ? `<div style="margin:24px auto;text-align:center;font-size:34px;font-weight:900;letter-spacing:8px;color:#333;background:#fff9c4;border:3px solid #ffd54f;border-radius:16px;padding:18px;">${escapeHtml(code)}</div>` : ''}
      <div style="margin-top:22px;font-size:12px;line-height:1.5;color:#666;">${escapeHtml(footer)}</div>
    </div>
  </div>
</body></html>`;
}

async function sendVerificationEmail(email, childName, code) {
  const safeName = escapeHtml(childName || 'your child');
  await smtpSend({
    to: email,
    subject: 'Verify your Scoops parent email',
    text: `Use verification code ${code} to finish creating the Scoops account for ${childName || 'your child'}. This code expires in 10 minutes.`,
    html: emailLayout({
      eyebrow: 'Scoops account verification',
      title: 'Verify the parent email',
      body: `Use this code to finish creating the Scoops reader profile for <strong>${safeName}</strong>.`,
      code,
      footer: 'This is a local development email captured by Mailpit. The code expires in 10 minutes.'
    })
  });
}

async function sendWelcomeEmail(email, childName, username) {
  const safeName = escapeHtml(childName || 'your child');
  const safeUsername = escapeHtml(username || 'reader');
  await smtpSend({
    to: email,
    subject: 'Welcome to Scoops',
    text: `Welcome to Scoops! The reader profile ${childName || ''} (@${username || 'reader'}) is ready.`,
    html: emailLayout({
      eyebrow: 'Welcome to Scoops',
      title: 'The reader profile is ready',
      body: `<strong>${safeName}</strong> can now explore stories, create illustrated books, and practice reading skills using <strong>@${safeUsername}</strong>.`,
      footer: 'This is a local development email captured by Mailpit. Scoops is still a prototype and should not collect real children’s information.'
    })
  });
}

async function sendParentCodeEmail(email, childName, code) {
  const safeName = escapeHtml(childName || 'the child account');
  await smtpSend({
    to: email,
    subject: 'Your Scoops parent verification code',
    text: `Use parent verification code ${code} to open the Scoops parent section for ${childName || 'the child account'}. This code expires in 10 minutes.`,
    html: emailLayout({
      eyebrow: 'Parent section verification',
      title: 'Your parent access code',
      body: `Use this one-time code to open the protected parent section for <strong>${safeName}</strong>.`,
      code,
      footer: 'This is a local development email captured by Mailpit. The code expires in 10 minutes.'
    })
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });
  response.end(JSON.stringify(payload));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 100_000) {
        reject(new Error('Request body is too large.'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('Invalid JSON request.')); }
    });
    request.on('error', reject);
  });
}

async function handleApi(request, response, pathname) {
  if (request.method !== 'POST') return sendJson(response, 405, { error: 'Use POST for this endpoint.' });
  let body;
  try { body = await readJson(request); }
  catch (error) { return sendJson(response, 400, { error: error.message }); }

  const email = normalizeEmail(body.email);
  if (!isValidEmail(email)) return sendJson(response, 400, { error: 'Enter a valid email address.' });

  try {
    if (pathname === '/api/auth/send-verification') {
      const code = storeCode(verificationCodes, email);
      await sendVerificationEmail(email, String(body.childName || '').trim(), code);
      return sendJson(response, 200, { ok: true, expiresInSeconds: Math.floor(CODE_TTL_MS / 1000) });
    }

    if (pathname === '/api/auth/verify') {
      const result = verifyStoredCode(verificationCodes, email, body.code);
      if (!result.ok) return sendJson(response, 400, { error: result.error });
      await sendWelcomeEmail(email, String(body.childName || '').trim(), String(body.username || '').trim());
      return sendJson(response, 200, { ok: true, verified: true, welcomeSent: true });
    }

    if (pathname === '/api/parent/send-code') {
      const code = storeCode(parentCodes, email);
      await sendParentCodeEmail(email, String(body.childName || '').trim(), code);
      return sendJson(response, 200, { ok: true, expiresInSeconds: Math.floor(CODE_TTL_MS / 1000) });
    }

    if (pathname === '/api/parent/verify-code') {
      const result = verifyStoredCode(parentCodes, email, body.code);
      if (!result.ok) return sendJson(response, 400, { error: result.error });
      return sendJson(response, 200, { ok: true, verified: true });
    }

    return sendJson(response, 404, { error: 'API endpoint not found.' });
  } catch (error) {
    console.error(error);
    return sendJson(response, 502, { error: error.message });
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);
  const pathname = url.pathname;

  if (request.method === 'OPTIONS') return sendJson(response, 204, {});

  if (pathname === '/health' || pathname === '/api/health') {
    return sendJson(response, 200, {
      ok: true,
      app: `http://${HOST}:${PORT}`,
      mailpitUi: 'http://localhost:8025',
      mailpitSmtp: `${MAILPIT_SMTP_HOST}:${MAILPIT_SMTP_PORT}`
    });
  }

  if (pathname.startsWith('/api/')) return handleApi(request, response, pathname);

  if (pathname === '/mailpit') {
    response.writeHead(302, { Location: 'http://localhost:8025' });
    return response.end();
  }

  if (pathname === '/' || pathname === '/index.html' || pathname === '/scoops_mailpit_connected.html') {
    fs.readFile(HTML_FILE, (error, content) => {
      if (error) {
        response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        return response.end(`Could not read ${path.basename(HTML_FILE)}.\n${error.message}`);
      }
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      response.end(content);
    });
    return;
  }

  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('Not found');
});

server.listen(PORT, HOST, () => {
  console.log(`Scoops:  http://localhost:${PORT}`);
  console.log(`Serving: ${path.basename(HTML_FILE)}`);
  console.log('Mailpit: http://localhost:8025');
  console.log(`SMTP:   ${MAILPIT_SMTP_HOST}:${MAILPIT_SMTP_PORT}`);
});
