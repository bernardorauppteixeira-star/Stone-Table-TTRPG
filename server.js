const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { promisify } = require('node:util');
const nodemailer = require('nodemailer');

const scrypt = promisify(crypto.scrypt);
const ROOT = __dirname;
const DATA_DIR = process.env.STONE_TABLE_DATA_DIR || path.join(ROOT, '.stone-table-data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSION_COOKIE = 'stone_table_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REMEMBER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 30 * 1000;
const LOGIN_LIMIT = 8;
const VERIFICATION_TTL_MS = 10 * 60 * 1000;
const VERIFICATION_ATTEMPT_LIMIT = 5;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const OAUTH_PROVIDERS = {
  google: {
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    redirectEnv: 'GOOGLE_REDIRECT_URI',
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    profileUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email profile'
  },
  discord: {
    clientIdEnv: 'DISCORD_CLIENT_ID',
    clientSecretEnv: 'DISCORD_CLIENT_SECRET',
    redirectEnv: 'DISCORD_REDIRECT_URI',
    authorizationUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    profileUrl: 'https://discord.com/api/users/@me',
    scope: 'identify email'
  }
};
const sessions = new Map();
const loginAttempts = new Map();
const pendingVerifications = new Map();
const oauthStates = new Map();
let userWriteQueue = Promise.resolve();
let mailTransporter = null;
const dummySalt = Buffer.alloc(16, 73);
const dummyHash = derivePassword('not-a-real-password', dummySalt);

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp'
};
const PUBLIC_STATIC_FILES = new Set([
  'index.html',
  'auth.css',
  'auth.js',
  'styles.css',
  'stone-league-logo.png',
  'google-logo.png'
]);

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  response.end(JSON.stringify(value));
}

function getMailTransport() {
  const host = process.env.SMTP_HOST;
  const username = process.env.SMTP_USER;
  const password = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || username;
  const port = Number(process.env.SMTP_PORT || 587);
  if (!host || !from || !Number.isInteger(port) || port < 1 || port > 65535 || Boolean(username) !== Boolean(password)) {
    const error = new Error('Envio de e-mail não configurado. Defina SMTP_HOST, SMTP_PORT e SMTP_FROM, além de SMTP_USER e SMTP_PASS quando exigidos pelo provedor.');
    error.status = 503;
    throw error;
  }

  if (!mailTransporter) {
    mailTransporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      ...(username ? { auth: { user: username, pass: password } } : {})
    });
  }
  return { transporter: mailTransporter, from };
}

async function sendVerificationEmail(email, code) {
  const { transporter, from } = getMailTransport();
  try {
    await transporter.sendMail({
      from,
      to: email,
      subject: 'Confirme seu e-mail - Stone League RPG',
      text: `Seu código de confirmação é ${code}. Ele expira em 10 minutos. Se você não solicitou este código, ignore esta mensagem.`
    });
  } catch (error) {
    console.error('Verification email delivery failed:', error.code || error.name);
    const deliveryError = new Error('Não foi possível enviar o e-mail de confirmação. Verifique a configuração SMTP e tente novamente.');
    deliveryError.status = 503;
    throw deliveryError;
  }
}

async function createEmailVerification(type, data, email, remember) {
  const now = Date.now();
  for (const [id, pending] of pendingVerifications) {
    if (pending.expiresAt <= now) pendingVerifications.delete(id);
  }
  if (pendingVerifications.size >= 10000) {
    const error = new Error('Muitas confirmações pendentes. Tente novamente mais tarde.');
    error.status = 503;
    throw error;
  }

  const code = String(crypto.randomInt(100000, 1000000));
  const codeSalt = crypto.randomBytes(16).toString('hex');
  await sendVerificationEmail(email, code);

  const challengeId = crypto.randomBytes(32).toString('base64url');
  const codeHash = crypto.createHash('sha256').update(`${codeSalt}:${code}`).digest();
  pendingVerifications.set(challengeId, {
    type,
    data,
    email,
    emailKey: normalizeEmail(email),
    codeSalt,
    codeHash,
    attempts: 0,
    remember,
    expiresAt: Date.now() + VERIFICATION_TTL_MS
  });
  return { verificationRequired: true, challengeId, email };
}

function getLocalDevelopmentOrigin(origin) {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    if (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      return origin;
    }
  } catch {}
  return null;
}

function cookieOptions(request, maxAge) {
  const secure = request.socket.encrypted || request.headers['x-forwarded-proto'] === 'https';
  const persistence = maxAge === null ? '' : `; Max-Age=${maxAge}`;
  return `Path=/; HttpOnly; SameSite=Strict${persistence}${secure ? '; Secure' : ''}`;
}

function readSession(request) {
  const cookie = (request.headers.cookie || '').split(';').map(part => part.trim())
    .find(part => part.startsWith(`${SESSION_COOKIE}=`));
  if (!cookie) return null;

  const token = cookie.slice(SESSION_COOKIE.length + 1);
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return { token, ...session };
}

function createSession(username, remember) {
  const token = crypto.randomBytes(32).toString('base64url');
  const ttl = remember ? REMEMBER_SESSION_TTL_MS : SESSION_TTL_MS;
  sessions.set(token, { username, expiresAt: Date.now() + ttl });
  return token;
}

function sessionCookie(request, token, remember) {
  const maxAge = remember ? REMEMBER_SESSION_TTL_MS / 1000 : null;
  return `${SESSION_COOKIE}=${token}; ${cookieOptions(request, maxAge)}`;
}

function getOAuthConfig(provider, request) {
  const settings = OAUTH_PROVIDERS[provider];
  if (!settings) return null;
  const clientId = process.env[settings.clientIdEnv];
  const clientSecret = process.env[settings.clientSecretEnv];
  let redirectUri = process.env[settings.redirectEnv];
  if (!redirectUri && request?.headers.host) {
    try {
      const requestUrl = new URL(`http://${request.headers.host}`);
      if (['localhost', '127.0.0.1', '[::1]'].includes(requestUrl.hostname)) {
        redirectUri = `http://${requestUrl.host}/auth/${provider}/callback`;
      }
    } catch {}
  }
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { ...settings, clientId, clientSecret, redirectUri };
}

function getOAuthReturnTo(value) {
  const configuredFrontend = process.env.FRONTEND_URL;
  const fallback = new URL(configuredFrontend || 'http://localhost:3000/');
  try {
    const destination = new URL(value || fallback);
    if (configuredFrontend) {
      if (destination.origin !== fallback.origin) return fallback;
    } else if (!getLocalDevelopmentOrigin(destination.origin)) {
      return fallback;
    }
    destination.search = '';
    destination.hash = '';
    return destination;
  } catch {
    return fallback;
  }
}

function redirectOAuthResult(response, returnTo, result, cookie) {
  const destination = new URL(returnTo);
  if (result === 'success') destination.searchParams.set('oauth', 'success');
  else destination.searchParams.set('oauthError', result);
  response.writeHead(302, {
    'Cache-Control': 'no-store',
    Location: destination.toString(),
    ...(cookie ? { 'Set-Cookie': cookie } : {})
  });
  response.end();
}

function createOAuthUsername(email, users) {
  const localPart = email.split('@')[0];
  let base = localPart.replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20);
  if (base.length < 3) base = `player_${base}`.slice(0, 20);
  let candidate = base;
  let suffix = 1;
  while (users.some(user => user.usernameKey === usernameKey(candidate))) {
    const ending = `_${suffix++}`;
    candidate = `${base.slice(0, 24 - ending.length)}${ending}`;
  }
  return candidate;
}

async function linkOAuthAccount(provider, providerUserId, email) {
  const salt = crypto.randomBytes(16);
  const passwordHash = await derivePassword(crypto.randomBytes(32).toString('base64url'), salt);
  return updateUsers(async () => {
    const users = await readUsers();
    const providerAccount = users.find(user => user.oauthProviders?.[provider] === providerUserId);
    const emailAccount = users.find(user => normalizeEmail(user.emailKey || user.email) === email);
    const user = providerAccount || emailAccount;

    if (user) {
      if (user.oauthProviders?.[provider] && user.oauthProviders[provider] !== providerUserId) return null;
      if (emailUsedByAnotherUser(users, email, user.usernameKey)) return null;
      user.oauthProviders = { ...user.oauthProviders, [provider]: providerUserId };
      user.email = email;
      user.emailKey = email;
      user.emailVerified = true;
      await saveUsers(users);
      return user.username;
    }

    const username = createOAuthUsername(email, users);
    users.push({
      username,
      usernameKey: usernameKey(username),
      email,
      emailKey: email,
      emailVerified: true,
      oauthProviders: { [provider]: providerUserId },
      salt: salt.toString('hex'),
      passwordHash: passwordHash.toString('hex'),
      createdAt: new Date().toISOString()
    });
    await saveUsers(users);
    return username;
  });
}

function startOAuth(request, response, provider, url) {
  const returnTo = getOAuthReturnTo(url.searchParams.get('returnTo'));
  const config = getOAuthConfig(provider, request);
  if (!config) return redirectOAuthResult(response, returnTo, 'configuration');

  const now = Date.now();
  for (const [state, flow] of oauthStates) {
    if (flow.expiresAt <= now) oauthStates.delete(state);
  }
  if (oauthStates.size >= 10000) return redirectOAuthResult(response, returnTo, 'invalid');

  const state = crypto.randomBytes(32).toString('base64url');
  oauthStates.set(state, {
    provider,
    remember: url.searchParams.get('remember') === '1',
    returnTo: returnTo.toString(),
    expiresAt: now + OAUTH_STATE_TTL_MS
  });

  const authorization = new URL(config.authorizationUrl);
  authorization.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: config.scope,
    state
  });
  response.writeHead(302, { 'Cache-Control': 'no-store', Location: authorization.toString() });
  response.end();
}

async function finishOAuth(request, response, provider, url) {
  const state = url.searchParams.get('state');
  const flow = state ? oauthStates.get(state) : null;
  if (!flow || flow.provider !== provider || flow.expiresAt <= Date.now()) {
    if (state) oauthStates.delete(state);
    return redirectOAuthResult(response, getOAuthReturnTo(null), 'invalid');
  }
  oauthStates.delete(state);
  const returnTo = new URL(flow.returnTo);
  if (url.searchParams.has('error')) return redirectOAuthResult(response, returnTo, 'denied');
  const code = url.searchParams.get('code');
  const config = getOAuthConfig(provider, request);
  if (!code || !config) return redirectOAuthResult(response, returnTo, 'invalid');

  try {
    const tokenResponse = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: config.redirectUri
      }),
      signal: AbortSignal.timeout(10000)
    });
    if (!tokenResponse.ok) return redirectOAuthResult(response, returnTo, 'invalid');
    const token = await tokenResponse.json();
    if (typeof token.access_token !== 'string') return redirectOAuthResult(response, returnTo, 'invalid');

    const profileResponse = await fetch(config.profileUrl, {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(10000)
    });
    if (!profileResponse.ok) return redirectOAuthResult(response, returnTo, 'invalid');
    const profile = await profileResponse.json();
    const email = normalizeEmail(profile.email);
    const emailVerified = provider === 'google' ? profile.email_verified === true : profile.verified === true;
    const providerUserId = typeof profile.sub === 'string' ? profile.sub : typeof profile.id === 'string' ? profile.id : '';
    if (!validEmail(email) || !emailVerified) return redirectOAuthResult(response, returnTo, 'email');
    if (!providerUserId) return redirectOAuthResult(response, returnTo, 'invalid');

    const username = await linkOAuthAccount(provider, providerUserId, email);
    if (!username) return redirectOAuthResult(response, returnTo, 'account');
    const session = createSession(username, flow.remember);
    return redirectOAuthResult(response, returnTo, 'success', sessionCookie(request, session, flow.remember));
  } catch (error) {
    console.error('OAuth sign-in failed:', error.name);
    return redirectOAuthResult(response, returnTo, 'invalid');
  }
}

async function handleOAuthRoute(request, response, pathname) {
  const url = new URL(request.url, 'http://localhost');
  const match = pathname.match(/^\/auth\/(google|discord)(\/callback)?$/);
  if (!match || request.method !== 'GET') return sendJson(response, 404, { error: 'Rota OAuth não encontrada.' });
  const [, provider, callback] = match;
  if (callback) return await finishOAuth(request, response, provider, url);
  return startOAuth(request, response, provider, url);
}

async function derivePassword(password, salt) {
  return scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

async function readUsers() {
  try {
    const contents = await fs.readFile(USERS_FILE, 'utf8');
    const users = JSON.parse(contents);
    if (!Array.isArray(users)) throw new Error('Invalid user database format.');
    return users;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function saveUsers(users) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const temporaryFile = `${USERS_FILE}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temporaryFile, JSON.stringify(users), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporaryFile, USERS_FILE);
  } catch (error) {
    await fs.rm(temporaryFile, { force: true });
    throw error;
  }
}

function updateUsers(action) {
  const operation = userWriteQueue.then(action, action);
  userWriteQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

function getClientKey(request) {
  return request.socket.remoteAddress || 'unknown';
}

function checkRateLimit(request, response) {
  const now = Date.now();
  for (const [key, attempt] of loginAttempts) {
    if (now - attempt.startedAt >= LOGIN_WINDOW_MS) loginAttempts.delete(key);
  }

  const key = getClientKey(request);
  const attempt = loginAttempts.get(key);
  if (attempt && now - attempt.startedAt < LOGIN_WINDOW_MS && attempt.count >= LOGIN_LIMIT) {
    sendJson(response, 429, { error: 'Muitas tentativas. Aguarde 30 segundos e tente novamente.' });
    return false;
  }

  if (!attempt || now - attempt.startedAt >= LOGIN_WINDOW_MS) {
    if (loginAttempts.size >= 10000) loginAttempts.delete(loginAttempts.keys().next().value);
    loginAttempts.set(key, { startedAt: now, count: 1 });
  } else {
    attempt.count += 1;
  }
  return true;
}

async function readJson(request) {
  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    const error = new Error('Envie os dados no formato JSON.');
    error.status = 415;
    throw error;
  }

  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 4096) {
      const error = new Error('Solicitação muito grande.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid JSON body.');
    return value;
  } catch {
    const error = new Error('Dados inválidos.');
    error.status = 400;
    throw error;
  }
}

function normalizeUsername(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function usernameKey(value) {
  return value.toLowerCase();
}

function validEmail(value) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validUsername(value) {
  return value.length >= 3 && value.length <= 24 && !/[\u0000-\u001f\u007f@]/.test(value);
}

function emailUsedByAnotherUser(users, email, username) {
  return users.some(user => user.usernameKey !== username && normalizeEmail(user.emailKey || user.email) === email);
}

async function verifyEmail(request, response) {
  const { challengeId, code } = await readJson(request);
  if (typeof challengeId !== 'string' || typeof code !== 'string' || !/^[0-9]{6}$/.test(code)) {
    return sendJson(response, 400, { error: 'Informe o código de seis dígitos enviado por e-mail.' });
  }

  const pending = pendingVerifications.get(challengeId);
  if (!pending || pending.expiresAt <= Date.now()) {
    pendingVerifications.delete(challengeId);
    return sendJson(response, 410, { error: 'Código expirado. Volte e tente novamente para receber outro.' });
  }
  pending.attempts += 1;
  if (pending.attempts > VERIFICATION_ATTEMPT_LIMIT) {
    pendingVerifications.delete(challengeId);
    return sendJson(response, 429, { error: 'Limite de tentativas atingido. Volte e solicite outro código.' });
  }

  const actualHash = crypto.createHash('sha256').update(`${pending.codeSalt}:${code}`).digest();
  if (!crypto.timingSafeEqual(actualHash, pending.codeHash)) {
    return sendJson(response, 400, { error: 'Código incorreto. Confira a mensagem e tente novamente.' });
  }

  if (pending.type === 'register') {
    const created = await updateUsers(async () => {
      const users = await readUsers();
      const user = pending.data;
      if (users.some(saved => saved.usernameKey === user.usernameKey || normalizeEmail(saved.emailKey || saved.email) === pending.emailKey)) {
        return false;
      }
      users.push({ ...user, emailVerified: true });
      await saveUsers(users);
      return true;
    });
    pendingVerifications.delete(challengeId);
    if (!created) return sendJson(response, 409, { error: 'Esse nome de exibição ou e-mail já está em uso.' });
    const token = createSession(pending.data.username, pending.remember);
    return sendJson(response, 200, { username: pending.data.username }, {
      'Set-Cookie': sessionCookie(request, token, pending.remember)
    });
  }

  const activated = await updateUsers(async () => {
    const users = await readUsers();
    const user = users.find(saved => saved.usernameKey === pending.data.usernameKey);
    if (!user || (user.emailKey && user.emailKey !== pending.emailKey)) return false;
    if (user.emailVerified) return user.emailKey === pending.emailKey;
    if (emailUsedByAnotherUser(users, pending.emailKey, pending.data.usernameKey)) return false;
    user.email = pending.email;
    user.emailKey = pending.emailKey;
    user.emailVerified = true;
    await saveUsers(users);
    return true;
  });
  pendingVerifications.delete(challengeId);
  if (!activated) return sendJson(response, 401, { error: 'Não foi possível confirmar esse e-mail para a conta.' });
  const token = createSession(pending.data.username, pending.remember);
  return sendJson(response, 200, { username: pending.data.username }, {
    'Set-Cookie': sessionCookie(request, token, pending.remember)
  });
}

async function handleApi(request, response, pathname) {
  if (request.method === 'GET' && pathname === '/api/auth/providers') {
    return sendJson(response, 200, {
      google: Boolean(getOAuthConfig('google', request)),
      discord: Boolean(getOAuthConfig('discord', request))
    });
  }

  if (request.method === 'GET' && pathname === '/api/me') {
    const session = readSession(request);
    if (!session) return sendJson(response, 200, { authenticated: false });
    return sendJson(response, 200, { authenticated: true, username: session.username });
  }

  if (request.method === 'POST' && pathname === '/api/logout') {
    const session = readSession(request);
    if (session) sessions.delete(session.token);
    return sendJson(response, 200, { ok: true }, {
      'Set-Cookie': `${SESSION_COOKIE}=; ${cookieOptions(request, 0)}`
    });
  }

  if (request.method === 'POST' && pathname === '/api/verify-email') {
    return await verifyEmail(request, response);
  }

  if (request.method !== 'POST' || !['/api/register', '/api/login'].includes(pathname)) {
    return sendJson(response, 404, { error: 'Rota não encontrada.' });
  }
  if (!checkRateLimit(request, response)) return;

  const {
    username: rawUsername,
    identifier: rawIdentifier,
    email: rawEmail,
    password,
    passwordConfirmation
  } = await readJson(request);
  const username = normalizeUsername(rawUsername);
  const email = normalizeEmail(rawEmail);
  const identifier = normalizeUsername(rawIdentifier || rawEmail || rawUsername);
  const identifierEmail = normalizeEmail(identifier);
  const remember = false;
  if (pathname === '/api/register') {
    if (!validUsername(username)) {
      return sendJson(response, 400, { error: 'O nome de exibição deve ter de 3 a 24 caracteres e não pode conter @.' });
    }
    if (!validEmail(email)) {
      return sendJson(response, 400, { error: 'Informe um endereço de e-mail válido.' });
    }
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
      return sendJson(response, 400, { error: 'A senha deve ter entre 8 e 128 caracteres.' });
    }
    if (typeof passwordConfirmation !== 'string' || password !== passwordConfirmation) {
      return sendJson(response, 400, { error: 'As senhas informadas não coincidem.' });
    }

    const users = await readUsers();
    if (users.some(saved => saved.usernameKey === usernameKey(username) || normalizeEmail(saved.emailKey || saved.email) === email)) {
      return sendJson(response, 409, { error: 'Esse nome de exibição ou e-mail já está em uso.' });
    }

    const salt = crypto.randomBytes(16);
    const passwordHash = await derivePassword(password, salt);
    const user = {
      username,
      usernameKey: usernameKey(username),
      email,
      emailKey: email,
      salt: salt.toString('hex'),
      passwordHash: passwordHash.toString('hex'),
      createdAt: new Date().toISOString()
    };
    const verification = await createEmailVerification('register', user, email, remember);
    return sendJson(response, 202, verification);
  }

  if (!identifier || typeof password !== 'string' || password.length > 128 ||
      typeof passwordConfirmation !== 'string' || password !== passwordConfirmation) {
    return sendJson(response, 401, { error: 'Usuário, e-mail ou senha inválidos.' });
  }
  const users = await readUsers();
  const user = users.find(saved => {
    const savedEmail = normalizeEmail(saved.emailKey || saved.email);
    return validEmail(identifierEmail)
      ? savedEmail === identifierEmail
      : saved.usernameKey === usernameKey(identifier);
  });
  const salt = user ? Buffer.from(user.salt, 'hex') : dummySalt;
  const expectedHash = user ? Buffer.from(user.passwordHash, 'hex') : await dummyHash;
  const actualHash = await derivePassword(password, salt);
  const valid = actualHash.length === expectedHash.length && crypto.timingSafeEqual(actualHash, expectedHash);
  if (!user || !valid) return sendJson(response, 401, { error: 'Usuário, e-mail ou senha inválidos.' });
  const userEmail = normalizeEmail(user.emailKey || user.email);
  if (user.emailVerified && validEmail(userEmail)) {
    const token = createSession(user.username, remember);
    return sendJson(response, 200, { username: user.username }, {
      'Set-Cookie': sessionCookie(request, token, remember)
    });
  }

  if (!validEmail(userEmail) || emailUsedByAnotherUser(users, userEmail, user.usernameKey)) {
    return sendJson(response, 401, { error: 'Usuário, e-mail ou senha inválidos.' });
  }
  const verification = await createEmailVerification('login', { username: user.username, usernameKey: user.usernameKey }, userEmail, remember);
  return sendJson(response, 202, verification);
}

async function serveStatic(request, response, pathname) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    return sendJson(response, 405, { error: 'Método não permitido.' }, { Allow: 'GET, HEAD' });
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return sendJson(response, 400, { error: 'Caminho inválido.' });
  }
  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.slice(1);
  if (relativePath.split(/[\\/]/).some(part => part.startsWith('.'))) {
    return sendJson(response, 404, { error: 'Arquivo não encontrado.' });
  }
  if (!PUBLIC_STATIC_FILES.has(relativePath) && !readSession(request)) {
    return sendJson(response, 401, { error: 'Entre para continuar.' });
  }

  const filePath = path.resolve(ROOT, relativePath);
  if (!filePath.startsWith(`${ROOT}${path.sep}`)) {
    return sendJson(response, 404, { error: 'Arquivo não encontrado.' });
  }

  let file;
  try {
    file = await fs.stat(filePath);
    if (!file.isFile()) return sendJson(response, 404, { error: 'Arquivo não encontrado.' });
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      return sendJson(response, 404, { error: 'Arquivo não encontrado.' });
    }
    throw error;
  }

  response.writeHead(200, {
    'Cache-Control': 'no-cache',
    'Content-Length': file.size,
    'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY'
  });
  if (request.method === 'HEAD') return response.end();
  const stream = require('node:fs').createReadStream(filePath);
  stream.on('error', error => {
    console.error('Static file read failed:', error);
    response.destroy(error);
  });
  stream.pipe(response);
}

const server = http.createServer(async (request, response) => {
  try {
    const { pathname } = new URL(request.url, 'http://localhost');
    if (pathname.startsWith('/api/')) {
      const origin = getLocalDevelopmentOrigin(request.headers.origin);
      if (origin) {
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Access-Control-Allow-Credentials', 'true');
        response.setHeader('Vary', 'Origin');
      }
      if (request.method === 'OPTIONS') {
        if (!origin) return sendJson(response, 403, { error: 'Origem não permitida.' });
        response.writeHead(204, {
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Max-Age': '600'
        });
        return response.end();
      }
      return await handleApi(request, response, pathname);
    }
    if (pathname.startsWith('/auth/')) return await handleOAuthRoute(request, response, pathname);
    await serveStatic(request, response, pathname);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EACCES') {
      console.error('Authentication storage error:', error);
      return sendJson(response, 500, { error: 'Não foi possível acessar os dados da conta.' });
    }
    if (error.status) return sendJson(response, error.status, { error: error.message });
    console.error('Request failed:', error);
    if (!response.headersSent) sendJson(response, 500, { error: 'Erro interno. Tente novamente.' });
    else response.destroy(error);
  }
});

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '127.0.0.1';
server.listen(port, host, () => console.log(`Stone League RPG disponível em http://${host}:${port}`));
