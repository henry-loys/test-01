// server.js
// 미니멀 포켓몬 도감 백엔드 — Node 빌트인 모듈만 사용
// 실행: node server.js (npm 설치 불필요)

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

// ============================================================
// 1. 설정 & 인메모리 상태
// ============================================================
const PORT = process.env.PORT || 3000;
const TOTAL = 151; // 관동 지방 포켓몬 수
const POKEAPI = 'https://pokeapi.co/api/v2';
const SERVER_START = Date.now();

// 캐시 & 워밍업 상태
const pokemonCache = [];        // 정규화된 포켓몬 배열 (id 순으로 정렬)
let warmupDone = false;
let warmupProgress = 0;

// ============================================================
// 2. HTTPS JSON Fetch 헬퍼 (리다이렉트 + JSON 파싱)
// ============================================================
function fetchJson(targetUrl, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      return reject(new Error('리다이렉트가 너무 많습니다'));
    }

    https
      .get(targetUrl, (res) => {
        // 301/302 리다이렉트 처리
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume(); // 메모리 누수 방지
          return resolve(fetchJson(res.headers.location, redirectCount + 1));
        }

        if (res.statusCode !== 200) {
          res.resume();
          return reject(
            new Error(`HTTP ${res.statusCode} for ${targetUrl}`)
          );
        }

        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw));
          } catch (err) {
            reject(new Error('JSON 파싱 실패: ' + err.message));
          }
        });
      })
      .on('error', reject);
  });
}

// ============================================================
// 3. 정규화 로직 — PokeAPI 응답을 단순한 모양으로 변환
// ============================================================
function normalizePokemon(raw, species) {
  // 한글 이름 추출 (species.names 배열에서 language.name === "ko")
  let koreanName = raw.name;
  if (species && Array.isArray(species.names)) {
    const ko = species.names.find(
      (n) => n.language && n.language.name === 'ko'
    );
    if (ko) koreanName = ko.name;
  }

  // 스탯 변환
  const statMap = {};
  raw.stats.forEach((s) => {
    statMap[s.stat.name] = s.base_stat;
  });
  const hp = statMap['hp'] || 0;
  const attack = statMap['attack'] || 0;
  const defense = statMap['defense'] || 0;
  const specialAttack = statMap['special-attack'] || 0;
  const specialDefense = statMap['special-defense'] || 0;
  const speed = statMap['speed'] || 0;

  return {
    id: raw.id,
    name: raw.name,
    koreanName,
    sprite: raw.sprites && raw.sprites.front_default,
    officialArtwork:
      raw.sprites &&
      raw.sprites.other &&
      raw.sprites.other['official-artwork'] &&
      raw.sprites.other['official-artwork'].front_default,
    types: raw.types.map((t) => t.type.name),
    height: raw.height,
    weight: raw.weight,
    abilities: raw.abilities.map((a) => ({
      name: a.ability.name,
      isHidden: a.is_hidden,
    })),
    stats: {
      hp,
      attack,
      defense,
      specialAttack,
      specialDefense,
      speed,
      total: hp + attack + defense + specialAttack + specialDefense + speed,
    },
  };
}

// ============================================================
// 4. 워밍업 — 서버 시작 시 PokeAPI에서 151마리를 병렬로 가져옴
// ============================================================
async function fetchOne(id) {
  const pokemon = await fetchJson(`${POKEAPI}/pokemon/${id}`);
  let species = null;
  try {
    species = await fetchJson(`${POKEAPI}/pokemon-species/${id}`);
  } catch (err) {
    // species 실패는 치명적이지 않음 — 영어 이름으로 폴백
    console.warn(`[warmup] species ${id} 실패: ${err.message}`);
  }
  return normalizePokemon(pokemon, species);
}

async function warmup() {
  console.log(`[warmup] PokeAPI에서 ${TOTAL}마리 가져오는 중...`);
  const tasks = [];
  for (let id = 1; id <= TOTAL; id++) {
    tasks.push(
      fetchOne(id)
        .then((p) => {
          pokemonCache.push(p);
          warmupProgress = pokemonCache.length;
          if (warmupProgress % 50 === 0 || warmupProgress === TOTAL) {
            console.log(`[warmup] fetched ${warmupProgress}/${TOTAL}...`);
          }
        })
        .catch((err) => {
          console.error(`[warmup] #${id} 실패: ${err.message}`);
        })
    );
  }
  await Promise.all(tasks);
  // id 순 정렬 (병렬 응답 순서가 뒤섞였을 수 있음)
  pokemonCache.sort((a, b) => a.id - b.id);
  warmupDone = true;
  console.log(`[warmup] 완료! ${pokemonCache.length}마리 캐시됨`);
}

// ============================================================
// 5. 응답 헬퍼
// ============================================================
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function sendHtml(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 500, { error: 'index.html을 읽을 수 없습니다' });
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(data);
  });
}

// 워밍업 미완료 시 503 응답
function sendNotReady(res) {
  sendJson(res, 503, {
    error: '데이터 준비 중입니다',
    progress: `${warmupProgress}/${TOTAL}`,
    message: '잠시 후 다시 시도해주세요',
  });
}

// ============================================================
// 6. 라우트 핸들러
// ============================================================
function handleListPokemon(query, res) {
  let list = pokemonCache.slice();

  // ?type=fire 필터
  if (query.type) {
    const t = String(query.type).toLowerCase();
    list = list.filter((p) => p.types.includes(t));
  }

  // ?search=pika 필터 (영어/한글 이름 부분 일치)
  if (query.search) {
    const q = String(query.search).toLowerCase();
    list = list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.koreanName && p.koreanName.toLowerCase().includes(q))
    );
  }

  sendJson(res, 200, { success: true, count: list.length, data: list });
}

function handleGetPokemon(idStr, res) {
  const id = Number(idStr);
  if (!Number.isInteger(id) || id < 1 || id > TOTAL) {
    return sendJson(res, 404, {
      success: false,
      error: '포켓몬을 찾을 수 없습니다',
    });
  }
  const found = pokemonCache.find((p) => p.id === id);
  if (!found) {
    return sendJson(res, 404, {
      success: false,
      error: '포켓몬을 찾을 수 없습니다',
    });
  }
  sendJson(res, 200, { success: true, data: found });
}

function handleTypes(res) {
  const set = new Set();
  pokemonCache.forEach((p) => p.types.forEach((t) => set.add(t)));
  const types = Array.from(set).sort();
  sendJson(res, 200, { success: true, count: types.length, data: types });
}

function handleStats(res) {
  const byType = {};
  pokemonCache.forEach((p) => {
    p.types.forEach((t) => {
      byType[t] = (byType[t] || 0) + 1;
    });
  });
  sendJson(res, 200, {
    success: true,
    data: {
      total: TOTAL,
      cached: pokemonCache.length,
      byType,
      ready: warmupDone,
    },
  });
}

function handleHealth(res) {
  sendJson(res, 200, {
    status: 'ok',
    cached: pokemonCache.length,
    uptime: Math.floor((Date.now() - SERVER_START) / 1000),
    warmupDone,
  });
}

// ============================================================
// 7. 메인 HTTP 서버
// ============================================================
const server = http.createServer((req, res) => {
  const startedAt = Date.now();
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const method = req.method;

  // 요청이 끝난 후 로그 출력
  res.on('finish', () => {
    const ms = Date.now() - startedAt;
    console.log(`[${method}] ${pathname} ${res.statusCode} (${ms}ms)`);
  });

  // CORS preflight 처리
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  // GET만 허용
  if (method !== 'GET') {
    return sendJson(res, 405, {
      success: false,
      error: 'GET 메서드만 허용됩니다',
    });
  }

  try {
    // 라우팅
    // GET / → index.html
    if (pathname === '/' || pathname === '/index.html') {
      return sendHtml(res, path.join(__dirname, 'index.html'));
    }

    // /api/health — 워밍업 체크 없이 항상 응답
    if (pathname === '/api/health') {
      return handleHealth(res);
    }

    // /api/stats — 캐시 상황을 보여주므로 준비 전에도 응답
    if (pathname === '/api/stats') {
      return handleStats(res);
    }

    // 아래 엔드포인트는 워밍업이 끝나야 사용 가능
    if (!warmupDone) {
      return sendNotReady(res);
    }

    // /api/pokemon
    if (pathname === '/api/pokemon') {
      return handleListPokemon(parsed.query, res);
    }

    // /api/pokemon/:id
    const match = pathname.match(/^\/api\/pokemon\/([^/]+)$/);
    if (match) {
      return handleGetPokemon(match[1], res);
    }

    // /api/types
    if (pathname === '/api/types') {
      return handleTypes(res);
    }

    // 알 수 없는 라우트
    sendJson(res, 404, {
      success: false,
      error: '경로를 찾을 수 없습니다',
      path: pathname,
    });
  } catch (err) {
    console.error('[error]', err);
    sendJson(res, 500, {
      success: false,
      error: '서버 내부 오류',
      message: err.message,
    });
  }
});

// ============================================================
// 8. 서버 시작 + 워밍업 비동기 시작
// ============================================================
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log('[warmup] 백그라운드에서 PokeAPI 데이터 준비 중입니다...');
  // listen을 블로킹하지 않도록 워밍업을 비동기로 실행
  warmup().catch((err) => {
    console.error('[warmup] 치명적 오류:', err);
  });
});
