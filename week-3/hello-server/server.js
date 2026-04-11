const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const START_TIME = Date.now();

// 메모리에만 저장되는 유저 배열 (서버 재시작 시 초기화됨)
let users = [
  { id: 1, name: '김철수', email: 'chulsoo@example.com' },
  { id: 2, name: '이영희', email: 'younghee@example.com' },
  { id: 3, name: '박민수', email: 'minsoo@example.com' },
];
let nextId = 4;

// 공통 CORS 헤더
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// JSON 응답 헬퍼
function sendJSON(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...CORS_HEADERS,
  });
  res.end(JSON.stringify(data));
}

// 요청 바디를 모아 JSON으로 파싱 (스트림 → 문자열 → 객체)
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// index.html 서빙
function serveIndex(res) {
  const filePath = path.join(__dirname, 'index.html');
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('index.html을 읽을 수 없습니다.');
      return 500;
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      ...CORS_HEADERS,
    });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const { method, url } = req;

  // 응답 후 로그를 찍기 위해 writeHead를 가로챔
  const originalWriteHead = res.writeHead.bind(res);
  res.writeHead = (status, ...rest) => {
    console.log(`[${method}] ${url} ${status}`);
    return originalWriteHead(status, ...rest);
  };

  try {
    // CORS preflight
    if (method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    // 루트 → index.html
    if (method === 'GET' && (url === '/' || url === '/index.html')) {
      serveIndex(res);
      return;
    }

    // GET /api/hello
    if (method === 'GET' && url === '/api/hello') {
      sendJSON(res, 200, {
        message: '안녕하세요!',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // GET /api/health
    if (method === 'GET' && url === '/api/health') {
      sendJSON(res, 200, {
        status: 'ok',
        uptime: Math.floor((Date.now() - START_TIME) / 1000),
      });
      return;
    }

    // GET /api/users
    if (method === 'GET' && url === '/api/users') {
      sendJSON(res, 200, users);
      return;
    }

    // POST /api/users
    if (method === 'POST' && url === '/api/users') {
      let body;
      try {
        body = await parseBody(req);
      } catch {
        sendJSON(res, 400, { error: '잘못된 JSON 형식입니다.' });
        return;
      }
      const { name, email } = body;
      if (!name || !email) {
        sendJSON(res, 400, { error: 'name과 email은 필수입니다.' });
        return;
      }
      const newUser = { id: nextId++, name, email };
      users.push(newUser);
      sendJSON(res, 201, newUser);
      return;
    }

    // /api/users/:id 패턴 매칭
    const userMatch = url.match(/^\/api\/users\/(\d+)$/);
    if (userMatch) {
      const id = Number(userMatch[1]);
      const index = users.findIndex((u) => u.id === id);

      // GET /api/users/:id
      if (method === 'GET') {
        if (index === -1) {
          sendJSON(res, 404, { error: '유저를 찾을 수 없습니다.' });
          return;
        }
        sendJSON(res, 200, users[index]);
        return;
      }

      // PUT /api/users/:id
      if (method === 'PUT') {
        if (index === -1) {
          sendJSON(res, 404, { error: '유저를 찾을 수 없습니다.' });
          return;
        }
        let body;
        try {
          body = await parseBody(req);
        } catch {
          sendJSON(res, 400, { error: '잘못된 JSON 형식입니다.' });
          return;
        }
        const { name, email } = body;
        if (name !== undefined) users[index].name = name;
        if (email !== undefined) users[index].email = email;
        sendJSON(res, 200, users[index]);
        return;
      }

      // DELETE /api/users/:id
      if (method === 'DELETE') {
        if (index === -1) {
          sendJSON(res, 404, { error: '유저를 찾을 수 없습니다.' });
          return;
        }
        users.splice(index, 1);
        sendJSON(res, 200, { deleted: true });
        return;
      }
    }

    // 알 수 없는 라우트
    sendJSON(res, 404, { error: 'Not Found' });
  } catch (err) {
    console.error('서버 오류:', err);
    sendJSON(res, 500, { error: 'Internal Server Error' });
  }
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
