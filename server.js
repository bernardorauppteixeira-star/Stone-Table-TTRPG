const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const ROOT = __dirname;
const DATA_DIR = process.env.STONE_TABLE_DATA_DIR || path.join(ROOT, '.stone-table-data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSION_COOKIE = 'stone_table_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 30 * 1000;
const LOGIN_LIMIT = 8;
const sessions = new Map();
const loginAttempts = new Map();
let userWriteQueue = Promise.resolve();
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
  'stone-league-logo.png'
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

function cookieOptions(request, maxAge) {
  const secure = request.socket.encrypted || request.headers['x-forwarded-proto'] === 'https';
  return `Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
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

function createSession(username) {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token, { username, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
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

function usernameKey(value) {
  return value.toLowerCase();
}

function validUsername(value) {
  return /^[a-zA-Z0-9_]{3,24}$/.test(value);
}

async function handleApi(request, response, pathname) {
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

  if (request.method !== 'POST' || !['/api/register', '/api/login'].includes(pathname)) {
    return sendJson(response, 404, { error: 'Rota não encontrada.' });
  }
  if (!checkRateLimit(request, response)) return;

  const { username: rawUsername, password } = await readJson(request);
  const username = normalizeUsername(rawUsername);
  const key = usernameKey(username);
  if (pathname === '/api/register') {
    if (!validUsername(username)) {
      return sendJson(response, 400, { error: 'O nome deve ter de 3 a 24 letras, números ou sublinhados.' });
    }
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
      return sendJson(response, 400, { error: 'A senha deve ter entre 8 e 128 caracteres.' });
    }

    const salt = crypto.randomBytes(16);
    const passwordHash = await derivePassword(password, salt);
    const user = {
      username,
      usernameKey: key,
      salt: salt.toString('hex'),
      passwordHash: passwordHash.toString('hex'),
      createdAt: new Date().toISOString()
    };
    const created = await updateUsers(async () => {
      const users = await readUsers();
      if (users.some(saved => saved.usernameKey === key)) return false;
      users.push(user);
      await saveUsers(users);
      return true;
    });
    if (!created) return sendJson(response, 409, { error: 'Esse nome de usuário já está em uso.' });

    const token = createSession(username);
    return sendJson(response, 201, { username }, {
      'Set-Cookie': `${SESSION_COOKIE}=${token}; ${cookieOptions(request, SESSION_TTL_MS / 1000)}`
    });
  }

  if (typeof password !== 'string' || password.length > 128) {
    return sendJson(response, 401, { error: 'Usuário ou senha inválidos.' });
  }
  const users = await readUsers();
  const user = users.find(saved => saved.usernameKey === key);
  const salt = user ? Buffer.from(user.salt, 'hex') : dummySalt;
  const expectedHash = user ? Buffer.from(user.passwordHash, 'hex') : await dummyHash;
  const actualHash = await derivePassword(password, salt);
  const valid = actualHash.length === expectedHash.length && crypto.timingSafeEqual(actualHash, expectedHash);
  if (!user || !valid) return sendJson(response, 401, { error: 'Usuário ou senha inválidos.' });

  const token = createSession(user.username);
  return sendJson(response, 200, { username: user.username }, {
    'Set-Cookie': `${SESSION_COOKIE}=${token}; ${cookieOptions(request, SESSION_TTL_MS / 1000)}`
  });
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
    if (pathname.startsWith('/api/')) return await handleApi(request, response, pathname);
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
