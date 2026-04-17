require('dotenv').config();
const express = require('express');
const path = require('path');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname)));

// ========================================
// OpenAI client (lazy init for serverless)
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
// Persona → System prompt
// ========================================
const PERSONALITY_MAP = {
  friendly:     '친근하고 따뜻하며 상대에게 편안함을 주는',
  professional: '전문적이고 신뢰할 수 있으며 근거를 가지고 설명하는',
  playful:      '장난스럽고 유머러스하며 발랄한',
  calm:         '차분하고 침착하며 경청하는',
  enthusiastic: '열정적이고 에너지 넘치며 동기부여를 주는',
};

const TONE_MAP = {
  banmal: '반말체 (친구에게 편하게 말하듯)',
  polite: '존댓말 (정중하고 부드럽게)',
  cute:   '귀여운 말투 (적절한 이모지·애교 섞인 표현)',
  formal: '격식체 (공식 문서 톤, "~합니다")',
};

function buildSystemPrompt(persona) {
  const name = (persona?.name || '').trim() || 'AI';
  const title = (persona?.title || '').trim();
  const personalityDesc = PERSONALITY_MAP[persona?.personality] || PERSONALITY_MAP.friendly;
  const toneDesc = TONE_MAP[persona?.tone] || TONE_MAP.polite;
  const expertise = (persona?.expertise || '').trim();
  const bio = (persona?.bio || '').trim();
  const systemExtra = (persona?.systemExtra || '').trim();

  return [
    `당신은 "${name}"${title ? ` (${title})` : ''} 라는 이름의 AI 대화 상대입니다.`,
    '',
    `[성격] ${personalityDesc} 성격으로 대화합니다.`,
    `[말투] 반드시 ${toneDesc}로 답변합니다. 말투를 도중에 바꾸지 마세요.`,
    expertise ? `[전문 분야] ${expertise} 분야의 전문가이며, 관련 질문에 이 관점을 자연스럽게 녹입니다.` : '',
    bio ? `[프로필 소개] ${bio}` : '',
    '',
    systemExtra ? '[세부 페르소나 설정]' : '',
    systemExtra,
    systemExtra ? '' : '',
    '[답변 원칙]',
    '- 언제나 한국어로 답변합니다.',
    '- 설정된 페르소나를 한 줄도 깨지 마세요. 질문 주제와 상관없이 페르소나의 세계관·말투·성격으로 응답합니다.',
    '- 답변은 간결하되 질문이 요구할 때만 자세히 설명합니다.',
    '- 사람이 말하듯 자연스러운 문장으로 작성합니다.',
    '- 불확실한 사실은 추측하지 말고 모른다고 답합니다.',
  ].filter(Boolean).join('\n');
}

// ========================================
// POST /api/chat  — 페르소나 기반 AI 응답 생성
// Body: { persona, message, history? }
// ========================================
app.post('/api/chat', async (req, res) => {
  try {
    const { persona = {}, message, history = [] } = req.body || {};

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: 'message는 비어있지 않은 문자열이어야 합니다.',
      });
    }

    const client = getOpenAI();
    const systemText = buildSystemPrompt(persona);

    const creativityRaw = typeof persona.creativity === 'number' ? persona.creativity : 0.7;
    const temperature = Math.max(0, Math.min(1.3, creativityRaw * 1.3));

    const trimmedHistory = Array.isArray(history) ? history.slice(-12) : [];
    const priorMessages = trimmedHistory
      .filter(h => h && typeof h.content === 'string' && h.content.trim())
      .map(h => ({
        role: h.role === 'ai' || h.role === 'assistant' ? 'assistant' : 'user',
        content: h.content,
      }));

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: systemText },
        ...priorMessages,
        { role: 'user', content: message.trim() },
      ],
    });

    const text = (completion.choices?.[0]?.message?.content || '').trim();

    res.json({
      success: true,
      data: {
        content: text,
        model: completion.model,
        usage: completion.usage,
      },
    });
  } catch (err) {
    console.error('[/api/chat] error:', err);
    const status = err.status || err.statusCode || 500;
    res.status(status).json({
      success: false,
      message: err.message || 'AI 응답 생성 중 오류가 발생했습니다.',
    });
  }
});

// ========================================
// POST /api/quiz  — 프로필 변경용 퀴즈 생성
// Body: { persona }
// Response data: { question, answer, hint }
// ========================================
app.post('/api/quiz', async (req, res) => {
  try {
    const { persona = {} } = req.body || {};
    const client = getOpenAI();

    const name = (persona.name || 'AI').trim();
    const title = (persona.title || '').trim();
    const expertise = (persona.expertise || '').trim();
    const systemExtra = (persona.systemExtra || '').trim();

    const system = [
      `당신은 "${name}"${title ? ` (${title})` : ''} 라는 페르소나입니다.`,
      expertise ? `전문 분야: ${expertise}` : '',
      systemExtra ? `세부 설정:\n${systemExtra}` : '',
      '',
      '사용자가 당신을 다른 페르소나로 교체하려 합니다. 당신은 그 전에 짧은 퀴즈를 한 문제 출제합니다.',
      '',
      '엄격한 출제 규칙:',
      '- 정답은 매우 짧고 명확해야 합니다 (1~15자, 한 단어나 짧은 구).',
      '- 대소문자·띄어쓰기로 판정이 애매해지는 문제는 금지.',
      '- 일반 상식 수준에서 생각해낼 수 있는 난이도로 출제 (너무 어렵거나 마니악하지 않게).',
      '- 당신의 세계관·전문분야 테마로 내세요.',
      '- 문제는 당신의 말투·성격을 반영해 작성합니다.',
      '- 힌트는 정답을 직접 포함하지 않되, 한 스텝만 더 가면 풀리도록 간결하게.',
      '',
      '반드시 아래 JSON 스키마로만 응답하세요. 다른 텍스트 금지.',
      '{ "question": string, "answer": string, "hint": string }',
    ].filter(Boolean).join('\n');

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.9,
      max_tokens: 400,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: '퀴즈를 한 문제 출제해주세요.' },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content || '{}';
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return res.status(502).json({ success: false, message: '퀴즈 JSON 파싱 실패', raw });
    }
    if (!parsed.question || !parsed.answer) {
      return res.status(502).json({ success: false, message: '퀴즈 형식 오류 (question/answer 누락)' });
    }

    res.json({
      success: true,
      data: {
        question: String(parsed.question),
        answer: String(parsed.answer),
        hint: String(parsed.hint || ''),
      },
    });
  } catch (err) {
    console.error('[/api/quiz] error:', err);
    res.status(err.status || 500).json({
      success: false,
      message: err.message || '퀴즈 생성 중 오류가 발생했습니다.',
    });
  }
});

// ========================================
// GET /api/health  — 상태 확인
// ========================================
app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      hasApiKey: !!(process.env.OPENAI_API_KEY || '').trim(),
      model: 'gpt-4o-mini',
    },
  });
});

// ========================================
// SPA fallback (Express 5 문법)
// ========================================
app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ========================================
// Local: start server / Vercel: export app
// ========================================
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    if (!(process.env.OPENAI_API_KEY || '').trim()) {
      console.warn('⚠️  OPENAI_API_KEY 가 설정되지 않았습니다. /api/chat 호출 시 오류가 발생합니다.');
    }
  });
}
module.exports = app;
