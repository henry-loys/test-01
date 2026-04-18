require('dotenv').config();

const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required. Copy .env.example to .env and set the value.');
}

// Lazy singleton pg Pool
let pool = null;
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}

// Cold-start safe table creation
let dbInitialized = false;
async function initDB() {
  if (dbInitialized) return;
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS memos (
      id         SERIAL PRIMARY KEY,
      title      TEXT,
      content    TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  dbInitialized = true;
}

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Lazy-init guard for /api routes
app.use('/api', async (_req, res, next) => {
  try {
    await initDB();
    next();
  } catch (err) {
    console.error('DB init error:', err);
    res.status(500).json({ success: false, message: 'Database initialization failed' });
  }
});

// Helpers
// Normalize incoming value: undefined => "not provided", "" => null, string => trimmed, null => null.
// Returns { provided: boolean, value: string|null }.
function normalizeField(raw) {
  if (raw === undefined) return { provided: false, value: null };
  if (raw === null) return { provided: true, value: null };
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return { provided: true, value: trimmed === '' ? null : trimmed };
  }
  // Any other type — coerce to string then trim
  const trimmed = String(raw).trim();
  return { provided: true, value: trimmed === '' ? null : trimmed };
}

// ---------- Routes ----------

// GET /api/memos — list all, newest first
app.get('/api/memos', async (_req, res) => {
  try {
    const { rows } = await getPool().query(
      'SELECT id, title, content, created_at FROM memos ORDER BY id DESC'
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('GET /api/memos error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch memos' });
  }
});

// POST /api/memos — create
app.post('/api/memos', async (req, res) => {
  try {
    const title = normalizeField(req.body?.title).value;
    const content = normalizeField(req.body?.content).value;
    const { rows } = await getPool().query(
      'INSERT INTO memos (title, content) VALUES ($1, $2) RETURNING id, title, content, created_at',
      [title, content]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('POST /api/memos error:', err);
    res.status(500).json({ success: false, message: 'Failed to create memo' });
  }
});

// PATCH /api/memos/:id — partial update
app.patch('/api/memos/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }

    const titleField = normalizeField(req.body?.title);
    const contentField = normalizeField(req.body?.content);

    // Empty body → return current row unchanged
    if (!titleField.provided && !contentField.provided) {
      const { rows } = await getPool().query(
        'SELECT id, title, content, created_at FROM memos WHERE id = $1',
        [id]
      );
      if (rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Memo not found' });
      }
      return res.json({ success: true, data: rows[0] });
    }

    const sets = [];
    const values = [];
    let i = 1;
    if (titleField.provided) {
      sets.push(`title = $${i++}`);
      values.push(titleField.value);
    }
    if (contentField.provided) {
      sets.push(`content = $${i++}`);
      values.push(contentField.value);
    }
    values.push(id);

    const { rows } = await getPool().query(
      `UPDATE memos SET ${sets.join(', ')} WHERE id = $${i} RETURNING id, title, content, created_at`,
      values
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Memo not found' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('PATCH /api/memos/:id error:', err);
    res.status(500).json({ success: false, message: 'Failed to update memo' });
  }
});

// DELETE /api/memos/:id
app.delete('/api/memos/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }
    const { rows } = await getPool().query(
      'DELETE FROM memos WHERE id = $1 RETURNING id, title, content, created_at',
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Memo not found' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('DELETE /api/memos/:id error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete memo' });
  }
});

// SPA fallback — non-API routes serve index.html (Express 5 wildcard)
app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Final error handler
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// Local vs Vercel serverless
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
