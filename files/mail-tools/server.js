import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import https from 'node:https';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import express from 'express';
import session from 'express-session';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import pino from 'pino';

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

const config = {
  port: Number(process.env.PORT || 8091),
  basePath: normalizeBasePath(process.env.BASE_PATH || '/tools'),
  sessionSecret: requiredEnv('SESSION_SECRET'),
  adminUser: process.env.TOOLS_ADMIN_USER || 'admin',
  adminPassword: requiredEnv('TOOLS_ADMIN_PASSWORD'),
  stalwartUrl: (process.env.STALWART_URL || 'https://127.0.0.1').replace(/\/+$/, ''),
  stalwartUser: requiredEnv('STALWART_ADMIN_USER'),
  stalwartPassword: requiredEnv('STALWART_ADMIN_PASSWORD'),
  stalwartTlsRejectUnauthorized: process.env.STALWART_TLS_REJECT_UNAUTHORIZED === 'true',
  mailDomain: process.env.MAIL_DOMAIN || 'edu.qlht.uk',
  domainId: process.env.STALWART_DOMAIN_ID || '',
  imapHost: process.env.IMAP_HOST || 'mail.edu.qlht.uk',
  imapPort: Number(process.env.IMAP_PORT || 993),
  imapTlsRejectUnauthorized: process.env.IMAP_TLS_REJECT_UNAUTHORIZED === 'true',
};

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  name: 'mail_tools_sid',
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 12 * 60 * 60 * 1000,
  },
}));

const router = express.Router();

router.get('/api/session', (req, res) => {
  res.json({ authenticated: Boolean(req.session.authenticated), user: req.session.user || null, domain: config.mailDomain });
});

router.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (constantEqual(username || '', config.adminUser) && constantEqual(password || '', config.adminPassword)) {
    req.session.regenerate((err) => {
      if (err) {
        log.error({ err }, 'failed to regenerate session');
        res.status(500).json({ error: 'SESSION_ERROR' });
        return;
      }
      req.session.authenticated = true;
      req.session.user = config.adminUser;
      res.json({ ok: true });
    });
    return;
  }
  res.status(401).json({ error: '用户名或密码不正确' });
});

router.post('/api/logout', requireAuth, (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/api/accounts', requireAuth, async (req, res) => {
  try {
    const prefix = String(req.query.prefix || '').trim();
    const limit = Math.min(Math.max(Number(req.query.limit || 500), 1), 500);
    const accounts = await listAccounts({ prefix, limit });
    res.json({ accounts });
  } catch (err) {
    handleError(res, err, 'LIST_ACCOUNTS_FAILED');
  }
});

router.post('/api/accounts/bulk-create', requireAuth, async (req, res) => {
  try {
    const { prefix, start, end, width, password, domain, dryRun } = req.body || {};
    const requestedDomain = normalizeDomain(domain || config.mailDomain);
    if (requestedDomain !== config.mailDomain) {
      res.status(400).json({ error: `当前工具只允许创建 ${config.mailDomain} 下的邮箱` });
      return;
    }

    const names = buildNames({ prefix, start, end, width });
    if (!password || String(password).length < 8) {
      res.status(400).json({ error: '密码至少 8 位' });
      return;
    }
    if (names.length > 500) {
      res.status(400).json({ error: '单次最多创建 500 个账号' });
      return;
    }

    const preview = names.map((name) => `${name}@${config.mailDomain}`);
    if (dryRun) {
      res.json({ dryRun: true, count: preview.length, accounts: preview });
      return;
    }

    const result = await createAccounts(names, String(password));
    res.json({ requested: preview.length, ...result });
  } catch (err) {
    handleError(res, err, 'BULK_CREATE_FAILED');
  }
});

router.get('/api/mailboxes/:address/messages', requireAuth, async (req, res) => {
  try {
    const address = normalizeEmail(req.params.address);
    const password = String(req.query.password || '');
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 100);
    const messages = await listMessages({ address, password, limit });
    res.json({ address, messages });
  } catch (err) {
    handleError(res, err, 'LIST_MESSAGES_FAILED');
  }
});

router.get('/api/mailboxes/:address/messages/:uid', requireAuth, async (req, res) => {
  try {
    const address = normalizeEmail(req.params.address);
    const password = String(req.query.password || '');
    const uid = Number(req.params.uid);
    if (!Number.isSafeInteger(uid) || uid < 1) {
      res.status(400).json({ error: '无效邮件 UID' });
      return;
    }
    const message = await getMessage({ address, password, uid });
    res.json({ address, message });
  } catch (err) {
    handleError(res, err, 'GET_MESSAGE_FAILED');
  }
});

const distDir = fileURLToPath(new URL('./dist/', import.meta.url));
const publicDir = fileURLToPath(new URL('./public/', import.meta.url));
router.use('/', express.static(existsSync(distDir) ? distDir : publicDir, { index: 'index.html' }));
app.use(config.basePath, router);
app.get('/', (_req, res) => res.redirect(config.basePath + '/'));

app.listen(config.port, process.env.LISTEN_HOST || '0.0.0.0', () => {
  log.info({ port: config.port, basePath: config.basePath }, 'mail tools listening');
});

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function normalizeBasePath(path) {
  const value = '/' + String(path || '').replace(/^\/+|\/+$/g, '');
  return value === '/' ? '' : value;
}

function constantEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function requireAuth(req, res, next) {
  if (req.session.authenticated) {
    next();
    return;
  }
  res.status(401).json({ error: '未登录' });
}

function normalizeDomain(domain) {
  return String(domain || '').trim().toLowerCase().replace(/^@/, '');
}

function normalizeEmail(address) {
  const email = String(address || '').trim().toLowerCase();
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+$/.test(email)) {
    const error = new Error('邮箱地址格式不正确');
    error.status = 400;
    throw error;
  }
  if (!email.endsWith(`@${config.mailDomain}`)) {
    const error = new Error(`只允许查看 ${config.mailDomain} 下的邮箱`);
    error.status = 400;
    throw error;
  }
  return email;
}

function buildNames({ prefix, start, end, width }) {
  const cleanPrefix = String(prefix || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,62}$/.test(cleanPrefix)) {
    const error = new Error('前缀只能包含小写字母、数字、点、下划线和中划线，并且必须以字母或数字开头');
    error.status = 400;
    throw error;
  }

  const from = Number(start);
  const to = Number(end);
  const padWidth = Math.min(Math.max(Number(width || 3), 1), 10);
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from) {
    const error = new Error('编号范围不正确');
    error.status = 400;
    throw error;
  }

  const names = [];
  for (let n = from; n <= to; n += 1) {
    names.push(`${cleanPrefix}${String(n).padStart(padWidth, '0')}`);
  }
  return names;
}

function basicAuthHeader() {
  return 'Basic ' + Buffer.from(`${config.stalwartUser}:${config.stalwartPassword}`).toString('base64');
}

async function stalwartJmap(methodCalls) {
  const body = JSON.stringify({
    using: ['urn:ietf:params:jmap:core', 'urn:stalwart:jmap'],
    methodCalls,
  });
  const response = await httpsJson(`${config.stalwartUrl}/jmap`, {
    method: 'POST',
    headers: {
      authorization: basicAuthHeader(),
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    },
    body,
  });
  const data = response.json;
  if (!response.ok) {
    const error = new Error(data?.detail || data?.title || `Stalwart API HTTP ${response.status}`);
    error.status = response.status;
    error.body = data;
    throw error;
  }
  const firstError = data?.methodResponses?.find(([name]) => name === 'error');
  if (firstError) {
    const error = new Error(firstError[1]?.description || firstError[1]?.type || 'Stalwart API method error');
    error.status = 400;
    error.body = data;
    throw error;
  }
  return data;
}

function httpsJson(urlString, { method, headers, body }) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const request = https.request(url, {
      method,
      headers,
      rejectUnauthorized: config.stalwartTlsRejectUnauthorized,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = null;
        }
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode,
          json,
          text,
        });
      });
    });
    request.on('error', reject);
    request.end(body);
  });
}

async function listAccounts({ prefix, limit }) {
  const query = { limit };
  const data = await stalwartJmap([
    ['x:Account/query', query, 'q'],
    ['x:Account/get', { '#ids': { resultOf: 'q', name: 'x:Account/query', path: '/ids' } }, 'g'],
  ]);
  const get = data.methodResponses.find(([name]) => name === 'x:Account/get')?.[1];
  const accounts = (get?.list || [])
    .filter((account) => account['@type'] === 'User')
    .filter((account) => !prefix || account.emailAddress?.startsWith(prefix))
    .map((account) => ({
      id: account.id,
      name: account.name,
      emailAddress: account.emailAddress,
      createdAt: account.createdAt,
      usedDiskQuota: account.usedDiskQuota || 0,
      description: account.description || '',
    }));
  return accounts;
}

async function createAccounts(names, password) {
  const domainId = await getDomainId();
  const create = {};
  for (const name of names) {
    create[name] = {
      '@type': 'User',
      name,
      description: name,
      domainId,
      credentials: {
        0: {
          '@type': 'Password',
          secret: password,
        },
      },
      roles: { '@type': 'User' },
      permissions: { '@type': 'Inherit' },
      quotas: {},
      aliases: {},
      memberGroupIds: {},
      locale: 'zh_CN',
      encryptionAtRest: { '@type': 'Disabled' },
    };
  }

  const data = await stalwartJmap([
    ['x:Account/set', { accountId: domainId, create }, 'c'],
  ]);
  const set = data.methodResponses.find(([name]) => name === 'x:Account/set')?.[1] || {};
  const created = Object.entries(set.created || {}).map(([clientId, value]) => ({
    localPart: clientId,
    emailAddress: `${clientId}@${config.mailDomain}`,
    id: value.id,
  }));
  const notCreated = Object.entries(set.notCreated || {}).map(([clientId, value]) => ({
    localPart: clientId,
    emailAddress: `${clientId}@${config.mailDomain}`,
    error: value.description || value.type || '创建失败',
  }));
  return { created, notCreated };
}

async function getDomainId() {
  if (config.domainId) {
    return config.domainId;
  }
  const data = await stalwartJmap([
    ['x:Domain/query', {}, 'q'],
    ['x:Domain/get', { '#ids': { resultOf: 'q', name: 'x:Domain/query', path: '/ids' } }, 'g'],
  ]);
  const get = data.methodResponses.find(([name]) => name === 'x:Domain/get')?.[1];
  const domain = (get?.list || []).find((item) => item.name === config.mailDomain);
  if (!domain?.id) {
    const error = new Error(`Stalwart 中没有找到域名 ${config.mailDomain}`);
    error.status = 500;
    throw error;
  }
  return domain.id;
}

async function withImap(address, password, fn) {
  if (!password) {
    const error = new Error('查看邮箱需要输入该邮箱密码');
    error.status = 400;
    throw error;
  }
  const client = new ImapFlow({
    host: config.imapHost,
    port: config.imapPort,
    secure: true,
    auth: { user: address, pass: password },
    tls: { rejectUnauthorized: config.imapTlsRejectUnauthorized },
    logger: false,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => {});
  }
}

async function listMessages({ address, password, limit }) {
  return withImap(address, password, async (client) => {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const status = await client.status('INBOX', { messages: true });
      if (!status.messages) {
        return [];
      }
      const start = Math.max(1, status.messages - limit + 1);
      const range = `${start}:*`;
      const messages = [];
      for await (const message of client.fetch(range, {
        uid: true,
        envelope: true,
        flags: true,
        internalDate: true,
        size: true,
      })) {
        messages.push({
          uid: message.uid,
          subject: message.envelope?.subject || '(无主题)',
          from: formatAddressList(message.envelope?.from),
          to: formatAddressList(message.envelope?.to),
          date: message.envelope?.date || message.internalDate,
          size: message.size || 0,
          seen: Array.from(message.flags || []).includes('\\Seen'),
        });
      }
      return messages.sort((a, b) => b.uid - a.uid);
    } finally {
      lock.release();
    }
  });
}

async function getMessage({ address, password, uid }) {
  return withImap(address, password, async (client) => {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const message = await client.fetchOne(uid, { uid: true, envelope: true, source: true, flags: true }, { uid: true });
      if (!message) {
        const error = new Error('邮件不存在');
        error.status = 404;
        throw error;
      }
      const parsed = await simpleParser(message.source);
      return {
        uid: message.uid,
        subject: parsed.subject || message.envelope?.subject || '(无主题)',
        from: parsed.from?.text || formatAddressList(message.envelope?.from),
        to: parsed.to?.text || formatAddressList(message.envelope?.to),
        date: parsed.date || message.envelope?.date || null,
        text: parsed.text || '',
        html: parsed.html || '',
        attachments: (parsed.attachments || []).map((attachment) => ({
          filename: attachment.filename || 'attachment',
          contentType: attachment.contentType,
          size: attachment.size,
        })),
      };
    } finally {
      lock.release();
    }
  });
}

function formatAddressList(list) {
  return (list || [])
    .map((item) => {
      const address = [item.mailbox, item.host].filter(Boolean).join('@');
      return item.name ? `${item.name} <${address}>` : address;
    })
    .filter(Boolean)
    .join(', ');
}

function handleError(res, err, code) {
  log.warn({ err, code }, 'request failed');
  res.status(err.status || 500).json({
    error: err.message || code,
    code,
  });
}
