// ============================================================================
// Todo API server — Supabase PostgreSQL backend (pg)
// Dual-mode: runs locally with `node server.js` and as a Vercel serverless fn.
// ============================================================================

require('dotenv').config();

const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// ----------------------------------------------------------------------------
// Database — single Pool instance (lazy singleton, safe across cold starts)
// ----------------------------------------------------------------------------
let pool = null;
function getPool() {
  if (pool) return pool;
  const connectionString = (process.env.DATABASE_URL || '').trim();
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and fill in your Supabase connection string.'
    );
  }
  pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  return pool;
}

// Idempotent schema creation. Safe to call on every cold start because of the
// dbInitialized flag — within a single warm process this is a no-op.
let dbInitialized = false;
async function initDB() {
  if (dbInitialized) return;
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS categories (
      key        TEXT PRIMARY KEY,
      title      TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS todos (
      id        SERIAL PRIMARY KEY,
      text      TEXT NOT NULL,
      completed BOOLEAN NOT NULL DEFAULT FALSE,
      category  TEXT NOT NULL REFERENCES categories(key),
      content   TEXT
    )
  `);
  dbInitialized = true;
}

// ----------------------------------------------------------------------------
// Middleware
// ----------------------------------------------------------------------------
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Lazy-init guard mounted on /api only — keeps static asset serving snappy.
app.use('/api', async (_req, res, next) => {
  try {
    await initDB();
    next();
  } catch (err) {
    console.error('[initDB]', err);
    res.status(500).json({
      success: false,
      message: 'Database initialization failed',
    });
  }
});

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}
function fail(res, status, message) {
  return res.status(status).json({ success: false, message });
}

// ----------------------------------------------------------------------------
// Routes — Categories
// ----------------------------------------------------------------------------
// GET /api/categories — { key, title, order } sorted by sort_order asc
app.get('/api/categories', async (_req, res) => {
  try {
    const db = getPool();
    const { rows } = await db.query(
      'SELECT key, title, sort_order AS "order" FROM categories ORDER BY sort_order ASC'
    );
    return ok(res, rows);
  } catch (err) {
    console.error('[GET /api/categories]', err);
    return fail(res, 500, '카테고리를 불러오지 못했습니다.');
  }
});

// ----------------------------------------------------------------------------
// Routes — Todos
// ----------------------------------------------------------------------------
// GET /api/todos — ordered by id asc
app.get('/api/todos', async (_req, res) => {
  try {
    const db = getPool();
    const { rows } = await db.query(
      'SELECT id, text, completed, category, content FROM todos ORDER BY id ASC'
    );
    return ok(res, rows);
  } catch (err) {
    console.error('[GET /api/todos]', err);
    return fail(res, 500, '할 일 목록을 불러오지 못했습니다.');
  }
});

// POST /api/todos { text, category }
app.post('/api/todos', async (req, res) => {
  try {
    const { text, category } = req.body || {};
    const trimmedText = typeof text === 'string' ? text.trim() : '';
    const trimmedCategory = typeof category === 'string' ? category.trim() : '';

    if (!trimmedText) return fail(res, 400, '할 일 내용을 입력해 주세요.');
    if (!trimmedCategory) return fail(res, 400, '카테고리를 선택해 주세요.');

    const db = getPool();

    // Verify category exists.
    const cat = await db.query(
      'SELECT 1 FROM categories WHERE key = $1',
      [trimmedCategory]
    );
    if (cat.rowCount === 0) {
      return fail(res, 400, '존재하지 않는 카테고리입니다.');
    }

    const insert = await db.query(
      `INSERT INTO todos (text, completed, category)
       VALUES ($1, FALSE, $2)
       RETURNING id, text, completed, category, content`,
      [trimmedText, trimmedCategory]
    );
    return ok(res, insert.rows[0], 201);
  } catch (err) {
    console.error('[POST /api/todos]', err);
    return fail(res, 500, '할 일을 추가하지 못했습니다.');
  }
});

// PATCH /api/todos/:id — body may contain completed and/or text
app.patch('/api/todos/:id', async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return fail(res, 400, '잘못된 id 입니다.');

    const db = getPool();
    const body = req.body || {};
    const sets = [];
    const params = [];
    let i = 1;

    if (Object.prototype.hasOwnProperty.call(body, 'completed')) {
      if (typeof body.completed !== 'boolean') {
        return fail(res, 400, 'completed는 boolean이어야 합니다.');
      }
      sets.push(`completed = $${i++}`);
      params.push(body.completed);
    }

    if (Object.prototype.hasOwnProperty.call(body, 'text')) {
      if (typeof body.text !== 'string' || body.text.trim() === '') {
        return fail(res, 400, 'text는 비어 있을 수 없습니다.');
      }
      sets.push(`text = $${i++}`);
      params.push(body.text.trim());
    }

    // Empty body — return the current row unchanged.
    if (sets.length === 0) {
      const cur = await db.query(
        'SELECT id, text, completed, category, content FROM todos WHERE id = $1',
        [id]
      );
      if (cur.rowCount === 0) return fail(res, 404, '할 일을 찾을 수 없습니다.');
      return ok(res, cur.rows[0]);
    }

    params.push(id);
    const sql = `
      UPDATE todos
         SET ${sets.join(', ')}
       WHERE id = $${i}
       RETURNING id, text, completed, category, content
    `;
    const upd = await db.query(sql, params);
    if (upd.rowCount === 0) return fail(res, 404, '할 일을 찾을 수 없습니다.');
    return ok(res, upd.rows[0]);
  } catch (err) {
    console.error('[PATCH /api/todos/:id]', err);
    return fail(res, 500, '할 일을 수정하지 못했습니다.');
  }
});

// DELETE /api/todos/:id
app.delete('/api/todos/:id', async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return fail(res, 400, '잘못된 id 입니다.');

    const db = getPool();
    const del = await db.query(
      `DELETE FROM todos WHERE id = $1
       RETURNING id, text, completed, category, content`,
      [id]
    );
    if (del.rowCount === 0) return fail(res, 404, '할 일을 찾을 수 없습니다.');
    return ok(res, del.rows[0]);
  } catch (err) {
    console.error('[DELETE /api/todos/:id]', err);
    return fail(res, 500, '할 일을 삭제하지 못했습니다.');
  }
});

// ----------------------------------------------------------------------------
// SPA fallback — Express 5 wildcard syntax
// ----------------------------------------------------------------------------
app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ----------------------------------------------------------------------------
// Last-resort error handler (defensive — most paths already catch).
// ----------------------------------------------------------------------------
app.use((err, _req, res, _next) => {
  console.error('[unhandled]', err);
  if (res.headersSent) return;
  res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
});

// ----------------------------------------------------------------------------
// Dual-mode export
// ----------------------------------------------------------------------------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}
module.exports = app;
