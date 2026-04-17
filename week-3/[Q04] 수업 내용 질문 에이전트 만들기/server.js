require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

// ========================================
// Data layer — file-based persistence
// ========================================
const DATA_DIR = path.join(__dirname, 'data');
const KB_FILE = path.join(DATA_DIR, 'knowledge.json');
const CONV_FILE = path.join(DATA_DIR, 'conversations.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}
function writeJson(file, data) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}
function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ========================================
// Seed knowledge base (first run only)
// ========================================
const SEED_KB = [
  {
    id: 'seed-001',
    kind: 'text',
    title: '하버스쿨 AI 공장장 기초반 커리큘럼 개요',
    content:
      '코스명: AI Factory Manager (AI 공장장 기초반).\n' +
      '총 49개 영상으로 구성된 8주 부트캠프.\n' +
      '1-4주차: AI 에이전트로 배우는 웹/백엔드 기초.\n' +
      '5-8주차: 실전 프로젝트 및 개인 프로젝트.\n' +
      '추가 모듈: 프론트엔드, 백엔드, 데이터베이스, 인증 심화.\n' +
      '공식 강의실: https://agentic.harbor.school/courses/ai-factory-manager/classroom',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'seed-002',
    kind: 'text',
    title: '1주차 Part 1 — AI 도구 기초 (35:27)',
    content:
      '주요 내용:\n' +
      '- 필수 AI 개발 도구 설정 및 개요 (Cursor, CLI)\n' +
      '- CLI 도구 시연: ClaudeCode 및 유사 도구\n' +
      '- 로컬 AI 모델 설치 및 하드웨어 요구사항\n' +
      '- AI Context 이해: 텍스트 기반 정보 활용\n' +
      '- 마크다운 및 코드 형식을 통한 상호작용\n' +
      '- AI 관리 철학 요약',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'seed-003',
    kind: 'text',
    title: '참고 링크',
    content:
      '강의실: https://agentic.harbor.school/courses/ai-factory-manager/classroom\n' +
      '수업 자료 (Notion): https://ruucm.notion.site/32a7eb4baa8c80f3b49fdaf4bc1dcf69',
    createdAt: new Date().toISOString(),
  },
];

function initKB() {
  if (!fs.existsSync(KB_FILE)) {
    writeJson(KB_FILE, SEED_KB);
  }
  if (!fs.existsSync(CONV_FILE)) {
    writeJson(CONV_FILE, []);
  }
}
initKB();

// ========================================
// Middleware
// ========================================
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname)));

// ========================================
// OpenAI client (lazy init)
// ========================================
let openaiClient = null;
function getOpenAI() {
  if (openaiClient) return openaiClient;
  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    const err = new Error('OPENAI_API_KEY is not set. Create .env or set the environment variable.');
    err.status = 500;
    throw err;
  }
  openaiClient = new OpenAI({ apiKey });
  return openaiClient;
}

// ========================================
// Knowledge Base API
// ========================================
function validateKbItem(body) {
  const kind = body?.kind === 'code' ? 'code' : 'text';
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const content = typeof body?.content === 'string' ? body.content : '';
  const language = typeof body?.language === 'string' ? body.language.trim() : '';
  if (!title) return { error: 'title은 필수입니다.' };
  if (!content.trim()) return { error: 'content는 비어있을 수 없습니다.' };
  return { kind, title, content, language };
}

app.get('/api/knowledge', (_req, res) => {
  const items = readJson(KB_FILE, []);
  res.json({ success: true, data: { items } });
});

app.post('/api/knowledge', (req, res) => {
  const v = validateKbItem(req.body || {});
  if (v.error) return res.status(400).json({ success: false, message: v.error });
  const items = readJson(KB_FILE, []);
  const item = {
    id: newId(),
    kind: v.kind,
    title: v.title,
    language: v.language || undefined,
    content: v.content,
    createdAt: new Date().toISOString(),
  };
  items.push(item);
  writeJson(KB_FILE, items);
  res.json({ success: true, data: { item } });
});

app.patch('/api/knowledge/:id', (req, res) => {
  const items = readJson(KB_FILE, []);
  const idx = items.findIndex((i) => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: '해당 항목이 없습니다.' });
  const v = validateKbItem({ ...items[idx], ...(req.body || {}) });
  if (v.error) return res.status(400).json({ success: false, message: v.error });
  items[idx] = {
    ...items[idx],
    kind: v.kind,
    title: v.title,
    language: v.language || undefined,
    content: v.content,
    updatedAt: new Date().toISOString(),
  };
  writeJson(KB_FILE, items);
  res.json({ success: true, data: { item: items[idx] } });
});

app.delete('/api/knowledge/:id', (req, res) => {
  const items = readJson(KB_FILE, []);
  const next = items.filter((i) => i.id !== req.params.id);
  if (next.length === items.length) {
    return res.status(404).json({ success: false, message: '해당 항목이 없습니다.' });
  }
  writeJson(KB_FILE, next);
  res.json({ success: true });
});

// ========================================
// Conversation API — thread-based memory
// ========================================
app.get('/api/conversations', (_req, res) => {
  const list = readJson(CONV_FILE, []);
  const summary = list.map((c) => ({
    id: c.id,
    title: c.title,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    messageCount: (c.messages || []).length,
  }));
  res.json({ success: true, data: { conversations: summary } });
});

app.post('/api/conversations', (req, res) => {
  const list = readJson(CONV_FILE, []);
  const title = typeof req.body?.title === 'string' && req.body.title.trim()
    ? req.body.title.trim()
    : '새 대화';
  const conv = {
    id: newId(),
    title,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [],
  };
  list.unshift(conv);
  writeJson(CONV_FILE, list);
  res.json({ success: true, data: { conversation: conv } });
});

app.get('/api/conversations/:id', (req, res) => {
  const list = readJson(CONV_FILE, []);
  const conv = list.find((c) => c.id === req.params.id);
  if (!conv) return res.status(404).json({ success: false, message: '대화가 없습니다.' });
  res.json({ success: true, data: { conversation: conv } });
});

app.delete('/api/conversations/:id', (req, res) => {
  const list = readJson(CONV_FILE, []);
  const next = list.filter((c) => c.id !== req.params.id);
  if (next.length === list.length) {
    return res.status(404).json({ success: false, message: '대화가 없습니다.' });
  }
  writeJson(CONV_FILE, next);
  res.json({ success: true });
});

// ========================================
// /api/conversations/:id/messages — 질문하면 KB + 이전 대화 맥락을 반영해 답변
// ========================================
function buildKbBlock(kbItems) {
  if (!kbItems.length) return '(지식 베이스가 비어 있습니다.)';
  return kbItems
    .map((it, i) => {
      const header = `[#${i + 1}] (${it.kind}${it.language ? `:${it.language}` : ''}) ${it.title}  (id=${it.id})`;
      const body = it.kind === 'code'
        ? '```' + (it.language || '') + '\n' + it.content + '\n```'
        : it.content;
      return `${header}\n${body}`;
    })
    .join('\n\n---\n\n');
}

function buildSystemPrompt(kbItems) {
  return [
    '당신은 수업 내용을 정확하게 알려주는 한국어 학습 도우미 에이전트입니다.',
    '',
    '[역할]',
    '- 수강생이 수업에서 배운 개념, 실습 코드, 과제에 대해 질문하면 아래 [지식 베이스]만을 근거로 답변합니다.',
    '- 필요하면 관련 코드 블록을 그대로 인용하여 보여주세요.',
    '- 답변의 근거가 된 지식 베이스 항목은 답변 끝에 "참고: [#1], [#3]" 형태로 표기합니다.',
    '- 지식 베이스에 없는 내용을 물으면 추측하지 말고 "해당 내용은 현재 지식 베이스에 없습니다. 강의 노트를 추가해 주세요." 라고 답하세요.',
    '- 이전 대화 맥락을 기억해서, 후속 질문("그럼 그건 왜?", "아까 말한 그거 좀 더 설명해줘")에도 맥락을 이어 답변합니다.',
    '- 답변은 한국어, Markdown 포맷(필요 시 코드 블록 사용). 불필요하게 장황하지 않게, 핵심을 먼저.',
    '',
    '[지식 베이스]',
    buildKbBlock(kbItems),
  ].join('\n');
}

function extractCitations(text, kbItems) {
  const ids = new Set();
  const re = /\[#(\d+)\]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const idx = parseInt(m[1], 10) - 1;
    if (kbItems[idx]) ids.add(kbItems[idx].id);
  }
  return Array.from(ids);
}

app.post('/api/conversations/:id/messages', async (req, res) => {
  try {
    const { message } = req.body || {};
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: 'message는 비어있지 않은 문자열이어야 합니다.',
      });
    }

    const list = readJson(CONV_FILE, []);
    const idx = list.findIndex((c) => c.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, message: '대화가 없습니다.' });
    const conv = list[idx];

    const kbItems = readJson(KB_FILE, []);
    const systemText = buildSystemPrompt(kbItems);

    const trimmedHistory = (conv.messages || []).slice(-12);
    const priorMessages = trimmedHistory
      .filter((h) => h && typeof h.content === 'string' && h.content.trim())
      .map((h) => ({
        role: h.role === 'assistant' ? 'assistant' : 'user',
        content: h.content,
      }));

    const client = getOpenAI();
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      max_tokens: 1200,
      messages: [
        { role: 'system', content: systemText },
        ...priorMessages,
        { role: 'user', content: message.trim() },
      ],
    });

    const answer = (completion.choices?.[0]?.message?.content || '').trim();
    const citations = extractCitations(answer, kbItems);
    const now = new Date().toISOString();

    const userMsg = { id: newId(), role: 'user', content: message.trim(), createdAt: now };
    const aiMsg = {
      id: newId(),
      role: 'assistant',
      content: answer,
      citations,
      model: completion.model,
      createdAt: now,
    };
    conv.messages.push(userMsg, aiMsg);
    conv.updatedAt = now;

    // 첫 메시지라면 제목을 질문 앞부분에서 자동 생성
    if (conv.title === '새 대화' && conv.messages.length <= 2) {
      conv.title = message.trim().slice(0, 24);
    }

    list[idx] = conv;
    writeJson(CONV_FILE, list);

    res.json({
      success: true,
      data: { userMessage: userMsg, assistantMessage: aiMsg, conversation: conv },
    });
  } catch (err) {
    console.error('[/api/conversations/:id/messages] error:', err);
    const status = err.status || err.statusCode || 500;
    res.status(status).json({
      success: false,
      message: err.message || 'AI 응답 생성 중 오류가 발생했습니다.',
    });
  }
});

// ========================================
// GET /api/health
// ========================================
app.get('/api/health', (_req, res) => {
  const kb = readJson(KB_FILE, []);
  const conv = readJson(CONV_FILE, []);
  res.json({
    success: true,
    data: {
      status: 'ok',
      hasApiKey: !!(process.env.OPENAI_API_KEY || '').trim(),
      model: 'gpt-4o-mini',
      knowledgeCount: kb.length,
      conversationCount: conv.length,
    },
  });
});

// ========================================
// SPA fallback (Express 4 호환)
// ========================================
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ========================================
// Error handler
// ========================================
app.use((err, _req, res, _next) => {
  const status = err?.status || 500;
  res.status(status).json({
    success: false,
    message: err?.message || 'Internal server error.',
  });
});

// ========================================
// Local: start / Vercel: export
// ========================================
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    if (!(process.env.OPENAI_API_KEY || '').trim()) {
      console.warn('⚠️  OPENAI_API_KEY 가 설정되지 않았습니다.');
    }
  });
}
module.exports = app;
