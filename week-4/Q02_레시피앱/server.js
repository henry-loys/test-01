// server.js — Recipe App (식재료 인벤토리) REST API + static host
// Single-file backend: serves index.html and exposes /api/ingredients and
// /api/recipes CRUD backed by a Supabase PostgreSQL database via `pg`.

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Pool, types } = require('pg');
require('dotenv').config();

// pg returns NUMERIC as a string by default (to preserve precision). Our
// `quantity` column is small enough to fit in a JS number, and the original
// SQLite store returned numbers — keep that contract by parsing NUMERIC (OID
// 1700) to float so the client receives the same JSON shape it always has.
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));

const app = express();
const PORT = process.env.PORT || 3001;

// ---------------------------------------------------------------------------
// PostgreSQL connection (Supabase pooler — port 6543, transaction mode).
// Read discrete env vars (no URL parsing of special chars). Trim every value
// to defend against trailing newlines that some platforms inject.
// ---------------------------------------------------------------------------
const pool = new Pool({
  user: (process.env.PGUSER || '').trim(),
  password: (process.env.PGPASSWORD || '').trim(),
  host: (process.env.PGHOST || '').trim(),
  port: parseInt((process.env.PGPORT || '6543').trim(), 10),
  database: (process.env.PGDATABASE || 'postgres').trim(),
  ssl: { rejectUnauthorized: false },
});

// ---------------------------------------------------------------------------
// Middleware (registered up front so /api works after lazy-init kicks in).
// ---------------------------------------------------------------------------
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ---------------------------------------------------------------------------
// Seed data — exact copy of the 11 items currently in ingredients.json.
// Used by POST /api/ingredients/reset and by first-run table seeding.
// ---------------------------------------------------------------------------
const SEED_INGREDIENTS = [
  {
    id: 'cheese',
    name: '체다 슬라이스 치즈',
    nameEn: 'Cheddar Cheese',
    category: '유제품/난류',
    quantity: 12,
    unit: '장',
    expiryDate: '2026-06-01',
    storage: '냉장',
    emoji: '🧀',
  },
  {
    id: 'egg',
    name: '계란',
    nameEn: 'Egg',
    category: '유제품/난류',
    quantity: 10,
    unit: '개',
    expiryDate: '2026-05-10',
    storage: '냉장',
    emoji: '🥚',
  },
  {
    id: 'garlic',
    name: '마늘',
    nameEn: 'Garlic',
    category: '채소',
    quantity: 200,
    unit: 'g',
    expiryDate: '2026-06-10',
    storage: '냉장',
    emoji: '🧄',
  },
  {
    id: 'green_onion',
    name: '대파',
    nameEn: 'Green Onion',
    category: '채소',
    quantity: 2,
    unit: '단',
    expiryDate: '2026-05-05',
    storage: '냉장',
    emoji: '🌿',
  },
  {
    id: 'ice_cream',
    name: '바닐라 아이스크림',
    nameEn: 'Vanilla Ice Cream',
    category: '디저트',
    quantity: 1,
    unit: '통',
    expiryDate: '2026-10-25',
    storage: '냉동',
    emoji: '🍨',
  },
  {
    id: 'kimchi',
    name: '김치',
    nameEn: 'Kimchi',
    category: '반찬/장류',
    quantity: 500,
    unit: 'g',
    expiryDate: '2026-07-15',
    storage: '냉장',
    emoji: '🥬',
  },
  {
    id: 'milk',
    name: '우유',
    nameEn: 'Milk',
    category: '유제품/난류',
    quantity: 1,
    unit: 'L',
    expiryDate: '2026-05-02',
    storage: '냉장',
    emoji: '🥛',
  },
  {
    id: 'onion',
    name: '양파',
    nameEn: 'Onion',
    category: '채소',
    quantity: 3,
    unit: '개',
    expiryDate: '2026-05-20',
    storage: '냉장',
    emoji: '🧅',
  },
  {
    id: 'pork_belly',
    name: '삼겹살',
    nameEn: 'Pork Belly',
    category: '육류',
    quantity: 600,
    unit: 'g',
    expiryDate: '2026-04-28',
    storage: '냉장',
    emoji: '🥩',
  },
  {
    id: 'soy_sauce',
    name: '간장',
    nameEn: 'Soy Sauce',
    category: '반찬/장류',
    quantity: 500,
    unit: 'ml',
    expiryDate: '2027-03-15',
    storage: '냉장',
    emoji: '🍶',
  },
  {
    id: 'tofu',
    name: '두부',
    nameEn: 'Tofu',
    category: '콩류',
    quantity: 1,
    unit: '모',
    expiryDate: '2026-04-30',
    storage: '냉장',
    emoji: '🍱',
  },
];

// ---------------------------------------------------------------------------
// Lazy DB init — creates tables on first call and seeds ingredients if empty.
// Guarded with `dbInitialized` so cold-start serverless invocations don't
// hammer the schema repeatedly.
// ---------------------------------------------------------------------------
let dbInitialized = false;

async function initDB() {
  if (dbInitialized) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ingredients (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      "nameEn"     TEXT,
      category     TEXT,
      quantity     NUMERIC,
      unit         TEXT,
      "expiryDate" TEXT,
      storage      TEXT,
      emoji        TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS recipes (
      id           TEXT PRIMARY KEY,
      title        TEXT NOT NULL,
      ingredients  JSONB NOT NULL,
      steps        JSONB NOT NULL,
      "createdAt"  TEXT NOT NULL
    )
  `);

  // First-run: if table is empty, populate from SEED_INGREDIENTS.
  const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM ingredients');
  if (rows[0].c === 0) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const item of SEED_INGREDIENTS) {
        await client.query(
          `INSERT INTO ingredients (id, name, "nameEn", category, quantity, unit, "expiryDate", storage, emoji)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            item.id,
            item.name,
            item.nameEn ?? null,
            item.category ?? null,
            item.quantity ?? null,
            item.unit ?? null,
            item.expiryDate ?? null,
            item.storage ?? null,
            item.emoji ?? null,
          ]
        );
      }
      await client.query('COMMIT');
      console.log(`[server] seeded ${SEED_INGREDIENTS.length} ingredients into Postgres`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  dbInitialized = true;
}

// Apply lazy-init in front of every /api request.
app.use('/api', async (_req, res, next) => {
  try {
    await initDB();
    next();
  } catch (err) {
    console.error('[server] initDB failed:', err);
    res.status(500).json({
      success: false,
      message: 'Database initialization failed',
    });
  }
});

// ---------------------------------------------------------------------------
// Ingredients API
// ---------------------------------------------------------------------------

// GET /api/ingredients — read & return the live list
app.get('/api/ingredients', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, "nameEn", category, quantity, unit, "expiryDate", storage, emoji FROM ingredients ORDER BY id'
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: `Failed to read ingredients: ${err.message}`,
    });
  }
});

// POST /api/ingredients — append a new ingredient
app.post('/api/ingredients', async (req, res) => {
  try {
    const body = req.body || {};
    const { id, name } = body;

    if (typeof id !== 'string' || id.trim() === '' ||
        typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Required fields missing: "id" and "name" must be non-empty strings.',
      });
    }

    try {
      const { rows } = await pool.query(
        `INSERT INTO ingredients (id, name, "nameEn", category, quantity, unit, "expiryDate", storage, emoji)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, name, "nameEn", category, quantity, unit, "expiryDate", storage, emoji`,
        [
          id,
          name,
          body.nameEn ?? null,
          body.category ?? null,
          body.quantity ?? null,
          body.unit ?? null,
          body.expiryDate ?? null,
          body.storage ?? null,
          body.emoji ?? null,
        ]
      );
      return res.status(201).json({ success: true, data: rows[0] });
    } catch (e) {
      // 23505 = unique_violation in PostgreSQL
      if (e && e.code === '23505') {
        return res.status(409).json({
          success: false,
          message: `Ingredient with id "${id}" already exists.`,
        });
      }
      throw e;
    }
  } catch (err) {
    res.status(500).json({
      success: false,
      message: `Failed to create ingredient: ${err.message}`,
    });
  }
});

// DELETE /api/ingredients/:id — remove by id
app.delete('/api/ingredients/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM ingredients WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: `Ingredient with id "${id}" not found.`,
      });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: `Failed to delete ingredient: ${err.message}`,
    });
  }
});

// POST /api/ingredients/reset — restore to SEED_INGREDIENTS in a transaction
app.post('/api/ingredients/reset', async (_req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM ingredients');
    for (const item of SEED_INGREDIENTS) {
      await client.query(
        `INSERT INTO ingredients (id, name, "nameEn", category, quantity, unit, "expiryDate", storage, emoji)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          item.id,
          item.name,
          item.nameEn ?? null,
          item.category ?? null,
          item.quantity ?? null,
          item.unit ?? null,
          item.expiryDate ?? null,
          item.storage ?? null,
          item.emoji ?? null,
        ]
      );
    }
    await client.query('COMMIT');

    const { rows } = await client.query(
      'SELECT id, name, "nameEn", category, quantity, unit, "expiryDate", storage, emoji FROM ingredients ORDER BY id'
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({
      success: false,
      message: `Failed to reset ingredients: ${err.message}`,
    });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// Recipes API — backed by the same Postgres database
// ---------------------------------------------------------------------------

// GET /api/recipes — list recipes (newest first). JSONB columns come back as
// native JS arrays/objects, so no JSON.parse needed.
app.get('/api/recipes', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, title, ingredients, steps, "createdAt" FROM recipes ORDER BY "createdAt" DESC'
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: `Failed to read recipes: ${err.message}`,
    });
  }
});

// POST /api/recipes — create a new recipe
app.post('/api/recipes', async (req, res) => {
  try {
    const body = req.body || {};
    const { title, ingredients, steps } = body;

    if (typeof title !== 'string' || title.trim() === '') {
      return res.status(400).json({
        success: false,
        message: '레시피 제목(title)을 입력해 주세요.',
      });
    }
    if (!Array.isArray(ingredients) || ingredients.length === 0) {
      return res.status(400).json({
        success: false,
        message: '재료(ingredients)는 비어 있지 않은 배열이어야 해요.',
      });
    }
    if (!Array.isArray(steps) || steps.length === 0) {
      return res.status(400).json({
        success: false,
        message: '조리 순서(steps)는 비어 있지 않은 배열이어야 해요.',
      });
    }

    const id =
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `recipe_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const createdAt = new Date().toISOString();

    const { rows } = await pool.query(
      `INSERT INTO recipes (id, title, ingredients, steps, "createdAt")
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)
       RETURNING id, title, ingredients, steps, "createdAt"`,
      [id, title.trim(), JSON.stringify(ingredients), JSON.stringify(steps), createdAt]
    );

    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: `Failed to create recipe: ${err.message}`,
    });
  }
});

// POST /api/recipes/generate — generate (but don't save) a recipe via OpenAI
// using the current ingredients in the database. Prioritizes items closest to
// expiry. Response shape matches what POST /api/recipes accepts, so the client
// can save the preview verbatim.
app.post('/api/recipes/generate', async (req, res) => {
  try {
    const apiKey = (process.env.OPENAI_API_KEY || '').trim();
    if (!apiKey) {
      return res.status(500).json({
        success: false,
        message: 'OPENAI_API_KEY 환경변수가 설정되어 있지 않아요.',
      });
    }

    const { rows: ingredients } = await pool.query(
      `SELECT name, "nameEn", category, quantity, unit, "expiryDate", storage, emoji
         FROM ingredients
        ORDER BY "expiryDate" NULLS LAST`
    );

    if (ingredients.length === 0) {
      return res.status(400).json({
        success: false,
        message: '냉장고에 재료가 없어요. 먼저 재료를 추가해 주세요.',
      });
    }

    const hints = (req.body && typeof req.body.hints === 'string')
      ? req.body.hints.trim()
      : '';

    const today = new Date().toISOString().slice(0, 10);
    const inventory = ingredients.map((i) => {
      const qty = i.quantity != null ? ` ${i.quantity}${i.unit || ''}` : '';
      return `- ${i.emoji ? i.emoji + ' ' : ''}${i.name}${qty} (유통기한 ${i.expiryDate || '미상'}, ${i.storage || ''})`;
    }).join('\n');

    const systemPrompt = `당신은 한국 가정식 전문 셰프입니다. 사용자의 냉장고 재료를 보고 한국 가정식 레시피 1개를 추천하세요.

원칙:
- 2인분 기준
- 조리 시간 20분 이내
- 초급자도 만족할 수 있는 친숙한 가정식
- 유통기한이 임박한 재료를 우선 활용
- 조리 순서는 한 단계씩 명확하고 짧게 (3~7단계)

반드시 다음 JSON 스키마로만 응답하세요. 다른 설명/머리말/꼬리말 금지.
{
  "title": "요리명 (한국어)",
  "ingredients": [
    {"name": "재료명 (한국어)", "source": "fridge | extra"}
  ],
  "steps": ["1단계 설명", "2단계 설명", "..."]
}

source 규칙:
- 사용자의 냉장고에 이미 있는 재료면 "fridge"
- 냉장고에 없는데 추가로 필요한 재료(소금, 후추, 설탕, 식용유 등)면 "extra"`;

    const userPrompt = `오늘 날짜: ${today}

냉장고 재료 목록 (유통기한 임박 순):
${inventory}
${hints ? `\n사용자 추가 요청사항: ${hints}` : ''}

위 재료 중 유통기한이 가까운 것을 우선해서 한국 가정식 레시피 1개를 만들어 주세요.`;

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.7,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!openaiRes.ok) {
      const text = await openaiRes.text().catch(() => '');
      console.error('[server] OpenAI error:', openaiRes.status, text);
      return res.status(502).json({
        success: false,
        message: `AI 응답 실패 (${openaiRes.status})`,
      });
    }

    const data = await openaiRes.json();
    const content = data?.choices?.[0]?.message?.content || '';

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      return res.status(502).json({
        success: false,
        message: 'AI가 올바른 JSON을 반환하지 않았어요.',
      });
    }

    const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
    const rawIngredients = Array.isArray(parsed.ingredients) ? parsed.ingredients : [];
    const steps = Array.isArray(parsed.steps)
      ? parsed.steps.map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean)
      : [];

    const fridgeMap = new Map(ingredients.map((i) => [i.name, i.emoji || '']));
    const normalizedIngredients = rawIngredients
      .map((ing) => {
        if (!ing || typeof ing.name !== 'string' || !ing.name.trim()) return null;
        const name = ing.name.trim();
        const inFridge = fridgeMap.has(name);
        return {
          name,
          source: inFridge ? 'fridge' : (ing.source === 'fridge' ? 'fridge' : 'extra'),
          emoji: inFridge ? fridgeMap.get(name) : '',
        };
      })
      .filter(Boolean);

    if (!title || normalizedIngredients.length === 0 || steps.length === 0) {
      return res.status(502).json({
        success: false,
        message: 'AI 응답이 비어 있거나 형식이 올바르지 않아요.',
      });
    }

    res.json({
      success: true,
      data: { title, ingredients: normalizedIngredients, steps },
    });
  } catch (err) {
    console.error('[server] generate failed:', err);
    res.status(500).json({
      success: false,
      message: `Failed to generate recipe: ${err.message}`,
    });
  }
});

// DELETE /api/recipes/:id — delete a recipe by id
app.delete('/api/recipes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM recipes WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: '레시피를 찾을 수 없어요.',
      });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: `Failed to delete recipe: ${err.message}`,
    });
  }
});

// ---------------------------------------------------------------------------
// Error handling middleware (final safety net)
// ---------------------------------------------------------------------------
app.use((err, _req, res, _next) => {
  console.error('[server] unhandled error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error.',
  });
});

// ---------------------------------------------------------------------------
// Local / serverless dual-mode startup
// ---------------------------------------------------------------------------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Recipe app server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
