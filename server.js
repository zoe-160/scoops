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
const SCOOPS_BUILD = 'adaptive-learning-v36-2026-08-09';
const WELCOME_TEMPLATE_VERSION = 'welcome-inline-profile-v6';
const REPORT_TEMPLATE_VERSION = 'adaptive-path-reading-detective-v13';
const PDF_TEMPLATE_VERSION = 'reading-detective-progress-pdf-v6';
const REPORT_DOWNLOAD_TTL_MS = Number(process.env.REPORT_DOWNLOAD_TTL_MS || 24 * 60 * 60 * 1000);
const HTML_CANDIDATES = ['index.html', 'scoops_mailpit_connected.html'];
function resolveHtmlFile() {
  const match = HTML_CANDIDATES.map(name => path.join(__dirname, name)).find(file => fs.existsSync(file));
  return match || path.join(__dirname, 'index.html');
}
const HTML_FILE = resolveHtmlFile();


const STATIC_MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.pdf': 'application/pdf'
};

function findStaticFile(pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); }
  catch (error) { return null; }
  const requested = decoded.replace(/^\/+/, '');
  if (!requested || requested.includes('\0')) return null;
  const normalized = path.normalize(requested);
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) return null;
  const exact = path.join(__dirname, normalized);
  if (fs.existsSync(exact) && fs.statSync(exact).isFile()) return exact;

  // Friendly fallback for video/image filename capitalization differences.
  const directory = path.dirname(exact);
  const basename = path.basename(exact).toLowerCase();
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) return null;
  const match = fs.readdirSync(directory).find(name => name.toLowerCase() === basename);
  if (!match) return null;
  const candidate = path.join(directory, match);
  return fs.statSync(candidate).isFile() ? candidate : null;
}

function serveStaticFile(request, response, file) {
  const stat = fs.statSync(file);
  const contentType = STATIC_MIME_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const baseHeaders = {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  };
  const range = request.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
    if (!match) {
      response.writeHead(416, { ...baseHeaders, 'Content-Range': `bytes */${stat.size}` });
      return response.end();
    }
    let start = match[1] ? Number(match[1]) : 0;
    let end = match[2] ? Number(match[2]) : stat.size - 1;
    if (!match[1] && match[2]) {
      const suffixLength = Number(match[2]);
      start = Math.max(0, stat.size - suffixLength);
      end = stat.size - 1;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= stat.size) {
      response.writeHead(416, { ...baseHeaders, 'Content-Range': `bytes */${stat.size}` });
      return response.end();
    }
    end = Math.min(end, stat.size - 1);
    response.writeHead(206, {
      ...baseHeaders,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Content-Length': end - start + 1
    });
    if (request.method === 'HEAD') return response.end();
    return fs.createReadStream(file, { start, end }).pipe(response);
  }
  response.writeHead(200, { ...baseHeaders, 'Content-Length': stat.size });
  if (request.method === 'HEAD') return response.end();
  return fs.createReadStream(file).pipe(response);
}

const verificationCodes = new Map();
const parentCodes = new Map();
const reportDownloads = new Map();

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

function wrapBase64(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/.{1,76}/g, '$&\r\n').trim();
}

function sanitizeAttachmentFilename(value) {
  return String(value || 'attachment')
    .replace(/[\r\n"\\/]+/g, '-')
    .replace(/[^A-Za-z0-9._ -]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'attachment';
}

function makeMessage({ to, subject, text, html, attachments = [] }) {
  const alternativeBoundary = `scoops-alt-${crypto.randomBytes(12).toString('hex')}`;
  const mixedBoundary = `scoops-mixed-${crypto.randomBytes(12).toString('hex')}`;
  const messageId = `<${Date.now()}.${crypto.randomBytes(8).toString('hex')}@scoops.local>`;
  const headers = [
    `From: ${cleanHeader(MAIL_FROM)}`,
    `To: ${cleanHeader(to)}`,
    `Subject: ${cleanHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0'
  ];

  const alternative = [
    `--${alternativeBoundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    String(text || ''),
    '',
    `--${alternativeBoundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    String(html || ''),
    '',
    `--${alternativeBoundary}--`
  ].join('\r\n');

  if (!Array.isArray(attachments) || !attachments.length) {
    return [
      ...headers,
      `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
      '',
      alternative,
      ''
    ].join('\r\n');
  }

  const parts = [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    '',
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
    '',
    alternative
  ];

  attachments.forEach(attachment => {
    const filename = sanitizeAttachmentFilename(attachment.filename || 'attachment');
    const contentType = cleanHeader(attachment.contentType || 'application/octet-stream');
    parts.push(
      '',
      `--${mixedBoundary}`,
      `Content-Type: ${contentType}; name="${filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${filename}"`,
      '',
      wrapBase64(attachment.content || Buffer.alloc(0))
    );
  });

  parts.push('', `--${mixedBoundary}--`, '');
  return parts.join('\r\n');
}

function smtpSend({ to, subject, text, html, attachments = [] }) {
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
        const message = makeMessage({ to, subject, text, html, attachments })
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

function emailDecorSvg(type) {
  const common = 'width="100%" height="100%" viewBox="0 0 64 64" aria-hidden="true"';
  if (type === 'book') {
    return `<svg ${common} style="display:block;stroke:#7c5cbf;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;">
      <path fill="#f4a7b9" fill-opacity=".48" d="M8 13c8-3 16-2 24 4 8-6 16-7 24-4v38c-8-3-16-2-24 4-8-6-16-7-24-4z"/>
      <path d="M8 13c8-3 16-2 24 4 8-6 16-7 24-4v38c-8-3-16-2-24 4-8-6-16-7-24-4z"/>
      <path fill="#ffffff" fill-opacity=".72" d="M11 17c7-2 13-1 21 4v29c-7-4-14-5-21-3zM53 17c-7-2-13-1-21 4v29c7-4 14-5 21-3z"/>
      <path d="M11 17c7-2 13-1 21 4v29c-7-4-14-5-21-3zM53 17c-7-2-13-1-21 4v29c7-4 14-5 21-3zM32 21v29"/>
      <path stroke-opacity=".55" d="M16 26h10M16 32h11M16 38h9M38 26h10M37 32h11M39 38h9"/>
    </svg>`;
  }
  if (type === 'pencil') {
    return `<svg ${common} style="display:block;stroke:#6f5a85;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;">
      <g transform="rotate(-38 32 32)">
        <path fill="#ffd54f" fill-opacity=".72" d="M24 9h16v39H24z"/><path d="M24 9h16v39H24z"/>
        <path fill="#f4a7b9" fill-opacity=".72" d="M24 9h16v8H24z"/><path d="M24 9h16v8H24z"/>
        <path fill="#ffe0b2" fill-opacity=".9" d="m24 48 8 11 8-11z"/><path d="m24 48 8 11 8-11z"/>
        <path fill="#504860" fill-opacity=".72" d="m29 55 3 4 3-4z"/><path d="m29 55 3 4 3-4z"/>
        <path stroke="#ffffff" stroke-opacity=".75" stroke-width="2.4" d="M28 21v22"/>
      </g>
    </svg>`;
  }
  return `<svg ${common} style="display:block;stroke:#6f5a85;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;">
    <path fill="#ffffff" fill-opacity=".62" d="M18 35h28l-4 15c-1 4-4 7-8 7h-4c-4 0-7-3-8-7z"/><path d="M18 35h28l-4 15c-1 4-4 7-8 7h-4c-4 0-7-3-8-7z"/>
    <circle fill="#fce4ec" cx="32" cy="27" r="10"/><circle cx="32" cy="27" r="10"/>
    <path fill="#b7735c" fill-opacity=".48" d="M24 26c3 3 5-2 8 1s5-2 8 1"/><path d="M24 26c3 3 5-2 8 1s5-2 8 1"/>
    <circle fill="#dc5c6e" fill-opacity=".8" cx="32" cy="14" r="4"/><circle cx="32" cy="14" r="4"/>
    <path stroke="#50825a" d="M32 10c1-4 4-6 7-6"/><path d="M32 57v3M25 60h14"/>
  </svg>`;
}

function brandedEmailShell(cardHtml, maxWidth = 660) {
  return `<!doctype html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link href="https://fonts.googleapis.com/css2?family=Fredoka+One&display=swap" rel="stylesheet">
  <style>
    @media only screen and (max-width:760px){
      .scoops-email-decor{display:none!important;}
      .scoops-email-stage{padding-left:12px!important;padding-right:12px!important;}
      .scoops-email-logo{font-size:42px!important;}
      .scoops-two-col,.scoops-three-col,.scoops-metric-cell,.scoops-comparison-cell{display:block!important;width:100%!important;box-sizing:border-box!important;}
      .scoops-metric-cell,.scoops-comparison-cell{padding:4px 0!important;}
      .scoops-download-link{margin-top:12px!important;}
    }
  </style>
</head>
<body style="margin:0;background:linear-gradient(160deg,#a8d8f0 0%,#c5e8f7 100%);font-family:Arial,sans-serif;color:#333;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;background:linear-gradient(160deg,#a8d8f0 0%,#c5e8f7 100%);">
    <tr><td align="center" style="padding:0;">
      <div class="scoops-email-stage" style="position:relative;max-width:1120px;margin:0 auto;padding:28px 26px 46px;overflow:hidden;">
        <div class="scoops-email-logo" style="position:relative;z-index:3;text-align:center;margin:0 0 18px;font-family:'Fredoka One','Arial Rounded MT Bold','Trebuchet MS',Arial,sans-serif;font-size:58px;font-weight:400;letter-spacing:1.7px;color:#7c5cbf;text-shadow:4px 4px 0 #b39ddb;line-height:1.02;">Scoops</div>

        <div class="scoops-email-decor" style="position:absolute;z-index:1;left:4px;top:92px;width:76px;height:76px;opacity:.68;transform:rotate(-10deg);">${emailDecorSvg('sundae')}</div>
        <div class="scoops-email-decor" style="position:absolute;z-index:1;right:1px;top:126px;width:72px;height:72px;opacity:.65;transform:rotate(9deg);">${emailDecorSvg('book')}</div>
        <div class="scoops-email-decor" style="position:absolute;z-index:1;left:3px;top:48%;width:72px;height:72px;opacity:.62;transform:rotate(8deg);">${emailDecorSvg('pencil')}</div>
        <div class="scoops-email-decor" style="position:absolute;z-index:1;right:4px;top:55%;width:75px;height:75px;opacity:.62;transform:rotate(-8deg);">${emailDecorSvg('sundae')}</div>
        <div class="scoops-email-decor" style="position:absolute;z-index:1;left:34px;bottom:34px;width:66px;height:66px;opacity:.58;transform:rotate(-5deg);">${emailDecorSvg('book')}</div>
        <div class="scoops-email-decor" style="position:absolute;z-index:1;right:24px;bottom:25px;width:65px;height:65px;opacity:.58;transform:rotate(11deg);">${emailDecorSvg('pencil')}</div>

        <div style="position:relative;z-index:2;max-width:${maxWidth}px;margin:0 auto;">${cardHtml}</div>
      </div>
    </td></tr>
  </table>
</body>
</html>`;
}

function emailLayout({ eyebrow, title, body, code, footer }) {
  const card = `<div style="background:white;border-radius:24px;padding:29px;border:3px solid #b39ddb;box-shadow:0 9px 26px rgba(84,64,115,.15);">
    <div style="font-size:13px;font-weight:900;letter-spacing:1px;text-transform:uppercase;color:#7c5cbf;">${escapeHtml(eyebrow)}</div>
    <h1 style="margin:8px 0 14px;font-size:29px;line-height:1.18;color:#6748ad;">${escapeHtml(title)}</h1>
    <div style="font-size:16px;line-height:1.65;">${body}</div>
    ${code ? `<div style="margin:24px auto;text-align:center;font-size:34px;font-weight:900;letter-spacing:8px;color:#333;background:#fff9c4;border:3px solid #ffd54f;border-radius:16px;padding:18px;">${escapeHtml(code)}</div>` : ''}
    <div style="margin-top:23px;padding-top:15px;border-top:1px solid #eeeeee;font-size:12px;line-height:1.5;color:#666;">${escapeHtml(footer)}</div>
  </div>`;
  return brandedEmailShell(card, 580);
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
  const displayName = String(childName || 'your child').trim() || 'your child';
  const readerUsername = String(username || 'reader').trim() || 'reader';
  const safeName = escapeHtml(displayName);
  const safeUsername = escapeHtml(readerUsername);

  const text = [
    'Welcome to Scoops!',
    '',
    `Thank you for creating a Scoops account for ${displayName}. By joining Scoops, you are giving your child another place to practice reading, explore ideas, and build confidence through creativity.`,
    '',
    'Scoops is a children’s literacy and creative-expression experience where young readers can discover stories, strengthen phonics, vocabulary, and spelling skills, and turn their own ideas into illustrated books.',
    '',
    `${displayName}'s reader profile, @${readerUsername}, is ready to explore stories, practice reading skills, and create illustrated books.`,
    '',
    'Inside Scoops, your child can:',
    '• Read and explore age-appropriate stories',
    '• Practice phonics, vocabulary, spelling, and comprehension through Reading Detective',
    '• Write, illustrate, and save original books',
    '• Build confidence as a reader, learner, and creator',
    '',
    'The Parent Section also lets you review learning activity and request progress reports so you can celebrate growth and see what your child may want to practice next.',
    '',
    'Thank you for supporting your child’s imagination, education, and love of reading. We are excited to have your family in the Scoops community.',
    '',
    'Happy reading and creating,',
    'The Scoops Team'
  ].join('\n');

  const html = emailLayout({
    eyebrow: 'Welcome to Scoops',
    title: 'A new reading and creativity journey begins',
    body: `
      <p style="margin:0 0 16px;">Thank you for creating a Scoops account for <strong>${safeName}</strong>. By joining Scoops, you are giving your child another place to practice reading, explore ideas, and build confidence through creativity.</p>
      <p style="margin:0 0 16px;"><strong>Scoops</strong> is a children’s literacy and creative-expression experience where young readers can discover stories, strengthen phonics, vocabulary, and spelling skills, and turn their own ideas into illustrated books.</p>
      <p style="margin:0 0 18px;font-size:17px;line-height:1.65;"><strong>${safeName}’s reader profile</strong>, <span style="display:inline-block;padding:2px 8px;background:#f3eeff;border-radius:999px;color:#6748ad;font-weight:900;">@${safeUsername}</span>, is ready to explore stories, practice reading skills, and create illustrated books.</p>
      <p style="margin:0 0 10px;font-weight:900;">Inside Scoops, your child can:</p>
      <ul style="margin:0 0 18px;padding-left:22px;line-height:1.75;">
        <li>Read and explore age-appropriate stories</li>
        <li>Practice phonics, vocabulary, spelling, and comprehension through Reading Detective</li>
        <li>Write, illustrate, and save original books</li>
        <li>Build confidence as a reader, learner, and creator</li>
      </ul>
      <div style="margin:18px 0;padding:16px 18px;background:#fff9c4;border:2px solid #ffd54f;border-radius:16px;">
        <div style="font-weight:900;margin-bottom:5px;">For parents and guardians</div>
        <div style="line-height:1.6;">Use the Parent Section to review learning activity and request progress reports so you can celebrate growth and see what your child may want to practice next.</div>
      </div>
      <p style="margin:0 0 16px;">Thank you for supporting your child’s imagination, education, and love of reading. We are excited to have your family in the Scoops community.</p>
      <p style="margin:0;"><strong>Happy reading and creating,<br>The Scoops Team</strong></p>
    `,
    footer: `Local Mailpit development email · Template ${WELCOME_TEMPLATE_VERSION} · Scoops is still a prototype and should not collect real children’s information.`
  });

  await smtpSend({
    to: email,
    subject: 'Welcome to Scoops — let’s grow a love of reading',
    text,
    html
  });
}

function progressAreaLabel(key) {
  return ({ phonics: 'Phonics', vocabulary: 'Vocabulary', spelling: 'Spelling', comprehension: 'Reading Detective' })[key] || String(key || 'Learning area');
}

function progressStatus(score, attempts) {
  if (!attempts) return { label: 'Not assessed', tone: 'none' };
  if (score < 60) return { label: 'Priority for focused support', tone: 'urgent' };
  if (score < 75) return { label: 'Building this skill', tone: 'focus' };
  if (score < 85) return { label: 'Developing steadily', tone: 'developing' };
  return { label: 'On track', tone: 'track' };
}

function progressAreaGuidance(key, score, attempts = 1) {
  const area = progressAreaLabel(key);
  const practices = {
    phonics: 'Practice letter sounds, blending, sound patterns, and word families in short repeat sessions.',
    vocabulary: 'Review the missed words, say each meaning in the child’s own words, and use every word in a new sentence.',
    spelling: 'Practice the identified spelling pattern and rewrite each missed word correctly from memory.',
    comprehension: 'Reread a short passage and practice details, sequence, main idea, inference, context clues, and evidence one skill at a time.'
  };
  const status = progressStatus(score, attempts);
  return {
    key,
    area,
    score,
    attempts,
    belowTarget: score < 75 && attempts ? attempts : 0,
    status: status.label,
    tone: status.tone,
    comparison: { available: false, delta: 0, direction: 'unknown', text: 'Not enough data to compare' },
    message: attempts ? `${area} is currently at ${score}%. ${practices[key] || 'Repeat the related lesson and practice missed questions.'}` : `No completed ${area.toLowerCase()} assessment was recorded in this period.`,
    recommendation: practices[key] || 'Repeat the related lesson and practice missed questions.'
  };
}

function normalizeDeltaEntry(value) {
  const entry = value && typeof value === 'object' ? value : {};
  const delta = Math.max(-100000, Math.min(100000, Math.round(Number(entry.delta) || 0)));
  return {
    available: Boolean(entry.available),
    delta,
    direction: String(entry.direction || (delta > 0 ? 'up' : delta < 0 ? 'down' : 'same')).trim().slice(0, 30),
    text: String(entry.text || (entry.available ? 'No change from the previous period' : 'Not enough data to compare')).trim().slice(0, 180)
  };
}

function normalizeMistakeDetail(value, fallbackArea = 'Learning area') {
  const detail = value && typeof value === 'object' ? value : {};
  const safeEntries = (items, mapper, limit = 6) => Array.isArray(items) ? items.slice(0, limit).map(mapper).filter(Boolean) : [];
  return {
    area: String(detail.area || fallbackArea).trim().slice(0, 80),
    attempts: Math.max(0, Math.min(10000, Math.round(Number(detail.attempts) || 0))),
    missed: Math.max(0, Math.min(10000, Math.round(Number(detail.missed) || 0))),
    summary: String(detail.summary || 'Question-level results were not recorded for this area during the period.').trim().slice(0, 500),
    repeatedSkills: safeEntries(detail.repeatedSkills, item => {
      const skill = String(item?.skill || '').trim().slice(0, 160);
      return skill ? { skill, count: Math.max(1, Math.min(10000, Math.round(Number(item?.count) || 1))) } : null;
    }),
    missedItems: safeEntries(detail.missedItems, item => {
      const name = String(item?.item || '').trim().slice(0, 120);
      return name ? { item: name, count: Math.max(1, Math.min(10000, Math.round(Number(item?.count) || 1))) } : null;
    }),
    examples: safeEntries(detail.examples, item => ({
      question: String(item?.question || 'Question').trim().slice(0, 240),
      selectedAnswer: String(item?.selectedAnswer || 'No answer recorded').trim().slice(0, 180),
      correctAnswer: String(item?.correctAnswer || '').trim().slice(0, 180),
      word: String(item?.word || '').trim().slice(0, 80)
    }), 3),
    recommendation: String(detail.recommendation || '').trim().slice(0, 500)
  };
}

function normalizeProgressReport(input) {
  const report = input && typeof input === 'object' ? input : {};
  const numeric = (value, max = 100000) => Math.max(0, Math.min(max, Math.round(Number(value) || 0)));
  const percentage = value => Math.max(0, Math.min(100, numeric(value, 100)));
  const safeList = (value, limit = 8) => Array.isArray(value)
    ? value.slice(0, limit).map(item => String(item || '').trim().slice(0, 500)).filter(Boolean)
    : [];
  const pathProgress = {
    phonics: percentage(report.pathProgress?.phonics),
    vocabulary: percentage(report.pathProgress?.vocabulary),
    spelling: percentage(report.pathProgress?.spelling),
    comprehension: percentage(report.pathProgress?.comprehension)
  };
  const categoryAttempts = {
    phonics: numeric(report.categoryAttempts?.phonics, 10000),
    vocabulary: numeric(report.categoryAttempts?.vocabulary, 10000),
    spelling: numeric(report.categoryAttempts?.spelling, 10000),
    comprehension: numeric(report.categoryAttempts?.comprehension, 10000)
  };
  const categoryBelowTarget = {
    phonics: numeric(report.categoryBelowTarget?.phonics, categoryAttempts.phonics),
    vocabulary: numeric(report.categoryBelowTarget?.vocabulary, categoryAttempts.vocabulary),
    spelling: numeric(report.categoryBelowTarget?.spelling, categoryAttempts.spelling),
    comprehension: numeric(report.categoryBelowTarget?.comprehension, categoryAttempts.comprehension)
  };
  const comparisonInput = report.comparison && typeof report.comparison === 'object' ? report.comparison : {};
  const comparison = {
    available: Boolean(comparisonInput.available),
    label: String(comparisonInput.label || 'Compared with the preceding period').trim().slice(0, 120),
    overallDirection: String(comparisonInput.overallDirection || 'Not enough earlier data').trim().slice(0, 120),
    overallMessage: String(comparisonInput.overallMessage || 'Scoops does not yet have enough earlier activity for a reliable comparison.').trim().slice(0, 400),
    metrics: {
      minutes: normalizeDeltaEntry(comparisonInput.metrics?.minutes),
      lessons: normalizeDeltaEntry(comparisonInput.metrics?.lessons),
      quizAverage: normalizeDeltaEntry(comparisonInput.metrics?.quizAverage),
      stories: normalizeDeltaEntry(comparisonInput.metrics?.stories)
    },
    areas: {
      phonics: normalizeDeltaEntry(comparisonInput.areas?.phonics),
      vocabulary: normalizeDeltaEntry(comparisonInput.areas?.vocabulary),
      spelling: normalizeDeltaEntry(comparisonInput.areas?.spelling),
      comprehension: normalizeDeltaEntry(comparisonInput.areas?.comprehension)
    }
  };
  const mistakeByArea = {};
  (Array.isArray(report.mistakeDetails) ? report.mistakeDetails : []).slice(0, 6).forEach(item => {
    const normalized = normalizeMistakeDetail(item);
    mistakeByArea[normalized.area.toLowerCase()] = normalized;
  });
  const categoryDetails = {};
  ['phonics', 'vocabulary', 'spelling', 'comprehension'].forEach(key => {
    const raw = report.categoryDetails?.[key] && typeof report.categoryDetails[key] === 'object' ? report.categoryDetails[key] : {};
    const status = progressStatus(pathProgress[key], categoryAttempts[key]);
    const findings = normalizeMistakeDetail(raw.findings || mistakeByArea[progressAreaLabel(key).toLowerCase()], progressAreaLabel(key));
    categoryDetails[key] = {
      key,
      area: String(raw.area || progressAreaLabel(key)).trim().slice(0, 80),
      score: percentage(raw.score ?? pathProgress[key]),
      attempts: numeric(raw.attempts ?? categoryAttempts[key], 10000),
      belowTarget: numeric(raw.belowTarget ?? categoryBelowTarget[key], 10000),
      status: String(raw.status || status.label).trim().slice(0, 100),
      tone: String(raw.tone || status.tone).trim().slice(0, 30),
      comparison: normalizeDeltaEntry(raw.comparison || comparison.areas[key]),
      message: String(raw.message || '').trim().slice(0, 700),
      findings,
      recommendation: String(raw.recommendation || findings.recommendation || progressAreaGuidance(key, pathProgress[key], categoryAttempts[key]).recommendation).trim().slice(0, 500)
    };
  });
  let improvementAreas = Array.isArray(report.improvementAreas)
    ? report.improvementAreas.slice(0, 3).map(item => {
        const area = String(item?.area || '').trim();
        const key = Object.keys(categoryDetails).find(name => categoryDetails[name].area === area) || String(item?.key || '').trim();
        return key && categoryDetails[key] ? categoryDetails[key] : null;
      }).filter(Boolean)
    : [];
  if (!improvementAreas.length) {
    improvementAreas = Object.values(categoryDetails).filter(item => item.attempts > 0 && (item.score < 75 || (item.comparison.available && item.comparison.delta <= -5))).sort((a, b) => a.score - b.score);
  }
  const assessed = Object.values(categoryDetails).filter(item => item.attempts > 0).sort((a, b) => a.score - b.score);
  const growthFocus = improvementAreas[0] || assessed[0] || null;
  const unassessedAreas = safeList(report.unassessedAreas).length
    ? safeList(report.unassessedAreas)
    : Object.values(categoryDetails).filter(item => item.attempts === 0).map(item => item.area);
  const readingInput = report.readingProfile && typeof report.readingProfile === 'object' ? report.readingProfile : {};
  const nullableNumber = (value, max = 100000) => value == null || value === '' ? null : Math.max(0, Math.min(max, Math.round(Number(value) || 0)));
  const readingProfile = {
    attempts: numeric(readingInput.attempts, 10000),
    independentAttempts: numeric(readingInput.independentAttempts, 10000),
    averageWordsPerMinute: nullableNumber(readingInput.averageWordsPerMinute, 10000),
    latestWordsPerMinute: nullableNumber(readingInput.latestWordsPerMinute, 10000),
    latestObservedWordsPerMinute: nullableNumber(readingInput.latestObservedWordsPerMinute, 10000),
    latestMode: String(readingInput.latestMode || '').trim().slice(0, 40),
    latestPace: String(readingInput.latestPace || '').trim().slice(0, 80),
    latestComprehension: String(readingInput.latestComprehension || '').trim().slice(0, 100),
    latestComprehensionPercent: nullableNumber(readingInput.latestComprehensionPercent, 100),
    latestPattern: String(readingInput.latestPattern || '').trim().slice(0, 500),
    latestInitialReadingSeconds: nullableNumber(readingInput.latestInitialReadingSeconds, 86400),
    latestTotalActivitySeconds: nullableNumber(readingInput.latestTotalActivitySeconds, 86400),
    latestQuestionReviewSeconds: nullableNumber(readingInput.latestQuestionReviewSeconds, 86400),
    averageInitialReadingSeconds: nullableNumber(readingInput.averageInitialReadingSeconds, 86400),
    averageTotalActivitySeconds: nullableNumber(readingInput.averageTotalActivitySeconds, 86400),
    averageHighlightCount: nullableNumber(readingInput.averageHighlightCount, 1000) || 0
  };
  return {
    childName: String(report.childName || 'Your child').trim().slice(0, 80) || 'Your child',
    period: String(report.period || 'week').trim().slice(0, 30),
    periodLabel: String(report.periodLabel || 'Past 7 days').trim().slice(0, 80),
    startDate: String(report.startDate || '').trim().slice(0, 40),
    endDate: String(report.endDate || '').trim().slice(0, 40),
    minutes: numeric(report.minutes),
    lessons: numeric(report.lessons, 10000),
    quizCount: numeric(report.quizCount, 10000),
    quizAverage: percentage(report.quizAverage),
    stories: numeric(report.stories, 10000),
    streak: numeric(report.streak, 3660),
    pathProgress,
    categoryAttempts,
    categoryBelowTarget,
    categoryDetails,
    readingProfile,
    comparison,
    strongestArea: String(report.strongestArea || 'Not enough quiz data').trim().slice(0, 80),
    priorityArea: String(report.priorityArea || growthFocus?.area || 'More activity needed').trim().slice(0, 80),
    highlights: safeList(report.highlights),
    improvementAreas,
    growthFocus,
    unassessedAreas,
    mistakeDetails: Object.values(categoryDetails).map(item => item.findings),
    nextStep: String(report.nextStep || growthFocus?.recommendation || 'Keep reading, creating, and practicing a little each day.').trim().slice(0, 700),
    dataSource: String(report.dataSource || 'activity and question-level results stored in this browser').trim().slice(0, 180)
  };
}


function pdfPlainText(value) {
  return String(value ?? '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2022/g, '-')
    .replace(/[^\x20-\x7E]/g, '');
}

function pdfSafeText(value) {
  return pdfPlainText(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function reportPdfFilename(report) {
  const child = String(report.childName || 'Child').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'Child';
  const period = String(report.periodLabel || 'Progress_Report').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'Progress_Report';
  return `${child}_${period}_Scoops_Progress_Report.pdf`.slice(0, 120);
}

class SimplePdfDocument {
  constructor() {
    this.width = 612;
    this.height = 792;
    this.pages = [];
    this.current = null;
  }
  addPage() {
    this.current = [];
    this.pages.push(this.current);
    this.fillRect(0, 0, this.width, this.height, '#eaf6fb');
    return this.current;
  }
  color(value) {
    const hex = String(value || '#000000').replace('#', '');
    const n = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex.padEnd(6, '0').slice(0, 6);
    return [0, 2, 4].map(i => (parseInt(n.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');
  }
  text(x, y, text, size = 11, bold = false, color = '#333333') {
    this.current.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${this.color(color)} rg 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${pdfSafeText(text)}) Tj ET`);
  }
  centered(y, text, size = 11, bold = false, color = '#333333') {
    const width = String(text).length * size * (bold ? 0.56 : 0.51);
    this.text(Math.max(36, (this.width - width) / 2), y, text, size, bold, color);
  }
  fillRect(x, y, width, height, color) {
    this.current.push(`${this.color(color)} rg ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f`);
  }
  strokeRect(x, y, width, height, color = '#cccccc', lineWidth = 1) {
    this.current.push(`${lineWidth} w ${this.color(color)} RG ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re S`);
  }
  line(x1, y1, x2, y2, color = '#cccccc', lineWidth = 1) {
    this.current.push(`${lineWidth} w ${this.color(color)} RG ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  }
  wrap(text, maxWidth, fontSize = 11, bold = false) {
    const maxChars = Math.max(12, Math.floor(maxWidth / (fontSize * (bold ? 0.56 : 0.51))));
    const words = pdfPlainText(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (candidate.length > maxChars && line) {
        lines.push(line);
        line = word;
      } else line = candidate;
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  }
  paragraph(x, y, text, maxWidth, fontSize = 11, lineHeight = 15, color = '#444444', bold = false) {
    const lines = this.wrap(text, maxWidth, fontSize, bold);
    lines.forEach((line, index) => this.text(x, y - index * lineHeight, line, fontSize, bold, color));
    return y - lines.length * lineHeight;
  }
  build() {
    const objects = [];
    const add = content => { objects.push(content); return objects.length; };
    const catalogId = add('');
    const pagesId = add('');
    const fontRegularId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    const fontBoldId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
    const pageIds = [];
    this.pages.forEach(commands => {
      const stream = commands.join('\n');
      const length = Buffer.byteLength(stream, 'binary');
      const contentId = add(`<< /Length ${length} >>\nstream\n${stream}\nendstream`);
      const pageId = add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.width} ${this.height}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentId} 0 R >>`);
      pageIds.push(pageId);
    });
    objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
    let output = '%PDF-1.4\n%Scoops\n';
    const offsets = [0];
    objects.forEach((content, index) => {
      offsets.push(Buffer.byteLength(output, 'binary'));
      output += `${index + 1} 0 obj\n${content}\nendobj\n`;
    });
    const xref = Buffer.byteLength(output, 'binary');
    output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objects.length; i++) output += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    output += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(output, 'binary');
  }
}

function createProgressReportPdf(rawReport) {
  const report = normalizeProgressReport(rawReport);
  const pdf = new SimplePdfDocument();
  let y;
  const margin = 44;
  const contentWidth = pdf.width - margin * 2;

  function startPage(showTitle = true) {
    pdf.addPage();
    pdf.centered(748, 'Scoops', 28, true, '#7c5cbf');
    if (showTitle) {
      pdf.centered(714, `${report.childName}'s Progress Report`, 20, true, '#6748ad');
      pdf.centered(693, `${report.periodLabel}${report.startDate ? ` | ${report.startDate} - ${report.endDate}` : ''}`, 10, true, '#666666');
      y = 660;
    } else {
      pdf.centered(714, `${report.childName}'s Scoops Progress - continued`, 15, true, '#6748ad');
      y = 680;
    }
  }

  function ensure(space = 60) {
    if (y - space < 55) startPage(false);
  }

  function section(title, background = '#ffffff', border = '#d9cbed') {
    ensure(46);
    pdf.fillRect(margin, y - 28, contentWidth, 32, background);
    pdf.strokeRect(margin, y - 28, contentWidth, 32, border, 1.2);
    pdf.text(margin + 12, y - 17, title, 13, true, '#6748ad');
    y -= 43;
  }

  function paragraph(text, bold = false, color = '#444444') {
    ensure(45);
    y = pdf.paragraph(margin + 8, y, text, contentWidth - 16, 10.5, 14, color, bold) - 6;
  }

  function bullet(text) {
    ensure(36);
    pdf.text(margin + 10, y, '-', 10.5, true, '#6748ad');
    y = pdf.paragraph(margin + 24, y, text, contentWidth - 32, 10.5, 14, '#444444', false) - 4;
  }

  startPage(true);
  pdf.fillRect(margin, y - 55, contentWidth, 58, '#f8f5fc');
  pdf.strokeRect(margin, y - 55, contentWidth, 58, '#b39ddb', 1.2);
  pdf.text(margin + 14, y - 18, report.comparison.overallDirection || 'Current progress', 13, true, '#6748ad');
  pdf.paragraph(margin + 14, y - 36, report.comparison.overallMessage || 'This report summarizes the selected period.', contentWidth - 28, 9.5, 12, '#555555');
  y -= 72;

  const metrics = [
    [`${report.minutes}`, 'Learning minutes', comparisonLine(report.comparison.metrics.minutes)],
    [`${report.lessons}`, 'Lessons completed', comparisonLine(report.comparison.metrics.lessons)],
    [report.quizCount ? `${report.quizAverage}%` : 'No score', 'Quiz average', comparisonLine(report.comparison.metrics.quizAverage)],
    [`${report.stories}`, 'Stories created', comparisonLine(report.comparison.metrics.stories)],
    [report.strongestArea, 'Strongest area', 'Current period'],
    [report.priorityArea, 'Priority area', report.growthFocus?.score != null ? `${report.growthFocus.score}% average` : 'More data needed']
  ];
  const cardW = (contentWidth - 18) / 3;
  metrics.forEach((metric, i) => {
    if (i === 3) y -= 82;
    const col = i % 3;
    const x = margin + col * (cardW + 9);
    const top = y;
    pdf.fillRect(x, top - 68, cardW, 68, '#ffffff');
    pdf.strokeRect(x, top - 68, cardW, 68, ['#b39ddb','#f4a7b9','#81c784','#ffd54f','#64b5f6','#ffb74d'][i], 1.3);
    pdf.centeredText = null;
    const value = String(metric[0]);
    const valueWidth = value.length * 14 * 0.56;
    pdf.text(x + Math.max(8, (cardW - valueWidth) / 2), top - 22, value, 14, true, '#5f469d');
    const labelWidth = String(metric[1]).length * 8.5 * 0.51;
    pdf.text(x + Math.max(8, (cardW - labelWidth) / 2), top - 39, metric[1], 8.5, true, '#666666');
    const secondary = pdf.wrap(metric[2], cardW - 16, 7.5);
    secondary.slice(0, 2).forEach((line, lineIndex) => pdf.text(x + 8, top - 53 - lineIndex * 9, line, 7.5, false, '#777777'));
  });
  y -= 88;

  section('Learning-path progress', '#fcfaff', '#e0d4f7');
  const areaColors = { phonics: '#9b7bd2', vocabulary: '#ffb74d', spelling: '#81c784', comprehension: '#64b5f6' };
  for (const key of ['phonics', 'vocabulary', 'spelling', 'comprehension']) {
    const item = report.categoryDetails[key];
    ensure(70);
    pdf.text(margin + 8, y, item.area, 11, true, '#444444');
    pdf.text(margin + contentWidth - 52, y, item.attempts ? `${item.score}%` : 'N/A', 11, true, '#444444');
    pdf.fillRect(margin + 8, y - 17, contentWidth - 16, 9, '#eeeeee');
    if (item.attempts) pdf.fillRect(margin + 8, y - 17, (contentWidth - 16) * item.score / 100, 9, areaColors[key]);
    pdf.text(margin + 8, y - 34, item.status, 9, true, '#765213');
    pdf.text(margin + 8, y - 48, `Based on ${item.attempts} completed assessment${item.attempts === 1 ? '' : 's'}; ${item.belowTarget} below the 75% target.`, 8.5, false, '#666666');
    y -= 65;
  }
  paragraph('Assessment counts show how many completed quizzes were used to calculate each average. They are not a count of failed assessments.', false, '#777777');

  section('Reading Detective insight', '#f0f7fc', '#b0cde5');
  if (!report.readingProfile.attempts) {
    paragraph('No completed Reading Detective passage was recorded during this period.');
  } else {
    const readingRate = report.readingProfile.latestMode === 'independent' && report.readingProfile.latestWordsPerMinute
      ? `${report.readingProfile.latestWordsPerMinute} words per minute - ${report.readingProfile.latestPace || 'pace not classified'}`
      : `${report.readingProfile.latestMode === 'mixed' ? 'Mixed independent and read-aloud use' : 'Read-aloud assisted'} - independent rate not scored`;
    bullet(`Latest passage rate: ${readingRate}`);
    if (report.readingProfile.latestTotalActivitySeconds) {
      bullet(`Timing: initial reading checkpoint ${formatReportDuration(report.readingProfile.latestInitialReadingSeconds)}; full activity ${formatReportDuration(report.readingProfile.latestTotalActivitySeconds)}; questions and rereading ${formatReportDuration(report.readingProfile.latestQuestionReviewSeconds)}.`);
    }
    bullet(`Understanding: ${report.readingProfile.latestComprehension || 'Not available'}${report.readingProfile.latestComprehensionPercent != null ? ` - ${report.readingProfile.latestComprehensionPercent}%` : ''}`);
    bullet(`Pattern: ${report.readingProfile.latestPattern || 'More completed passages are needed to identify a stable pattern.'}`);
    bullet(`Highlighting: ${report.readingProfile.averageHighlightCount || 0} important section${report.readingProfile.averageHighlightCount === 1 ? '' : 's'} per passage on average.`);
    paragraph('Reading-rate patterns should be reviewed across several completed passages and are not diagnostic.', false, '#667788');
  }

  section('Compared with the preceding period', '#f8f5fc', '#d9cbed');
  paragraph(`${report.comparison.overallDirection}: ${report.comparison.overallMessage}`, true);
  if (report.comparison.available) {
    bullet(`Learning minutes: ${comparisonLine(report.comparison.metrics.minutes)}`);
    bullet(`Lessons completed: ${comparisonLine(report.comparison.metrics.lessons)}`);
    bullet(`Quiz average: ${comparisonLine(report.comparison.metrics.quizAverage)}`);
    bullet(`Stories created: ${comparisonLine(report.comparison.metrics.stories)}`);
  }

  section('What the results show', '#ffffff', '#e0d4f7');
  const useful = report.mistakeDetails.filter(item => item.attempts || item.missed);
  if (!useful.length) paragraph('Question-level results have not been recorded yet. New quizzes will identify specific missed words, answers, and repeated skill patterns.');
  useful.forEach(item => {
    paragraph(`${item.area}: ${item.summary}`, true);
    if (item.repeatedSkills?.length) bullet(`Repeated pattern: ${item.repeatedSkills.map(entry => `${entry.skill} (${entry.count})`).join(', ')}`);
    if (item.missedItems?.length) bullet(`Frequently missed: ${item.missedItems.map(entry => `${entry.item}${entry.count > 1 ? ` (${entry.count} times)` : ''}`).join(', ')}`);
    if (item.examples?.[0]) bullet(`Example: ${item.examples[0].question}; selected '${item.examples[0].selectedAnswer}', correct answer '${item.examples[0].correctAnswer}'.`);
  });

  section('What went well', '#fffdf4', '#ffe082');
  (report.highlights.length ? report.highlights : ['Learning activity will appear here as the child uses Scoops.']).forEach(bullet);

  section('Where improvement is needed', '#fff9eb', '#f0c477');
  if (report.improvementAreas.length) report.improvementAreas.forEach(item => bullet(`${item.area}: ${item.score}% - ${item.status}. ${item.message}`));
  else bullet('No assessed area is currently below the 75% target. Scoops will continue watching for declining results and repeated mistake patterns.');
  if (report.unassessedAreas.length) bullet(`Not assessed during this period: ${report.unassessedAreas.join(', ')}. Missing activity is not treated as a failing score.`);

  if (y < 190) startPage(false);
  section('Recommended next step', '#edf8ee', '#a5d6a7');
  paragraph(report.nextStep, false, '#3f5140');

  pdf.pages.forEach((page, index) => {
    const saved = pdf.current;
    pdf.current = page;
    pdf.line(44, 38, 568, 38, '#cfdde4', 0.7);
    pdf.text(44, 24, `Scoops browser activity | ${PDF_TEMPLATE_VERSION}`, 7.5, false, '#777777');
    pdf.text(530, 24, `${index + 1}/${pdf.pages.length}`, 7.5, false, '#777777');
    pdf.current = saved;
  });

  return { buffer: pdf.build(), filename: reportPdfFilename(report), report };
}

function comparisonLine(item) {
  return item?.available ? item.text : 'Not enough earlier data';
}

function reportMetricCard(value, label, accent, secondary = 'Current period') {
  return `<td class="scoops-metric-cell" width="33.33%" style="width:33.33%;padding:4px;vertical-align:top;">
    <div style="padding:11px 7px 9px;text-align:center;background:#ffffff;border:2px solid ${accent};border-radius:14px;min-height:92px;box-sizing:border-box;">
      <div style="font-size:21px;font-weight:900;color:#5f469d;line-height:1.08;overflow-wrap:anywhere;">${escapeHtml(value)}</div>
      <div style="margin-top:5px;font-size:10px;font-weight:900;color:#666;line-height:1.25;text-transform:none;">${escapeHtml(label)}</div>
      <div style="margin-top:7px;padding-top:6px;border-top:1px solid #eeeeee;font-size:9.5px;font-weight:800;color:#6c6c6c;line-height:1.3;">${escapeHtml(secondary)}</div>
    </div>
  </td>`;
}

function reportProgressRow(label, detail, fill) {
  const percentage = Math.max(0, Math.min(100, Number(detail?.score) || 0));
  const attempts = Math.max(0, Math.round(Number(detail?.attempts) || 0));
  const belowTarget = Math.max(0, Math.round(Number(detail?.belowTarget) || 0));
  const filledWidth = attempts > 0 ? percentage : 0;
  const status = String(detail?.status || progressStatus(percentage, attempts).label);
  const tone = String(detail?.tone || progressStatus(percentage, attempts).tone);
  const statusColor = ({ urgent: '#915b00', focus: '#9f5c18', developing: '#6748ad', track: '#397140', none: '#707070' })[tone] || '#6748ad';
  const fillBar = filledWidth > 0
    ? `<table role="presentation" align="left" width="${filledWidth}%" cellspacing="0" cellpadding="0" border="0" style="width:${filledWidth}%;height:11px;border-collapse:separate;border-spacing:0;margin:0 auto 0 0;mso-table-lspace:0;mso-table-rspace:0;float:left;"><tr><td height="11" bgcolor="${fill}" style="height:11px;padding:0;background:${fill};border-radius:999px;font-size:0;line-height:0;">&nbsp;</td></tr></table>`
    : '&nbsp;';
  return `<div style="margin:0 0 16px;text-align:left;direction:ltr;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;margin:0 0 6px;mso-table-lspace:0;mso-table-rspace:0;">
      <tr><td align="left" style="font-size:13px;font-weight:900;color:#444;text-align:left;">${escapeHtml(label)}</td><td align="right" style="font-size:13px;font-weight:900;color:#444;text-align:right;white-space:nowrap;">${attempts > 0 ? `${percentage}%` : 'No score yet'}</td></tr>
    </table>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#eeeeee" style="width:100%;height:11px;border-collapse:separate;border-spacing:0;background:#eeeeee;border-radius:999px;overflow:hidden;margin:0;mso-table-lspace:0;mso-table-rspace:0;"><tr><td align="left" valign="middle" style="height:11px;padding:0;text-align:left;font-size:0;line-height:0;">${fillBar}</td></tr></table>
    <div style="clear:both;margin-top:6px;font-size:11px;font-weight:900;text-align:left;color:${statusColor};">${escapeHtml(status)}</div>
    <div style="margin-top:3px;font-size:11px;font-weight:700;line-height:1.45;color:#666;">Based on ${attempts} completed assessment${attempts === 1 ? '' : 's'}.</div>
    ${attempts ? `<div style="margin-top:2px;font-size:11px;font-weight:700;line-height:1.45;color:#666;">${belowTarget} of ${attempts} were below the 75% target.</div>` : ''}
    <div style="margin-top:2px;font-size:11px;font-weight:700;line-height:1.45;color:#666;">${escapeHtml(comparisonLine(detail?.comparison))}</div>
  </div>`;
}

function reportComparisonCell(label, item) {
  return `<td width="50%" style="padding:4px;vertical-align:top;"><div style="padding:10px 11px;background:#ffffff;border:1px solid #e6e1ec;border-radius:12px;font-size:11px;line-height:1.45;color:#555;"><strong style="display:block;margin-bottom:2px;color:#6748ad;">${escapeHtml(label)}</strong>${escapeHtml(comparisonLine(item))}</div></td>`;
}

function formatReportDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds || 0)));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function reportReadingDetectiveHtml(profile) {
  if (!profile?.attempts) return `<div style="font-size:12px;line-height:1.55;color:#555;">No completed Reading Detective passage was recorded during this period.</div>`;
  const rate = profile.latestMode === 'independent' && profile.latestWordsPerMinute
    ? `${profile.latestWordsPerMinute} words per minute · ${profile.latestPace || 'pace not classified'}`
    : `${profile.latestMode === 'mixed' ? 'Mixed independent and read-aloud use' : 'Read-aloud assisted'} · independent rate not scored`;
  const comprehension = `${profile.latestComprehension || 'Not available'}${profile.latestComprehensionPercent != null ? ` · ${profile.latestComprehensionPercent}%` : ''}`;
  const timing = profile.latestTotalActivitySeconds
    ? `Initial reading checkpoint ${formatReportDuration(profile.latestInitialReadingSeconds)} · full passage activity ${formatReportDuration(profile.latestTotalActivitySeconds)} · questions and rereading ${formatReportDuration(profile.latestQuestionReviewSeconds)}`
    : 'Timing will appear after the next completed passage.';
  return `<div style="font-size:12px;line-height:1.65;color:#444;"><strong>Latest passage rate:</strong> ${escapeHtml(rate)}<br><strong>Timing:</strong> ${escapeHtml(timing)}<br><strong>Understanding:</strong> ${escapeHtml(comprehension)}<br><strong>Pattern:</strong> ${escapeHtml(profile.latestPattern || 'More attempts are needed to identify a stable pattern.')}<br><strong>Highlighting:</strong> ${escapeHtml(profile.averageHighlightCount || 0)} important section${Number(profile.averageHighlightCount || 0) === 1 ? '' : 's'} per completed passage on average.</div><div style="margin-top:8px;font-size:10px;line-height:1.45;color:#667;">The initial checkpoint and full activity time are recorded separately so question work and rereading are not mistaken for initial reading speed. Reading-rate patterns should be reviewed across several passages and are not diagnostic.</div>`;
}

function reportMistakeHtml(detail) {
  if (!detail || (!detail.attempts && !detail.missed)) return '';
  const repeated = detail.repeatedSkills?.length
    ? `<div style="margin-top:5px;"><strong>Repeated pattern:</strong> ${detail.repeatedSkills.map(item => `${escapeHtml(item.skill)} (${item.count})`).join(', ')}</div>` : '';
  const missed = detail.missedItems?.length
    ? `<div style="margin-top:5px;"><strong>Frequently missed:</strong> ${detail.missedItems.map(item => `${escapeHtml(item.item)}${item.count > 1 ? ` (${item.count} times)` : ''}`).join(', ')}</div>` : '';
  const example = detail.examples?.[0]
    ? `<div style="margin-top:5px;"><strong>Example:</strong> ${escapeHtml(detail.examples[0].question)} — chose “${escapeHtml(detail.examples[0].selectedAnswer)}”; correct answer: “${escapeHtml(detail.examples[0].correctAnswer)}”.</div>` : '';
  return `<div style="margin-top:10px;padding:12px 13px;background:#fcfaff;border:1px solid #e0d4f7;border-radius:13px;font-size:13px;line-height:1.6;color:#49404e;"><strong style="display:block;margin-bottom:3px;color:#6748ad;">${escapeHtml(detail.area)}</strong>${escapeHtml(detail.summary)}${repeated}${missed}${example}</div>`;
}

function storeReportDownload(pdfDocument) {
  const token = crypto.randomBytes(18).toString('hex');
  const now = Date.now();
  for (const [key, value] of reportDownloads.entries()) {
    if (!value || value.expiresAt <= now) reportDownloads.delete(key);
  }
  reportDownloads.set(token, {
    buffer: pdfDocument.buffer,
    filename: pdfDocument.filename,
    expiresAt: now + REPORT_DOWNLOAD_TTL_MS
  });
  return token;
}

function reportDownloadUrl(token) {
  return `http://localhost:${PORT}/api/reports/download/${encodeURIComponent(token)}`;
}

function reportMistakeCell(detail) {
  if (!detail || (!detail.attempts && !detail.missed)) {
    return `<td class="scoops-two-col" width="50%" style="width:50%;padding:4px;vertical-align:top;"><div style="height:100%;padding:13px;background:#fcfaff;border:1px solid #e0d4f7;border-radius:13px;font-size:12px;line-height:1.55;color:#555;"><strong style="display:block;margin-bottom:5px;color:#6748ad;">Not assessed</strong>Question-level results have not been recorded for this area yet.</div></td>`;
  }
  const repeated = detail.repeatedSkills?.length
    ? `<div style="margin-top:6px;"><strong>Repeated pattern:</strong> ${detail.repeatedSkills.map(item => `${escapeHtml(item.skill)} (${item.count})`).join(', ')}</div>` : '';
  const missed = detail.missedItems?.length
    ? `<div style="margin-top:6px;"><strong>Frequently missed:</strong> ${detail.missedItems.map(item => `${escapeHtml(item.item)}${item.count > 1 ? ` (${item.count} times)` : ''}`).join(', ')}</div>` : '';
  const example = detail.examples?.[0]
    ? `<div style="margin-top:6px;"><strong>Example:</strong> ${escapeHtml(detail.examples[0].question)}<br><span style="color:#6b6370;">Selected “${escapeHtml(detail.examples[0].selectedAnswer)}”; correct answer “${escapeHtml(detail.examples[0].correctAnswer)}”.</span></div>` : '';
  return `<td class="scoops-two-col" width="50%" style="width:50%;padding:4px;vertical-align:top;"><div style="height:100%;padding:13px;background:#fcfaff;border:1px solid #e0d4f7;border-radius:13px;font-size:12px;line-height:1.55;color:#49404e;box-sizing:border-box;"><strong style="display:block;margin-bottom:5px;color:#6748ad;font-size:13px;">${escapeHtml(detail.area)}</strong>${escapeHtml(detail.summary)}${repeated}${missed}${example}</div></td>`;
}

async function sendProgressReportEmail(email, rawReport, automatic = false) {
  const report = normalizeProgressReport(rawReport);
  const pdfDocument = createProgressReportPdf(report);
  const downloadToken = storeReportDownload(pdfDocument);
  const downloadUrl = reportDownloadUrl(downloadToken);
  const safeName = escapeHtml(report.childName);
  const dateRange = report.startDate ? `${escapeHtml(report.startDate)} – ${escapeHtml(report.endDate)}` : escapeHtml(report.periodLabel);
  const highlights = report.highlights.length ? report.highlights : ['Learning activity will appear here as the child uses Scoops.'];
  const comparison = report.comparison;
  const priorityDetail = Object.values(report.categoryDetails).find(item => item.area === report.priorityArea) || report.growthFocus;
  const strongestDetail = Object.values(report.categoryDetails).find(item => item.area === report.strongestArea);
  const prioritySecondary = priorityDetail?.attempts ? `${priorityDetail.score}% average` : 'More data needed';
  const strongestSecondary = strongestDetail?.attempts ? `${strongestDetail.score}% average` : 'More data needed';

  const improvementText = report.improvementAreas.length
    ? ['Where improvement is needed:', ...report.improvementAreas.map(item => `• ${item.area}: ${item.score}% — ${item.status}. ${item.message}`)]
    : ['Where improvement is needed:', '• No assessed area is currently below the 75% target. Scoops will continue watching for declining patterns or repeated mistakes.'];
  if (report.unassessedAreas.length) improvementText.push(`Not yet assessed in this period: ${report.unassessedAreas.join(', ')}.`);

  const detailedText = report.mistakeDetails.filter(item => item.attempts || item.missed).map(item => {
    const pieces = [item.summary];
    if (item.repeatedSkills?.length) pieces.push(`Repeated pattern: ${item.repeatedSkills.map(entry => `${entry.skill} (${entry.count})`).join(', ')}`);
    if (item.missedItems?.length) pieces.push(`Frequently missed: ${item.missedItems.map(entry => `${entry.item}${entry.count > 1 ? ` (${entry.count} times)` : ''}`).join(', ')}`);
    if (item.examples?.[0]) pieces.push(`Example: ${item.examples[0].question}; selected '${item.examples[0].selectedAnswer}', correct answer '${item.examples[0].correctAnswer}'.`);
    return `${item.area}: ${pieces.join(' ')}`;
  });

  const text = [
    'SCOOPS PROGRESS REPORT',
    `${report.childName} — ${report.periodLabel}`,
    report.startDate ? `${report.startDate} through ${report.endDate}` : '',
    '',
    `Download the PDF: ${downloadUrl}`,
    '',
    `Learning minutes: ${report.minutes}`,
    `Lessons completed: ${report.lessons}`,
    `Quiz average: ${report.quizCount ? `${report.quizAverage}% across ${report.quizCount} quiz${report.quizCount === 1 ? '' : 'zes'}` : 'Not assessed'}`,
    `Stories created or updated: ${report.stories}`,
    `Activity streak: ${report.streak} day${report.streak === 1 ? '' : 's'}`,
    `Strongest area: ${report.strongestArea}`,
    `Priority area: ${report.priorityArea}`,
    '',
    'Learning-path progress:',
    ...Object.values(report.categoryDetails).flatMap(item => [
      `${item.area}: ${item.attempts ? `${item.score}% — ${item.status}` : 'Not assessed'}`,
      `Based on ${item.attempts} completed assessment${item.attempts === 1 ? '' : 's'}.`,
      item.attempts ? `${item.belowTarget} of ${item.attempts} were below the 75% target.` : '',
      comparisonLine(item.comparison)
    ]).filter(Boolean),
    '',
    'What the results show:',
    ...(detailedText.length ? detailedText.map(line => `• ${line}`) : ['• Question-level results have not been recorded yet.']),
    '',
    'What went well:',
    ...highlights.map(item => `• ${item}`),
    '',
    ...improvementText,
    '',
    `Recommended next step: ${report.nextStep}`,
    '',
    `This report was generated from ${report.dataSource}.`,
    automatic ? 'This was an automatic weekly progress report.' : 'This report was requested from the Scoops Parent Section.',
    '',
    'Happy reading and creating,',
    'The Scoops Team'
  ].filter(line => line !== '').join('\n');

  const improvementHtml = report.improvementAreas.length
    ? `<ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.6;color:#51452f;">${report.improvementAreas.map(item => `<li style="margin-bottom:7px;"><strong>${escapeHtml(item.area)}: ${item.score}% — ${escapeHtml(item.status)}</strong><br>${escapeHtml(item.message)}</li>`).join('')}</ul>`
    : `<div style="font-size:12px;line-height:1.6;color:#51452f;">No assessed area is currently below the 75% target. Scoops will continue watching for declining results and repeated mistake patterns.</div>`;
  const unassessedHtml = report.unassessedAreas.length
    ? `<div style="margin-top:9px;padding-top:9px;border-top:1px solid #e4d2a6;font-size:11px;line-height:1.5;color:#6c6048;"><strong>Not yet assessed:</strong> ${escapeHtml(report.unassessedAreas.join(', '))}. Missing activity is not treated as a failing score.</div>` : '';

  const card = `<div style="overflow:hidden;background:#ffffff;border:3px solid #b39ddb;border-radius:24px;box-shadow:0 9px 26px rgba(84,64,115,.15);">
    <div style="padding:23px 25px 20px;background:linear-gradient(135deg,#f3eeff,#fce4ec);border-bottom:2px solid #e0d4f7;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;">
        <tr>
          <td class="scoops-two-col" width="72%" style="width:72%;vertical-align:middle;">
            <div style="font-size:11px;font-weight:900;letter-spacing:1px;text-transform:uppercase;color:#7c5cbf;">Scoops learning report</div>
            <h1 style="margin:6px 0 5px;font-size:29px;line-height:1.1;color:#6748ad;">${safeName}’s progress</h1>
            <div style="font-size:13px;font-weight:700;color:#666;">${escapeHtml(report.periodLabel)} · ${dateRange}</div>
          </td>
          <td class="scoops-two-col" width="28%" align="right" style="width:28%;vertical-align:middle;text-align:right;">
            <a class="scoops-download-link" href="${escapeHtml(downloadUrl)}" target="_blank" style="display:inline-block;padding:10px 14px;background:#6748ad;border:2px solid #6748ad;border-radius:999px;color:#ffffff;text-decoration:none;font-size:13px;font-weight:900;line-height:1;white-space:nowrap;">Download&nbsp;<span aria-hidden="true" style="font-size:17px;vertical-align:-1px;">⇩</span></a>
          </td>
        </tr>
      </table>
      <div style="display:inline-block;margin-top:14px;padding:9px 17px;background:#ffffff;border:3px solid #b39ddb;border-radius:999px;font-family:'Fredoka One','Arial Rounded MT Bold','Trebuchet MS',Arial,sans-serif;font-size:18px;font-weight:400;letter-spacing:.2px;color:#6748ad;line-height:1.05;">${escapeHtml(comparison.overallDirection)}</div>
    </div>

    <div style="padding:20px 20px 24px;">
      <p style="margin:0 0 13px;font-size:14px;line-height:1.55;">This report shows what is improving, what is moving in the wrong direction, and the exact skills or quiz items that may need more practice.</p>

      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;margin:0 -4px 14px;width:calc(100% + 8px);">
        <tr>
          ${reportMetricCard(report.minutes, 'learning minutes', '#b39ddb', comparisonLine(comparison.metrics.minutes))}
          ${reportMetricCard(report.lessons, 'lessons completed', '#f4a7b9', comparisonLine(comparison.metrics.lessons))}
          ${reportMetricCard(report.quizCount ? `${report.quizAverage}%` : 'No score', 'quiz average', '#81c784', comparisonLine(comparison.metrics.quizAverage))}
        </tr>
        <tr>
          ${reportMetricCard(report.stories, 'stories created', '#ffd54f', comparisonLine(comparison.metrics.stories))}
          ${reportMetricCard(report.strongestArea, 'strongest area', '#64b5f6', strongestSecondary)}
          ${reportMetricCard(report.priorityArea, 'priority area', '#ffb74d', prioritySecondary)}
        </tr>
      </table>

      <div style="margin:0 0 14px;padding:14px 15px;background:#f8f5fc;border:2px solid #d9cbed;border-radius:16px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;margin:0 0 9px;">
          <tr>
            <td style="vertical-align:middle;">
              <div style="font-size:15px;font-weight:900;color:#6748ad;">Compared with the preceding period</div>
            </td>
            <td align="right" style="vertical-align:middle;text-align:right;">
              <span style="display:inline-block;padding:5px 10px;background:#ffffff;border:1px solid #cbb9e5;border-radius:999px;font-size:10.5px;font-weight:900;color:#6748ad;">${escapeHtml(comparison.overallDirection)}</span>
            </td>
          </tr>
        </table>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:separate;margin:0 -3px 8px;width:calc(100% + 6px);">
          <tr>
            <td class="scoops-comparison-cell" width="25%" style="width:25%;padding:3px;vertical-align:top;"><div style="padding:9px 10px;background:#ffffff;border:1px solid #e3daef;border-radius:12px;font-size:10.5px;line-height:1.4;color:#555;"><strong style="display:block;margin-bottom:2px;color:#6748ad;">Learning minutes</strong>${escapeHtml(comparisonLine(comparison.metrics.minutes))}</div></td>
            <td class="scoops-comparison-cell" width="25%" style="width:25%;padding:3px;vertical-align:top;"><div style="padding:9px 10px;background:#ffffff;border:1px solid #e3daef;border-radius:12px;font-size:10.5px;line-height:1.4;color:#555;"><strong style="display:block;margin-bottom:2px;color:#6748ad;">Lessons</strong>${escapeHtml(comparisonLine(comparison.metrics.lessons))}</div></td>
            <td class="scoops-comparison-cell" width="25%" style="width:25%;padding:3px;vertical-align:top;"><div style="padding:9px 10px;background:#ffffff;border:1px solid #e3daef;border-radius:12px;font-size:10.5px;line-height:1.4;color:#555;"><strong style="display:block;margin-bottom:2px;color:#6748ad;">Quiz average</strong>${escapeHtml(comparisonLine(comparison.metrics.quizAverage))}</div></td>
            <td class="scoops-comparison-cell" width="25%" style="width:25%;padding:3px;vertical-align:top;"><div style="padding:9px 10px;background:#ffffff;border:1px solid #e3daef;border-radius:12px;font-size:10.5px;line-height:1.4;color:#555;"><strong style="display:block;margin-bottom:2px;color:#6748ad;">Stories</strong>${escapeHtml(comparisonLine(comparison.metrics.stories))}</div></td>
          </tr>
        </table>
        <div style="font-size:11.5px;line-height:1.5;color:#555;">${escapeHtml(comparison.overallMessage)}</div>
      </div>

      <div style="margin:0 0 14px;padding:15px;background:#fcfaff;border:2px solid #e0d4f7;border-radius:16px;">
        <div style="margin-bottom:10px;font-size:15px;font-weight:900;color:#6748ad;">Learning-path progress</div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:separate;margin:0 -6px;width:calc(100% + 12px);">
          <tr>
            <td class="scoops-two-col" width="50%" style="width:50%;padding:6px;vertical-align:top;">${reportProgressRow(report.categoryDetails.phonics?.area || 'Phonics', report.categoryDetails.phonics, '#9b7bd2')}</td>
            <td class="scoops-two-col" width="50%" style="width:50%;padding:6px;vertical-align:top;">${reportProgressRow('Vocabulary Vault', report.categoryDetails.vocabulary, '#ffb74d')}</td>
          </tr>
          <tr>
            <td class="scoops-two-col" width="50%" style="width:50%;padding:6px;vertical-align:top;">${reportProgressRow('Spelling Bee', report.categoryDetails.spelling, '#81c784')}</td>
            <td class="scoops-two-col" width="50%" style="width:50%;padding:6px;vertical-align:top;">${reportProgressRow('Reading Detective', report.categoryDetails.comprehension, '#64b5f6')}</td>
          </tr>
        </table>
        <div style="margin-top:2px;font-size:10px;line-height:1.45;color:#777;">Assessment counts show how many completed quizzes were used to calculate each average, not a number of failed assessments.</div>
      </div>

      <div style="margin:0 0 14px;padding:15px;background:#f0f7fc;border:2px solid #b0cde5;border-radius:16px;">
        <div style="margin-bottom:7px;font-size:15px;font-weight:900;color:#375c7d;">Reading Detective insight</div>
        ${reportReadingDetectiveHtml(report.readingProfile)}
      </div>

      <div style="margin:0 0 14px;padding:15px;background:#ffffff;border:2px solid #e0d4f7;border-radius:16px;">
        <div style="margin-bottom:4px;font-size:15px;font-weight:900;color:#6748ad;">What the results show</div>
        <div style="margin-bottom:8px;font-size:11px;line-height:1.5;color:#666;">Scoops records the skill, word or question, selected answer, correct answer, and whether the same difficulty appears again.</div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:separate;margin:0 -4px;width:calc(100% + 8px);">
          <tr>
            ${reportMistakeCell(report.categoryDetails.phonics?.findings || report.mistakeDetails.find(item => item.area === report.categoryDetails.phonics?.area))}
            ${reportMistakeCell(report.categoryDetails.vocabulary?.findings || report.mistakeDetails.find(item => item.area === 'Vocabulary'))}
          </tr>
          <tr>
            ${reportMistakeCell(report.categoryDetails.spelling?.findings || report.mistakeDetails.find(item => item.area === 'Spelling'))}
            ${reportMistakeCell(report.categoryDetails.comprehension?.findings || report.mistakeDetails.find(item => item.area === 'Reading Detective'))}
          </tr>
        </table>
      </div>

      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:separate;margin:0 -5px 14px;width:calc(100% + 10px);">
        <tr>
          <td class="scoops-two-col" width="40%" style="width:40%;padding:5px;vertical-align:top;">
            <div style="height:100%;padding:15px;background:#fffdf4;border:2px solid #ffe082;border-radius:16px;box-sizing:border-box;">
              <div style="margin-bottom:7px;font-size:15px;font-weight:900;color:#765a00;">What went well</div>
              <ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.6;color:#444;">${highlights.map(item => `<li style="margin-bottom:5px;">${escapeHtml(item)}</li>`).join('')}</ul>
            </div>
          </td>
          <td class="scoops-two-col" width="60%" style="width:60%;padding:5px;vertical-align:top;">
            <div style="height:100%;padding:15px;background:#fff9eb;border:2px solid #f0c477;border-radius:16px;box-sizing:border-box;">
              <div style="margin-bottom:7px;font-size:15px;font-weight:900;color:#765213;">Where improvement is needed</div>
              ${improvementHtml}${unassessedHtml}
            </div>
          </td>
        </tr>
      </table>

      <div style="margin:0 0 14px;padding:15px 17px;background:#edf8ee;border:2px solid #a5d6a7;border-radius:16px;">
        <div style="margin-bottom:5px;font-size:15px;font-weight:900;color:#2e7d32;">Recommended next step</div>
        <div style="font-size:13px;line-height:1.6;color:#3f5140;">${escapeHtml(report.nextStep)}</div>
      </div>

      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;"><tr><td style="font-size:12px;line-height:1.55;color:#444;">The goal is not only to celebrate completed work, but to use the results to guide what ${safeName} practices next.</td><td align="right" style="font-size:12px;line-height:1.5;text-align:right;white-space:nowrap;"><strong>Happy reading and creating,<br>The Scoops Team</strong></td></tr></table>
      <div style="margin-top:17px;padding-top:12px;border-top:1px solid #eeeeee;font-size:10px;line-height:1.5;color:#777;">${automatic ? 'This automatic weekly report' : 'This requested report'} was generated from ${escapeHtml(report.dataSource)}. Local Mailpit development email · Template ${REPORT_TEMPLATE_VERSION}. Weekly reports can be turned off in the Scoops Parent Section.</div>
    </div>
  </div>`;

  const html = brandedEmailShell(card, 930);
  await smtpSend({
    to: email,
    subject: `${report.childName}'s Scoops progress — ${report.periodLabel}`,
    text,
    html,
    attachments: [{ filename: pdfDocument.filename, contentType: 'application/pdf', content: pdfDocument.buffer }]
  });
  return { ...report, pdfFilename: pdfDocument.filename, downloadUrl };
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

function sendPdf(response, status, buffer, filename) {
  const safeFilename = sanitizeAttachmentFilename(filename || 'Scoops_Progress_Report.pdf');
  response.writeHead(status, {
    'Content-Type': 'application/pdf',
    'Content-Length': buffer.length,
    'Content-Disposition': `attachment; filename="${safeFilename}"`,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Expose-Headers': 'Content-Disposition'
  });
  response.end(buffer);
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
      if (body.length > 750_000) {
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

  if (pathname === '/api/reports/pdf') {
    try {
      const pdfDocument = createProgressReportPdf(body.report);
      return sendPdf(response, 200, pdfDocument.buffer, pdfDocument.filename);
    } catch (error) {
      console.error(error);
      return sendJson(response, 400, { error: error.message || 'Could not create the PDF report.' });
    }
  }

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

    if (pathname === '/api/reports/send') {
      const report = await sendProgressReportEmail(email, body.report, Boolean(body.automatic));
      return sendJson(response, 200, { ok: true, sent: true, periodLabel: report.periodLabel, pdfAttached: true, pdfFilename: report.pdfFilename });
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
      mailpitSmtp: `${MAILPIT_SMTP_HOST}:${MAILPIT_SMTP_PORT}`,
      build: SCOOPS_BUILD,
      welcomeTemplate: WELCOME_TEMPLATE_VERSION,
      reportTemplate: REPORT_TEMPLATE_VERSION,
      pdfTemplate: PDF_TEMPLATE_VERSION,
      adaptiveLearning: 'setup-diagnostic-wordbuilder-reading-detective-v2',
      emailLayout: 'wide-landscape-three-by-two',
      reportDownloadLink: true
    });
  }

  if (request.method === 'GET' && pathname.startsWith('/api/reports/download/')) {
    const token = decodeURIComponent(pathname.slice('/api/reports/download/'.length));
    const record = reportDownloads.get(token);
    if (!record || Date.now() > record.expiresAt) {
      if (record) reportDownloads.delete(token);
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      return response.end('This report download is no longer available. Request a new report from the Scoops Parent Section.');
    }
    return sendPdf(response, 200, record.buffer, record.filename);
  }

  if (pathname.startsWith('/api/')) return handleApi(request, response, pathname);

  if (pathname === '/mailpit') {
    response.writeHead(302, { Location: 'http://localhost:8025' });
    return response.end();
  }

  if (pathname === '/' || pathname === '/index.html' || pathname === '/scoops_mailpit_connected.html') {
    return serveStaticFile(request, response, HTML_FILE);
  }

  if (request.method === 'GET' || request.method === 'HEAD') {
    const staticFile = findStaticFile(pathname);
    if (staticFile) return serveStaticFile(request, response, staticFile);
  }

  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end('Not found');
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`Scoops:  http://localhost:${PORT}`);
    console.log(`Serving: ${path.basename(HTML_FILE)}`);
    console.log('Mailpit: http://localhost:8025');
    console.log(`SMTP:   ${MAILPIT_SMTP_HOST}:${MAILPIT_SMTP_PORT}`);
    console.log(`Build:  ${SCOOPS_BUILD}`);
    console.log(`Welcome:${WELCOME_TEMPLATE_VERSION}`);
    console.log(`Report: ${REPORT_TEMPLATE_VERSION}`);
  });
  
}

module.exports = {
  createProgressReportPdf,
  normalizeProgressReport,
  brandedEmailShell,
  emailLayout,
  progressStatus,
  reportPdfFilename,
  constants: { SCOOPS_BUILD, WELCOME_TEMPLATE_VERSION, REPORT_TEMPLATE_VERSION, PDF_TEMPLATE_VERSION }
};
