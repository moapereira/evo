// Onde o Evo guarda o que precisa sobreviver entre execuções (histórico, avisos já enviados...).
//  - Com KV_REST_API_URL + KV_REST_API_TOKEN (ou as UPSTASH_REDIS_REST_*): Redis via REST. É o que a Vercel
//    exige, porque lá não há disco que persista nem processo que fique ligado.
//  - Sem isso: arquivos em DADOS_DIR (computador do escritório ou servidor com disco persistente).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DADOS, LEGADO } from './caminhos.js';

const url = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
export const remoto = () => Boolean(url() && token());

// Na Vercel não há disco que persista: sem o Redis configurado, melhor avisar do que gravar num lugar que some.
function exigirBancoNaNuvem() {
  if (process.env.VERCEL && !remoto()) {
    throw new Error('Banco Redis não configurado (faltam KV_REST_API_URL e KV_REST_API_TOKEN). Conecte o Upstash ao projeto na Vercel.');
  }
}

const prefixo = () => process.env.ARMAZENAMENTO_PREFIXO || 'evo';
const chaveRedis = (c) => `${prefixo()}:${c}`;

// Envia vários comandos de uma vez (pipeline do Upstash) e devolve o resultado de cada um.
async function redis(comandos) {
  const r = await fetch(`${url().replace(/\/$/, '')}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(comandos),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`Armazenamento respondeu ${r.status}`);
  const j = await r.json();
  const falha = j.find((x) => x.error);
  if (falha) throw new Error(`Armazenamento: ${falha.error}`);
  return j.map((x) => x.result);
}

export async function ler(chave) {
  exigirBancoNaNuvem();
  if (remoto()) {
    const [v] = await redis([['GET', chaveRedis(chave)]]);
    return v == null ? null : JSON.parse(v);
  }
  for (const arquivo of [join(DADOS, `${chave}.json`), LEGADO[chave]].filter(Boolean)) {
    try {
      return JSON.parse(await readFile(arquivo, 'utf8'));
    } catch {}
  }
  return null;
}

export async function gravar(chave, valor) {
  exigirBancoNaNuvem();
  if (remoto()) {
    await redis([['SET', chaveRedis(chave), JSON.stringify(valor)]]);
    return;
  }
  await mkdir(DADOS, { recursive: true });
  await writeFile(join(DADOS, `${chave}.json`), JSON.stringify(valor));
}

// Conjuntos (avisos já enviados). Devolve só os membros que ainda NÃO estavam no conjunto, e os marca.
// No Redis isso é atômico (SADD), então duas instâncias do Evo nunca enviam o mesmo aviso duas vezes.
export async function reivindicar(chave, membros) {
  if (!membros.length) return [];
  exigirBancoNaNuvem();
  if (remoto()) {
    const r = await redis(membros.map((m) => ['SADD', chaveRedis(chave), m]));
    return membros.filter((_, i) => r[i] === 1);
  }
  const atual = new Set((await ler(chave)) ?? []);
  const novos = membros.filter((m) => !atual.has(m));
  if (novos.length) {
    novos.forEach((m) => atual.add(m));
    await gravar(chave, [...atual]);
  }
  return novos;
}

// Desfaz uma reivindicação (ex.: o envio ao Teams falhou, então o aviso deve ser tentado de novo).
export async function liberar(chave, membros) {
  if (!membros.length) return;
  if (remoto()) {
    await redis(membros.map((m) => ['SREM', chaveRedis(chave), m]));
    return;
  }
  const atual = new Set((await ler(chave)) ?? []);
  membros.forEach((m) => atual.delete(m));
  await gravar(chave, [...atual]);
}
