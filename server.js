// server.js - fallback para db.json se DATABASE_URL não estiver presente
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '15mb' }));

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'troque-esta-chave';
const SALT_ROUNDS = 10;

// Diretórios para uploads locais (dev)
const UPLOADS_DIR = path.join(__dirname, 'public_uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// multer para upload temporário
const upload = multer({ dest: path.join(__dirname, 'tmp_uploads/') });

// ---------- Abstração de armazenamento (Postgres OR JSON file) ----------
const usePostgres = !!process.env.DATABASE_URL;
let pgPool = null;
if (usePostgres) {
  const { Pool } = require('pg');
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: (process.env.NODE_ENV === 'production') ? { rejectUnauthorized: false } : false
  });
  console.log('Modo: Postgres habilitado (DATABASE_URL detectada)');
} else {
  console.log('Modo: Sem Postgres (fallback para db.json).');
}

// JSON fallback file path
const DB_FILE = path.join(__dirname, 'db.json');
function ensureLocalDb() {
  if (!fs.existsSync(DB_FILE)) {
    const initial = {
      users: [],
      store: { key: 'main', content: {}, updated_at: new Date().toISOString(), version: 1 },
      images: [],
      audit_log: []
    };
    const adminPass = process.env.INIT_ADMIN_PASS || 'admin';
    const bcryptHash = bcrypt.hashSync(adminPass, SALT_ROUNDS);
    initial.users.push({ id: 1, username: 'admin', password_hash: bcryptHash, role: 'admin', created_at: new Date().toISOString() });
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
    console.log('Arquivo db.json criado com usuário admin (senha INIT_ADMIN_PASS ou "admin").');
  }
}
if (!usePostgres) ensureLocalDb();

function readLocalDb() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) { ensureLocalDb(); return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
}
function writeLocalDb(obj) { fs.writeFileSync(DB_FILE, JSON.stringify(obj, null, 2)); }

async function findUserByUsername(username) {
  if (usePostgres) {
    const r = await pgPool.query('SELECT id, username, password_hash, role FROM users WHERE username=$1', [username]);
    return r.rowCount ? r.rows[0] : null;
  } else {
    const db = readLocalDb();
    return db.users.find(u => u.username === username) || null;
  }
}
async function createUser(username, password, role = 'editor', creatorId = null) {
  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  if (usePostgres) {
    const r = await pgPool.query('INSERT INTO users (username, password_hash, role) VALUES ($1,$2,$3) RETURNING id,username,role', [username, hash, role]);
    await pgPool.query('INSERT INTO audit_log (user_id, action, payload) VALUES ($1,$2,$3)', [creatorId, 'user.create', { username }]).catch(()=>{});
    return r.rows[0];
  } else {
    const db = readLocalDb();
    const id = (db.users.reduce((s,u)=>Math.max(s,u.id), 0) || 0) + 1;
    const u = { id, username, password_hash: hash, role, created_at: new Date().toISOString() };
    db.users.push(u);
    db.audit_log.push({ id:(db.audit_log.length||0)+1, user_id: creatorId, action: 'user.create', payload:{ username }, created_at: new Date().toISOString() });
    writeLocalDb(db);
    return { id: u.id, username: u.username, role: u.role };
  }
}
async function ensureSchemaAndSeed() {
  if (usePostgres) {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'editor',
        created_at TIMESTAMP DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS store (
        key TEXT PRIMARY KEY,
        content JSONB,
        updated_at TIMESTAMP DEFAULT now(),
        version INTEGER DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS images (
        id SERIAL PRIMARY KEY,
        url TEXT NOT NULL,
        filename TEXT,
        uploaded_at TIMESTAMP DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        action TEXT,
        payload JSONB,
        created_at TIMESTAMP DEFAULT now()
      );
    `);
    const r = await pgPool.query('SELECT COUNT(*) FROM users');
    if (parseInt(r.rows[0].count, 10) === 0) {
      const pass = process.env.INIT_ADMIN_PASS || 'admin';
      await createUser('admin', pass, 'admin', null);
      console.log('Admin seed criado (Postgres).');
    }
  } else {
    ensureLocalDb();
  }
}

function getStore() {
  if (usePostgres) {
    return pgPool.query('SELECT content, updated_at, version FROM store WHERE key=$1', ['main']).then(r => r.rowCount ? r.rows[0] : null);
  } else {
    const db = readLocalDb();
    return { content: db.store.content, updated_at: db.store.updated_at, version: db.store.version };
  }
}
async function setStore(payload, userId = null) {
  if (usePostgres) {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      const cur = await client.query(`SELECT version FROM store WHERE key='main' FOR UPDATE`);
      if (cur.rowCount === 0) {
        await client.query(`INSERT INTO store (key, content, version) VALUES ('main', $1, 1)`, [payload]);
      } else {
        const newVersion = cur.rows[0].version + 1;
        await client.query(`UPDATE store SET content=$1, updated_at=now(), version=$2 WHERE key='main'`, [payload, newVersion]);
      }
      await client.query(`INSERT INTO audit_log (user_id, action, payload) VALUES ($1,$2,$3)`, [userId, 'store.update', { size: JSON.stringify(payload).length }]);
      await client.query('COMMIT');
      return true;
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally { client.release(); }
  } else {
    const db = readLocalDb();
    db.store = db.store || { key: 'main', content: {}, version: 1, updated_at: new Date().toISOString() };
    db.store.content = payload;
    db.store.version = (db.store.version || 0) + 1;
    db.store.updated_at = new Date().toISOString();
    db.audit_log.push({ id:(db.audit_log.length||0)+1, user_id: userId, action:'store.update', payload:{ size: JSON.stringify(payload).length }, created_at: new Date().toISOString() });
    writeLocalDb(db);
    return true;
  }
}

// ---------- Auth middleware ----------
function authMiddleware(requiredRole) {
  return async (req, res, next) => {
    const h = req.headers.authorization;
    if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
    const token = h.slice(7);
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = payload;
      if (requiredRole && requiredRole === 'admin') {
        if (usePostgres) {
          const r = await pgPool.query('SELECT role FROM users WHERE id=$1', [payload.id]);
          if (r.rowCount === 0 || r.rows[0].role !== 'admin') return res.status(403).json({ error: 'Requires admin' });
        } else {
          const db = readLocalDb();
          const u = db.users.find(x => x.id === payload.id);
          if (!u || u.role !== 'admin') return res.status(403).json({ error: 'Requires admin' });
        }
      }
      next();
    } catch (err) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  };
}

// ---------- Endpoints ----------
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username+password required' });
  try {
    const user = await findUserByUsername(username);
    if (!user) return res.status(401).json({ error: 'invalid credentials' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'invalid credentials' });
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '12h' });
    return res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', authMiddleware('admin'), async (req, res) => {
  const { username, password, role = 'editor' } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username+password required' });
  try {
    const created = await createUser(username, password, role, req.user.id);
    res.json(created);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/data', authMiddleware(), async (req, res) => {
  try {
    const s = await getStore();
    if (!s) return res.json({ content: null });
    return res.json({ content: s.content, updated_at: s.updated_at || s.updated_at, version: s.version || s.version });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/data', authMiddleware(), async (req, res) => {
  const payload = req.body;
  if (!payload) return res.status(400).json({ error: 'payload required' });
  try {
    await setStore(payload, req.user.id);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/export', authMiddleware('admin'), async (req, res) => {
  if (usePostgres) {
    const r = await pgPool.query(`SELECT content FROM store WHERE key='main'`);
    const content = (r.rowCount === 0) ? {} : r.rows[0].content;
    res.setHeader('Content-Disposition','attachment; filename="ciata_export.json"');
    res.json(content);
  } else {
    const db = readLocalDb();
    res.setHeader('Content-Disposition','attachment; filename="ciata_export.json"');
    res.json(db.store.content || {});
  }
});

app.post('/api/upload', authMiddleware(), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file required' });
    const destName = `${Date.now()}_${req.file.originalname}`;
    const dest = path.join(UPLOADS_DIR, destName);
    fs.renameSync(req.file.path, dest);
    const url = `/static/${destName}`;
    if (usePostgres) {
      await pgPool.query('INSERT INTO images (url, filename) VALUES ($1,$2)', [url, destName]);
    } else {
      const db = readLocalDb();
      db.images = db.images || [];
      db.images.push({ id: (db.images.length||0)+1, url, filename: destName, uploaded_at: new Date().toISOString() });
      writeLocalDb(db);
    }
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use('/static', express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
// SPA fallback (after API)
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'API endpoint not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start
(async () => {
  try {
    await ensureSchemaAndSeed();
    app.listen(PORT, ()=>console.log(`Server started on ${PORT}`));
  } catch (err) {
    console.error('Erro ao iniciar:', err);
    process.exit(1);
  }
})();
