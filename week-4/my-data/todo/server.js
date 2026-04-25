// server.js — Todo API
// 3-file architecture: server.js + index.html (+ optional client.js)
// Data source: ./todos.json (read once into in-memory store)
// CRUD mutations live in-memory only; restart resets to disk contents.

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_PATH = path.join(ROOT, 'todos.json');

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(express.json());
app.use(express.static(ROOT));

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------
// todos:      [{ id, text, completed, category }]
// categories: [{ key, title, order }]
let todos = [];
let categories = [];
let nextId = 1;
let storeInitialized = false;

function loadStoreFromDisk() {
  todos = [];
  categories = [];
  nextId = 1;

  let parsed;
  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf-8');
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error('[store] todos.json load failed:', err.message);
    storeInitialized = true;
    return;
  }

  if (!Array.isArray(parsed)) {
    console.warn('[store] todos.json must be a top-level array — starting empty');
    storeInitialized = true;
    return;
  }

  // Sort categories by `order` (ascending), falling back to file position.
  const entries = parsed
    .map((raw, idx) => ({ raw, idx }))
    .filter((e) => e.raw && typeof e.raw === 'object')
    .sort((a, b) => {
      const ao = Number.isFinite(a.raw.order) ? a.raw.order : a.idx + 1;
      const bo = Number.isFinite(b.raw.order) ? b.raw.order : b.idx + 1;
      return ao !== bo ? ao - bo : a.idx - b.idx;
    });

  for (const { raw, idx } of entries) {
    const key =
      typeof raw.category === 'string' && raw.category.trim()
        ? raw.category.trim().toLowerCase()
        : null;
    if (!key) {
      console.warn('[store] skipping category missing `category` field');
      continue;
    }
    const title =
      typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : key;
    const order = Number.isFinite(raw.order) ? raw.order : idx + 1;

    categories.push({ key, title, order });

    const items = Array.isArray(raw.items) ? raw.items : [];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      if (typeof item.text !== 'string' || !item.text.trim()) continue;
      todos.push({
        id: nextId++,
        text: item.text.trim(),
        completed: !!item.completed,
        category: key,
      });
    }
  }

  storeInitialized = true;
  console.log(
    `[store] initialized: ${categories.length} categories, ${todos.length} todos`
  );
}

function ensureStore() {
  if (!storeInitialized) loadStoreFromDisk();
}

// Initialize at module load (also guards serverless cold starts below).
loadStoreFromDisk();

// Lazy re-init guard for serverless cold starts.
app.use('/api', (_req, _res, next) => {
  try {
    ensureStore();
    next();
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------
function ok(res, data, message) {
  const body = { success: true, data };
  if (message) body.message = message;
  return res.json(body);
}

function fail(res, status, message) {
  return res.status(status).json({ success: false, data: null, message });
}

function parseId(raw) {
  const id = Number.parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function findTodoIndex(id) {
  return todos.findIndex((t) => t.id === id);
}

function isValidCategory(key) {
  return categories.some((c) => c.key === key);
}

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

// GET /api/todos → { success, data: [{ id, text, completed, category }] }
app.get('/api/todos', (_req, res) => {
  try {
    return ok(res, todos);
  } catch (err) {
    return fail(res, 500, err.message || 'Failed to fetch todos');
  }
});

// GET /api/categories → { success, data: [{ key, title, order }] }
app.get('/api/categories', (_req, res) => {
  try {
    const ordered = [...categories].sort((a, b) => a.order - b.order);
    return ok(res, ordered);
  } catch (err) {
    return fail(res, 500, err.message || 'Failed to fetch categories');
  }
});

// POST /api/todos  body: { text, category } → 201 + created todo
app.post('/api/todos', (req, res) => {
  try {
    const { text, category } = req.body || {};

    if (typeof text !== 'string' || !text.trim()) {
      return fail(res, 400, '`text` is required and must be a non-empty string');
    }
    if (typeof category !== 'string' || !category.trim()) {
      return fail(res, 400, '`category` is required and must be a string');
    }

    const key = category.trim().toLowerCase();
    if (!isValidCategory(key)) {
      const valid = categories.map((c) => c.key).join(', ') || '(none)';
      return fail(res, 400, `Unknown category "${key}". Valid: ${valid}`);
    }

    const todo = {
      id: nextId++,
      text: text.trim(),
      completed: false,
      category: key,
    };
    todos.push(todo);
    return res.status(201).json({ success: true, data: todo });
  } catch (err) {
    return fail(res, 500, err.message || 'Failed to create todo');
  }
});

// PATCH /api/todos/:id  body: { completed?, text? }
app.patch('/api/todos/:id', (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) return fail(res, 400, 'Invalid id');

    const idx = findTodoIndex(id);
    if (idx === -1) return fail(res, 404, `Todo ${id} not found`);

    const { completed, text } = req.body || {};
    if (completed === undefined && text === undefined) {
      return fail(res, 400, 'Provide `completed` and/or `text` in body');
    }

    if (completed !== undefined) {
      if (typeof completed !== 'boolean') {
        return fail(res, 400, '`completed` must be boolean');
      }
      todos[idx].completed = completed;
    }
    if (text !== undefined) {
      if (typeof text !== 'string' || !text.trim()) {
        return fail(res, 400, '`text` must be a non-empty string');
      }
      todos[idx].text = text.trim();
    }

    return ok(res, todos[idx]);
  } catch (err) {
    return fail(res, 500, err.message || 'Failed to update todo');
  }
});

// DELETE /api/todos/:id
app.delete('/api/todos/:id', (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) return fail(res, 400, 'Invalid id');

    const idx = findTodoIndex(id);
    if (idx === -1) return fail(res, 404, `Todo ${id} not found`);

    const [removed] = todos.splice(idx, 1);
    return ok(res, removed, 'Deleted');
  } catch (err) {
    return fail(res, 500, err.message || 'Failed to delete todo');
  }
});

// Unknown /api/* → 404 (must come before SPA fallback)
app.use('/api', (_req, res) => fail(res, 404, 'API endpoint not found'));

// ---------------------------------------------------------------------------
// SPA fallback (Express 5 wildcard syntax)
// ---------------------------------------------------------------------------
app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(ROOT, 'index.html'));
});

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  const status = err.status || 500;
  res.status(status).json({
    success: false,
    data: null,
    message: err.message || 'Internal server error',
  });
});

// ---------------------------------------------------------------------------
// Dual-mode: local listen vs serverless export
// ---------------------------------------------------------------------------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Todo server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
