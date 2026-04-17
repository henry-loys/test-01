// AI 별명 생성기 — Express + OpenAI (chat.completions JSON mode)
// 로컬: `node server.js`  /  서버리스(Vercel): module.exports = app

require('dotenv').config();

const express = require('express');
const path = require('path');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = 'gpt-4o-mini';

// ─────────────────────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname)));

// ─────────────────────────────────────────────────────────────
// OpenAI lazy init (cold start 대응)
// ─────────────────────────────────────────────────────────────
let openaiClient = null;
function getOpenAI() {
  if (openaiClient) return openaiClient;
  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    const err = new Error('OPENAI_API_KEY is not set');
    err.code = 'NO_API_KEY';
    throw err;
  }
  openaiClient = new OpenAI({ apiKey });
  return openaiClient;
}

// ─────────────────────────────────────────────────────────────
// Validation helpers
// ─────────────────────────────────────────────────────────────
const ALLOWED_TONES = ['귀여운', '시크한', '웃긴', '신비로운', '중2병'];
const ALLOWED_LANGS = ['한국어', '영어', '혼합'];

function clampCount(raw) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return 5;
  return Math.max(1, Math.min(10, n));
}

function sanitizeString(v) {
  if (typeof v !== 'string') return '';
  return v.trim();
}

function sanitizeInterests(v) {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter((x) => x.length > 0);
}

function pickAllowed(value, allowlist, fallback) {
  return allowlist.includes(value) ? value : fallback;
}

// ─────────────────────────────────────────────────────────────
// Prompt builder
// ─────────────────────────────────────────────────────────────
function buildSystemPrompt({ tone, language, count }) {
  const langRule =
    language === '한국어'
      ? '반드시 한국어 별명만 생성하세요. 영어 단어를 섞지 마세요.'
      : language === '영어'
      ? '반드시 영어 별명만 생성하세요. 한글을 섞지 마세요.'
      : '한국어와 영어가 자연스럽게 섞인 별명을 허용합니다.';

  const lengthRule =
    tone === '중2병' || tone === '신비로운'
      ? '각 별명은 5자 이상 18자 이하. (중2병/신비로운 톤은 길어도 허용)'
      : '각 별명은 5자 이상 14자 이하가 가장 이상적입니다.';

  return [
    '당신은 한국 사용자를 위한 감각적인 AI 별명 생성기입니다.',
    '아래 규칙을 엄격히 지키세요:',
    '',
    '[문화/윤리]',
    '- 한국 이름 문화와 온라인 닉네임 감성에 어울리는 별명을 만드세요.',
    '- 외설적/혐오/차별/비하/정치적 표현은 절대 금지합니다.',
    '- 실존 인물의 본명을 그대로 사용하지 마세요.',
    '',
    '[언어]',
    `- ${langRule}`,
    '',
    '[톤]',
    `- 요청된 톤은 "${tone}" 입니다. 이 톤을 매우 과장해서 모든 별명에 일관되게 반영하세요.`,
    '  · 귀여운: 말랑하고 따뜻한 느낌, 작은 것/동물/음식 모티프 활용',
    '  · 시크한: 감정 절제, 도시적/밤/미니멀 이미지, 쿨한 단어 선택',
    '  · 웃긴: 말장난, B급 감성, 반전, 과장된 호칭',
    '  · 신비로운: 별/달/심연/고대/환상 모티프, 시적 표현',
    '  · 중2병: 어둠/운명/봉인/각성 같은 과잉 중2 코드, 한자/영문 혼합 허용',
    '',
    '[형식 규칙]',
    `- ${lengthRule}`,
    `- 정확히 ${count}개의 별명을 만들고, 서로 중복되지 않게 하세요.`,
    '- 각 항목에는 "meaning" 필드를 넣고, 왜 이 별명이 어울리는지 한국어로 한 줄(25자 이내)로 설명하세요.',
    '',
    '[출력]',
    '- 반드시 아래 JSON 스키마로만 응답하세요. 다른 텍스트/주석/코드펜스를 넣지 마세요.',
    '{',
    '  "items": [',
    '    { "nickname": string, "meaning": string }',
    '  ]',
    '}',
  ].join('\n');
}

function buildUserPrompt({ name, personality, interests, tone, language, count }) {
  const lines = [
    `요청 톤: ${tone}`,
    `요청 언어: ${language}`,
    `개수: ${count}`,
  ];
  if (name) lines.push(`이름/별칭 힌트: ${name}`);
  if (personality) lines.push(`성격/특징: ${personality}`);
  if (interests.length > 0) lines.push(`관심사: ${interests.join(', ')}`);
  lines.push('', '위 정보를 바탕으로 규칙에 맞는 별명 JSON을 만들어 주세요.');
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  const hasApiKey = Boolean((process.env.OPENAI_API_KEY || '').trim());
  res.json({
    success: true,
    data: { status: 'ok', hasApiKey, model: MODEL },
  });
});

app.post('/api/generate', async (req, res) => {
  try {
    const body = req.body || {};
    const name = sanitizeString(body.name);
    const personality = sanitizeString(body.personality);
    const interests = sanitizeInterests(body.interests);
    const tone = pickAllowed(sanitizeString(body.tone), ALLOWED_TONES, '시크한');
    const language = pickAllowed(
      sanitizeString(body.language),
      ALLOWED_LANGS,
      '한국어'
    );
    const count = clampCount(body.count);

    let client;
    try {
      client = getOpenAI();
    } catch (e) {
      if (e.code === 'NO_API_KEY') {
        return res.status(500).json({
          success: false,
          message: 'OPENAI_API_KEY가 설정되지 않았습니다. .env 파일을 확인하세요.',
        });
      }
      throw e;
    }

    const systemPrompt = buildSystemPrompt({ tone, language, count });
    const userPrompt = buildUserPrompt({
      name,
      personality,
      interests,
      tone,
      language,
      count,
    });

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.95,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const raw = completion?.choices?.[0]?.message?.content || '';

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_e) {
      return res.status(502).json({
        success: false,
        message: 'AI 응답을 JSON으로 파싱하지 못했습니다.',
      });
    }

    const rawItems = Array.isArray(parsed?.items) ? parsed.items : [];

    // 정규화: nickname/meaning만 뽑고, tone/language는 요청값으로 덮어쓰기
    const seen = new Set();
    const items = [];
    for (const it of rawItems) {
      const nickname = sanitizeString(it?.nickname);
      const meaning = sanitizeString(it?.meaning);
      if (!nickname) continue;
      if (seen.has(nickname)) continue;
      seen.add(nickname);
      items.push({
        nickname,
        meaning,
        tone,
        language,
      });
      if (items.length >= count) break;
    }

    if (items.length === 0) {
      return res.status(502).json({
        success: false,
        message: 'AI가 유효한 별명을 생성하지 못했습니다. 다시 시도해 주세요.',
      });
    }

    return res.json({
      success: true,
      data: {
        items,
        model: MODEL,
      },
    });
  } catch (err) {
    const status = err?.status || err?.response?.status;
    const msg =
      err?.response?.data?.error?.message ||
      err?.message ||
      '별명 생성 중 오류가 발생했습니다.';
    // OpenAI 인증/요금/레이트 에러를 좀 더 구분
    if (status === 401) {
      return res
        .status(500)
        .json({ success: false, message: 'OpenAI 인증 실패: API 키를 확인하세요.' });
    }
    if (status === 429) {
      return res.status(429).json({
        success: false,
        message: 'OpenAI 요청 한도를 초과했습니다. 잠시 후 다시 시도하세요.',
      });
    }
    return res.status(500).json({ success: false, message: msg });
  }
});

// ─────────────────────────────────────────────────────────────
// SPA fallback (Express 4)
// ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ─────────────────────────────────────────────────────────────
// Local vs Serverless
// ─────────────────────────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[AI 별명 생성기] http://localhost:${PORT}`);
  });
}

module.exports = app;
