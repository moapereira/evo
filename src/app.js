// Rotas HTTP do Evo. Exporta um handler (req, res) que serve tanto o servidor local/Render quanto a Vercel.
import './fuso.js';
import { readFile } from 'node:fs/promises';
import { extname, basename } from 'node:path';
import { criarAuth, lerCookie, paginaLogin } from './auth.js';
import { obterEstado, receberPlanilha } from './motor.js';
import { responder } from './chat.js';

const env = process.env;
const MAX_PLANILHA = 4 * 1024 * 1024; // a Vercel recusa corpos acima de ~4,5 MB; uma exportação do painel tem ~200 KB

export const auth = criarAuth({ senha: env.EVO_SENHA, segredo: env.EVO_SEGREDO });
const naVercel = Boolean(env.VERCEL);

const ipDe = (req) => req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '?';
const viaHttps = (req) => req.headers['x-forwarded-proto'] === 'https';
const json = (res, status, corpo) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(corpo));

async function lerCorpo(req, max) {
  const partes = [];
  let total = 0;
  for await (const parte of req) {
    total += parte.length;
    if (total > max) throw new Error('corpo grande demais');
    partes.push(parte);
  }
  return Buffer.concat(partes);
}

export async function tratar(req, res) {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');

  // Verificação de saúde da hospedagem: não expõe dados.
  if (url.pathname === '/saude') return res.writeHead(200).end('ok');

  // Publicado sem senha = painel aberto para a internet. Nunca.
  if (naVercel && !auth.exigida) {
    return res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Evo: defina a variável EVO_SENHA no painel da Vercel.');
  }

  if (url.pathname === '/login') {
    if (!auth.exigida) return res.writeHead(303, { Location: '/' }).end();
    if (req.method !== 'POST') return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(paginaLogin());
    let senha = '';
    try {
      senha = new URLSearchParams((await lerCorpo(req, 4096)).toString()).get('senha') ?? '';
    } catch {}
    const resultado = auth.tentar(ipDe(req), senha);
    if (resultado === 'ok') {
      const cookie = `evo=${encodeURIComponent(auth.emitirCookie())}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 24 * 3600}${viaHttps(req) ? '; Secure' : ''}`;
      return res.writeHead(303, { Location: '/', 'Set-Cookie': cookie }).end();
    }
    const msg = resultado === 'bloqueado' ? 'Muitas tentativas. Aguarde alguns minutos.' : 'Senha incorreta.';
    return res.writeHead(resultado === 'bloqueado' ? 429 : 401, { 'Content-Type': 'text/html; charset=utf-8' }).end(paginaLogin(msg));
  }
  if (url.pathname === '/sair') {
    return res.writeHead(303, { Location: '/login', 'Set-Cookie': 'evo=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' }).end();
  }

  // Tudo daqui para baixo exige a senha (quando configurada).
  if (auth.exigida && !auth.cookieValido(lerCookie(req.headers.cookie, 'evo'))) {
    if (url.pathname.startsWith('/api/')) return json(res, 401, { erro: 'não autenticado' });
    return res.writeHead(303, { Location: '/login' }).end();
  }

  try {
    if (url.pathname === '/api/estado') {
      json(res, 200, await obterEstado());
    } else if (url.pathname === '/api/chat' && req.method === 'POST') {
      const { pergunta } = JSON.parse((await lerCorpo(req, 8192)).toString());
      json(res, 200, { resposta: await responder(String(pergunta ?? '').slice(0, 500), await obterEstado()) });
    } else if (url.pathname === '/api/importar' && req.method === 'POST') {
      // Recebe a planilha exportada do painel de instâncias (.xlsx ou .csv) e já atualiza o card.
      const nome = basename(url.searchParams.get('nome') ?? '').replace(/[^\w.\- ]/g, '_');
      if (!['.xlsx', '.csv'].includes(extname(nome).toLowerCase())) return json(res, 400, { erro: 'envie um arquivo .xlsx ou .csv' });
      let corpo;
      try {
        corpo = await lerCorpo(req, MAX_PLANILHA);
      } catch {
        return json(res, 413, { erro: 'arquivo grande demais (máximo 4 MB)' });
      }
      try {
        const inst = await receberPlanilha(nome, corpo);
        json(res, 200, { ok: true, diasDeHistorico: inst.diasDeHistorico, semMovimento: inst.semMovimento.length });
      } catch (e) {
        json(res, 422, { erro: e.message });
      }
    } else if (url.pathname === '/' || url.pathname === '/index.html') {
      // Caminho literal de propósito: é assim que a Vercel descobre que este arquivo precisa ir junto com a função.
      const pagina = await readFile(new URL('../web/index.html', import.meta.url));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(pagina);
    } else {
      res.writeHead(404).end('Não encontrado');
    }
  } catch (e) {
    console.error(`[http] ${url.pathname}: ${e.message}`);
    if (!res.headersSent) json(res, e instanceof SyntaxError ? 400 : 500, { erro: e instanceof SyntaxError ? 'requisição inválida' : 'erro interno' });
  }
}
