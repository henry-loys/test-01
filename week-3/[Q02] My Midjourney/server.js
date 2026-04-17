require('dotenv').config();

const express = require('express');
const path = require('path');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Config ----------
const MODEL = 'dall-e-3';
const MAX_PROMPT_LENGTH = 4000;
const MAX_COUNT = 4;

// DALL-E 3 에서 허용하는 size 는 3가지 뿐이므로 ratio 를 매핑.
const RATIO_TO_SIZE = {
  '1:1': '1024x1024',
  '16:9': '1792x1024',
  '4:3': '1792x1024',
  '9:16': '1024x1792',
  '3:4': '1024x1792',
};

// ---------- Middleware ----------
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname)));

// ---------- Lazy OpenAI client ----------
let openaiClient = null;
function getOpenAI() {
  if (openaiClient) return openaiClient;
  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    const err = new Error('OPENAI_API_KEY is not configured on the server.');
    err.status = 500;
    throw err;
  }
  openaiClient = new OpenAI({ apiKey });
  return openaiClient;
}

// ---------- Helpers ----------
function colorModeKeywords(colorMode) {
  if (colorMode === 'bw') {
    return 'black and white, monochrome, grayscale, no color, desaturated';
  }
  if (colorMode === 'color') {
    return 'full color, rich color palette';
  }
  return '';
}

function buildFinalPrompt(prompt, styleKeywords, moodKeywords, colorMode) {
  const parts = [prompt, styleKeywords, moodKeywords, colorModeKeywords(colorMode)]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean);
  let final = parts.join(', ').replace(/\s+/g, ' ').trim();
  if (final.length > MAX_PROMPT_LENGTH) {
    final = final.slice(0, MAX_PROMPT_LENGTH);
  }
  return final;
}

function resolveSize(ratio) {
  return RATIO_TO_SIZE[ratio] || '1024x1024';
}

function parseSize(size) {
  const [w, h] = size.split('x').map((n) => parseInt(n, 10));
  return { width: w, height: h };
}

function makeSeed(i) {
  return `${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 8)}`;
}

function clampCount(count) {
  const n = parseInt(count, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  if (n > MAX_COUNT) return MAX_COUNT;
  return n;
}

// ---------- Routes ----------

// Health check
app.get('/api/health', (_req, res) => {
  const hasApiKey = Boolean((process.env.OPENAI_API_KEY || '').trim());
  res.json({
    success: true,
    data: {
      status: 'ok',
      hasApiKey,
      model: MODEL,
    },
  });
});

// Image generation
app.post('/api/generate', async (req, res) => {
  try {
    const {
      prompt,
      style,
      styleKeywords,
      mood,
      moodKeywords,
      ratio,
      count,
      colorMode,
    } = req.body || {};

    // 1) validate prompt
    if (typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({
        success: false,
        message: 'prompt is required and must be a non-empty string.',
      });
    }

    const n = clampCount(count);
    const size = resolveSize(ratio);
    const { width, height } = parseSize(size);
    const finalPrompt = buildFinalPrompt(prompt, styleKeywords, moodKeywords, colorMode);

    const openai = getOpenAI();

    // 2) DALL-E 3 는 n=1 만 지원하므로 count 만큼 병렬 호출.
    const tasks = Array.from({ length: n }, (_, i) =>
      openai.images
        .generate({
          model: MODEL,
          prompt: finalPrompt,
          n: 1,
          size,
          response_format: 'url',
        })
        .then((result) => {
          const item = result?.data?.[0] || {};
          return {
            url: item.url,
            seed: makeSeed(i),
            width,
            height,
            revisedPrompt: item.revised_prompt || finalPrompt,
          };
        })
    );

    const settled = await Promise.allSettled(tasks);
    const images = settled
      .filter((s) => s.status === 'fulfilled' && s.value && s.value.url)
      .map((s) => s.value);
    const failures = settled.filter((s) => s.status === 'rejected');

    // 3) 전부 실패한 경우 → 502 + 첫 에러 메시지 전파
    if (images.length === 0) {
      const firstErr = failures[0]?.reason;
      const status = firstErr?.status || 502;
      const openaiMessage =
        firstErr?.error?.message ||
        firstErr?.response?.data?.error?.message ||
        firstErr?.message ||
        'Image generation failed.';

      // content_policy_violation 등은 400으로 내려주는 게 의미 있음
      const code = firstErr?.code || firstErr?.error?.code;
      if (code === 'content_policy_violation') {
        return res.status(400).json({
          success: false,
          message: `Content policy violation: ${openaiMessage}`,
        });
      }

      return res.status(status >= 400 && status < 600 ? status : 502).json({
        success: false,
        message: openaiMessage,
      });
    }

    // 4) 일부 실패는 무시하고 성공분만 반환 (used, mood 등은 현재 사용하지 않지만 미사용 경고 방지)
    void style;
    void mood;

    return res.json({
      success: true,
      data: {
        images,
        model: MODEL,
        finalPrompt,
      },
    });
  } catch (err) {
    const status = err?.status || 500;
    const message =
      err?.error?.message ||
      err?.response?.data?.error?.message ||
      err?.message ||
      'Internal server error.';
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      message,
    });
  }
});

// ---------- SPA fallback ----------
// Express 5 에서는 '/{*splat}' 문법을 쓰지만, 이 프로젝트는 Express 4 를 사용하므로
// 모든 GET 요청을 받아 index.html 로 돌려주는 미들웨어 방식으로 처리한다.
// /api/* 는 이 앞에서 이미 처리되었으므로 여기까지 도달하지 않는다.
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ---------- Error handler ----------
app.use((err, _req, res, _next) => {
  const status = err?.status || 500;
  res.status(status).json({
    success: false,
    message: err?.message || 'Internal server error.',
  });
});

// ---------- Local / Serverless dual mode ----------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
