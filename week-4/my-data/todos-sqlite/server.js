// ---------------------------------------------------------------------------
// Todos server — SQLite edition
// ---------------------------------------------------------------------------
// 의존성 설치 필요:
//   npm init -y
//   npm install express better-sqlite3
//
// 실행:
//   node server.js            (로컬)
//   Vercel 등 서버리스에서는 module.exports 로 export 된 app 사용
// ---------------------------------------------------------------------------

const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'todos.db');

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(express.json());
app.use(express.static(__dirname));

// ---------------------------------------------------------------------------
// DB: lazy init + singleton 재사용 (cold start 안전)
// ---------------------------------------------------------------------------
let dbInstance = null;
let dbInitError = null;

function getDb() {
  if (dbInstance) return dbInstance;
  if (dbInitError) throw dbInitError;

  if (!fs.existsSync(DB_PATH)) {
    const err = new Error(`SQLite DB file not found at ${DB_PATH}`);
    err.code = 'DB_NOT_FOUND';
    dbInitError = err;
    console.error('[server]', err.message);
    throw err;
  }

  try {
    // readonly: false — CRUD가 DB에 반영되어야 함
    dbInstance = new Database(DB_PATH);
    dbInstance.pragma('journal_mode = WAL');
    dbInstance.pragma('foreign_keys = ON');
    return dbInstance;
  } catch (err) {
    dbInitError = err;
    console.error('[server] Failed to open DB:', err.message);
    throw err;
  }
}

// DB 접근 전 공통 미들웨어 (cold start 대응, API 경로에만 적용)
app.use('/api', (_req, res, next) => {
  try {
    getDb();
    next();
  } catch (err) {
    if (err.code === 'DB_NOT_FOUND') {
      // 스펙: 크래시 금지 — 명확한 에러 응답
      return res.status(500).json({
        success: false,
        message: 'Database file not found. Please ensure todos.db exists next to server.js.',
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Database initialization failed',
    });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function mapTodoRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    text: row.text,
    completed: !!row.completed, // 0/1 → boolean
    category: row.category,
  };
}

function mapCategoryRow(row) {
  return {
    key: row.key,
    title: row.title,
    order: row.sort_order, // sort_order → order
  };
}

function categoryExists(db, key) {
  const stmt = db.prepare('SELECT 1 FROM categories WHERE key = ?');
  return !!stmt.get(key);
}

// ---------------------------------------------------------------------------
// Routes: categories
// ---------------------------------------------------------------------------
app.get('/api/categories', (_req, res) => {
  try {
    const db = getDb();
    const rows = db
      .prepare('SELECT key, title, sort_order FROM categories ORDER BY sort_order ASC')
      .all();
    res.json({ success: true, data: rows.map(mapCategoryRow) });
  } catch (err) {
    console.error('[GET /api/categories]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch categories' });
  }
});

// ---------------------------------------------------------------------------
// Routes: todos
// ---------------------------------------------------------------------------
app.get('/api/todos', (_req, res) => {
  try {
    const db = getDb();
    const rows = db
      .prepare('SELECT id, text, completed, category FROM todos ORDER BY id ASC')
      .all();
    res.json({ success: true, data: rows.map(mapTodoRow) });
  } catch (err) {
    console.error('[GET /api/todos]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch todos' });
  }
});

app.post('/api/todos', (req, res) => {
  try {
    const { text, category } = req.body || {};

    if (typeof text !== 'string' || text.trim() === '') {
      return res
        .status(400)
        .json({ success: false, message: 'Field "text" is required and must be a non-empty string' });
    }
    if (typeof category !== 'string' || category.trim() === '') {
      return res
        .status(400)
        .json({ success: false, message: 'Field "category" is required' });
    }

    const db = getDb();

    if (!categoryExists(db, category)) {
      return res
        .status(400)
        .json({ success: false, message: `Unknown category: ${category}` });
    }

    const insert = db.prepare(
      'INSERT INTO todos (text, completed, category) VALUES (?, 0, ?) RETURNING id, text, completed, category'
    );
    const row = insert.get(text.trim(), category);

    res.status(201).json({ success: true, data: mapTodoRow(row) });
  } catch (err) {
    console.error('[POST /api/todos]', err);
    res.status(500).json({ success: false, message: 'Failed to create todo' });
  }
});

app.patch('/api/todos/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id, text, completed, category FROM todos WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Todo not found' });
    }

    const { completed, text } = req.body || {};
    const updates = [];
    const params = [];

    if (typeof completed === 'boolean') {
      updates.push('completed = ?');
      params.push(completed ? 1 : 0);
    } else if (completed !== undefined) {
      return res
        .status(400)
        .json({ success: false, message: '"completed" must be boolean' });
    }

    if (typeof text === 'string') {
      if (text.trim() === '') {
        return res
          .status(400)
          .json({ success: false, message: '"text" must be a non-empty string' });
      }
      updates.push('text = ?');
      params.push(text.trim());
    } else if (text !== undefined) {
      return res.status(400).json({ success: false, message: '"text" must be a string' });
    }

    if (updates.length === 0) {
      // 변경사항 없음 — 현재 상태 그대로 반환
      return res.json({ success: true, data: mapTodoRow(existing) });
    }

    params.push(id);
    const sql = `UPDATE todos SET ${updates.join(', ')} WHERE id = ? RETURNING id, text, completed, category`;
    const row = db.prepare(sql).get(...params);
    res.json({ success: true, data: mapTodoRow(row) });
  } catch (err) {
    console.error('[PATCH /api/todos/:id]', err);
    res.status(500).json({ success: false, message: 'Failed to update todo' });
  }
});

app.delete('/api/todos/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id, text, completed, category FROM todos WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Todo not found' });
    }

    db.prepare('DELETE FROM todos WHERE id = ?').run(id);
    res.json({ success: true, data: mapTodoRow(existing) });
  } catch (err) {
    console.error('[DELETE /api/todos/:id]', err);
    res.status(500).json({ success: false, message: 'Failed to delete todo' });
  }
});

// ---------------------------------------------------------------------------
// SPA fallback (Express 5 wildcard 문법)
// ---------------------------------------------------------------------------
app.get('/{*splat}', (_req, res) => {
  const indexPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  res.status(404).json({ success: false, message: 'index.html not found' });
});

// ---------------------------------------------------------------------------
// Dual-mode: local listen vs serverless export
// ---------------------------------------------------------------------------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`DB path: ${DB_PATH}`);
  });
}

module.exports = app;
