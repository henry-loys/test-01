// AI 연애 상담 챗봇 서버 (하트 상담사)
// Node.js 내장 모듈만 사용 — 외부 의존성 없음

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = Number(process.env.PORT) || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const START_TIME = Date.now();

// 하트 상담사 페르소나 시스템 프롬프트
const SYSTEM_PROMPT = `당신은 "하트 상담사"입니다. 따뜻하고 공감 능력이 뛰어난 한국인 연애 상담사로서 사용자의 이야기를 주의 깊게 들어주세요.

역할 지침:
- 사용자의 감정을 먼저 인정하고 공감해 주세요.
- 섣부른 판단이나 훈계, 임상적이고 딱딱한 말투는 피하세요.
- 필요할 때는 사려 깊은 후속 질문으로 상황을 더 깊이 이해하려 노력하세요.
- 부드럽고 현실적인 조언을 곁들이되, 강요하지 마세요.
- 항상 한국어로 대답하며, 대화체로 보통 2~4문장 정도의 적당한 길이로 답해 주세요.
- 사용자가 안전하게 자기 마음을 털어놓을 수 있는 따뜻한 친구 같은 분위기를 유지해 주세요.`;

// ---------- 유틸: https 요청 Promise 헬퍼 ----------
function httpsRequest(targetUrl, options, body) {
  return new Promise((resolve, reject) => {
    const parsed = url.parse(targetUrl);
    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.path,
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const req = https.request(reqOptions, (res) => {
      let chunks = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { chunks += c; });
      res.on('end', () => {
        let parsedBody = null;
        try {
          parsedBody = chunks ? JSON.parse(chunks) : null;
        } catch (err) {
          return reject(new Error('응답 JSON 파싱 실패: ' + err.message));
        }
        resolve({ statusCode: res.statusCode, body: parsedBody });
      });
    });

    req.on('error', (err) => reject(err));

    if (body) req.write(body);
    req.end();
  });
}

// ---------- 유틸: 요청 body 읽기 & JSON 파싱 ----------
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      // 간단한 크기 보호 (1MB 제한)
      if (raw.length > 1_000_000) {
        reject(new Error('요청 본문이 너무 큽니다'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error('유효하지 않은 JSON'));
      }
    });
    req.on('error', reject);
  });
}

// ---------- 유틸: JSON 응답 ----------
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

// ---------- 유틸: 정적 파일 (index.html) ----------
function serveIndexHtml(res) {
  const filePath = path.join(__dirname, 'index.html');
  fs.readFile(filePath, (err, data) => {
    if (err) {
      return sendJson(res, 500, { error: 'index.html을 읽을 수 없습니다' });
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(data);
  });
}

// ---------- 핸들러: /api/chat ----------
async function handleChat(req, res) {
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, 400, { error: err.message });
  }

  const message = payload && typeof payload.message === 'string' ? payload.message.trim() : '';
  if (!message) {
    return sendJson(res, 400, { error: '메시지를 입력해주세요' });
  }

  if (!OPENAI_API_KEY) {
    return sendJson(res, 500, {
      error: '서버 오류',
      detail: 'OPENAI_API_KEY 환경변수가 설정되지 않았습니다. 예: OPENAI_API_KEY=sk-xxx node server.js',
    });
  }

  // history 검증 및 정리
  const history = Array.isArray(payload.history)
    ? payload.history.filter(
        (m) =>
          m &&
          (m.role === 'user' || m.role === 'assistant') &&
          typeof m.content === 'string'
      )
    : [];

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: message },
  ];

  const requestBody = JSON.stringify({
    model: 'gpt-4o-mini',
    messages,
    temperature: 0.8,
    max_tokens: 400,
  });

  try {
    const result = await httpsRequest(
      'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Length': Buffer.byteLength(requestBody),
        },
      },
      requestBody
    );

    if (result.statusCode < 200 || result.statusCode >= 300) {
      const detail =
        (result.body && result.body.error && result.body.error.message) ||
        `OpenAI 응답 상태 코드: ${result.statusCode}`;
      return sendJson(res, 502, { error: 'AI 응답 생성 실패', detail });
    }

    const reply =
      result.body &&
      result.body.choices &&
      result.body.choices[0] &&
      result.body.choices[0].message &&
      result.body.choices[0].message.content;

    if (!reply) {
      return sendJson(res, 502, {
        error: 'AI 응답 생성 실패',
        detail: '응답에 메시지가 포함되어 있지 않습니다',
      });
    }

    return sendJson(res, 200, {
      reply,
      usage: result.body.usage || null,
    });
  } catch (err) {
    return sendJson(res, 500, { error: '서버 오류', detail: err.message });
  }
}

// ---------- 핸들러: /api/health ----------
function handleHealth(res) {
  sendJson(res, 200, {
    status: 'ok',
    hasApiKey: Boolean(OPENAI_API_KEY),
    uptime: Math.floor((Date.now() - START_TIME) / 1000),
  });
}

// ---------- 메인 서버 ----------
const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const method = req.method;

  // 원래 writeHead를 감싸 상태 코드를 기록 (로그용)
  const originalWriteHead = res.writeHead.bind(res);
  let statusCode = 200;
  res.writeHead = (code, ...rest) => {
    statusCode = code;
    return originalWriteHead(code, ...rest);
  };

  res.on('finish', () => {
    const elapsed = Date.now() - started;
    console.log(`[${method}] ${pathname} ${statusCode} (${elapsed}ms)`);
  });

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  // 라우팅
  if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    return serveIndexHtml(res);
  }

  if (method === 'GET' && pathname === '/api/health') {
    return handleHealth(res);
  }

  if (method === 'POST' && pathname === '/api/chat') {
    return handleChat(req, res);
  }

  // 404
  return sendJson(res, 404, { error: '찾을 수 없는 경로입니다', path: pathname });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  if (!OPENAI_API_KEY) {
    console.warn('');
    console.warn('[경고] OPENAI_API_KEY 환경변수가 설정되지 않았습니다.');
    console.warn('       /api/chat 요청은 500 에러를 반환합니다.');
    console.warn('       .env.example 을 .env 로 복사한 뒤 키를 채우고 실행하세요:');
    console.warn('       cp .env.example .env   # 처음 한 번만');
    console.warn('       node --env-file=.env server.js');
    console.warn('');
  }
});
