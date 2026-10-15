// Atender Bem — API de integração (OpenAPI em /base/config/apidoc, spec em /static/getAPPAPISpecs).
// Todas as chamadas são POST em /int/... com a chave no corpo ({ apiKey, queueId }).
//
// Um atendimento aberto = um cliente aguardando ou em atendimento. `beginTime` vem em SEGUNDOS.
// Quais filas contam como "suporte" é decisão do escritório: ATENDERBEM_FILAS=254,109 (ids).
//
// Atenção: a chave atual só é aceita por parte das filas (as demais respondem AUTH_018). Filas
// configuradas que recusarem a chave viram um aviso no painel em vez de sumirem em silêncio.

const NOMES_MS = 30 * 60 * 1000;
let cacheUsuarios = { em: 0, mapa: new Map() };

function config() {
  const base = process.env.ATENDERBEM_BASE_URL;
  const chave = process.env.ATENDERBEM_TOKEN;
  if (!base || !chave) throw new Error('Atender Bem: preencha ATENDERBEM_BASE_URL e ATENDERBEM_TOKEN no .env');
  const filas = (process.env.ATENDERBEM_FILAS ?? '254').split(',').map((s) => Number(s.trim())).filter(Boolean);
  return { base: base.replace(/\/$/, ''), chave, filas };
}

async function post(caminho, corpo) {
  const { base } = config();
  const res = await fetch(base + caminho, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${json?.errorCode ?? 'erro'} (HTTP ${res.status})`);
  return json;
}

async function nomesDeUsuarios() {
  if (Date.now() - cacheUsuarios.em < NOMES_MS) return cacheUsuarios.mapa;
  const { chave } = config();
  const mapa = new Map();
  try {
    for (let page = 1; page <= 10; page++) {
      const r = await post('/int/getAllUsers', { apiKey: chave, page, limit: 100 });
      for (const u of r.users ?? []) mapa.set(u.id, u.fullName || u.username);
      if (page * (r.limit ?? 100) >= (r.total ?? 0)) break;
    }
  } catch {
    // Sem os nomes o painel ainda funciona, só mostra "Agente #id".
  }
  cacheUsuarios = { em: Date.now(), mapa };
  return mapa;
}

// -> { id, cliente, assunto, status, abertoEm (ISO), atendente }[]  (+ .avisos com filas recusadas)
export async function tickets() {
  const { chave, filas } = config();

  const [nomeFilas, usuarios] = await Promise.all([
    post('/int/getAllQueues', { apiKey: chave }).then((qs) => new Map(qs.map((q) => [q.id, q.name]))),
    nomesDeUsuarios(),
  ]);

  const respostas = await Promise.allSettled(
    filas.map((queueId) => post('/int/getAllOpenChats', { queueId, apiKey: chave })),
  );

  const itens = [];
  const avisos = [];
  respostas.forEach((r, i) => {
    const fila = nomeFilas.get(filas[i]) ?? `fila ${filas[i]}`;
    if (r.status === 'rejected') {
      avisos.push(`${fila}: ${r.reason.message}`);
      return;
    }
    let semData = 0;
    for (const c of r.value.chats ?? []) {
      // beginTime vem em segundos; sem ele, a primeira mensagem serve. Sem nenhum dos dois não há como medir o tempo.
      let inicio = Number(c.beginTime) || Number(c.firstMsgTime);
      if (inicio > 1e11) inicio /= 1000; // veio em milissegundos
      if (!Number.isFinite(inicio) || inicio <= 0) {
        semData++;
        continue;
      }
      itens.push({
        id: c.protocol || String(c.chatId),
        cliente: c.clientName || c.clientNumber || c.clientEmail || `Cliente ${c.clientId}`,
        assunto: c.onQueue ? `${fila} · aguardando na fila` : fila,
        status: 'aberto',
        abertoEm: new Date(inicio * 1000).toISOString(),
        atendente: c.userId ? (usuarios.get(c.userId) ?? `Agente #${c.userId}`) : 'Na fila',
      });
    }
    if (semData) avisos.push(`${fila}: ${semData} atendimento(s) sem data de início foram ignorados`);
  });

  if (avisos.length === filas.length) throw new Error(`Nenhuma fila respondeu: ${avisos.join('; ')}`);
  itens.avisos = avisos;
  return itens;
}
