// Senha única da equipe, com cookie assinado. Sem EVO_SENHA o painel fica aberto (só serve para uso local).
import { createHmac, timingSafeEqual } from 'node:crypto';

const DIA_MS = 24 * 3600 * 1000;
export const DURACAO_COOKIE_DIAS = 30;
const JANELA_MS = 10 * 60 * 1000;
const MAX_FALHAS_POR_IP = 5;
const MAX_FALHAS_GERAL = 30;

const igual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

export function criarAuth({ senha, segredo, agora = () => Date.now() }) {
  const exigida = Boolean(senha);
  // O segredo da assinatura pode ser próprio; senão deriva da senha (trocar a senha invalida os cookies).
  const chave = segredo || `evo:${senha}`;
  const assinar = (exp) => createHmac('sha256', chave).update(String(exp)).digest('hex');
  const falhas = new Map(); // ip -> { n, ate }

  const bloqueado = (ip) => {
    const t = agora();
    const f = falhas.get(ip), g = falhas.get('*');
    return (f && f.ate > t && f.n >= MAX_FALHAS_POR_IP) || (g && g.ate > t && g.n >= MAX_FALHAS_GERAL);
  };
  const registrarFalha = (ip) => {
    const t = agora();
    for (const k of [ip, '*']) {
      const f = falhas.get(k);
      falhas.set(k, f && f.ate > t ? { n: f.n + 1, ate: f.ate } : { n: 1, ate: t + JANELA_MS });
    }
  };

  return {
    exigida,
    // -> 'ok' | 'errada' | 'bloqueado'
    tentar(ip, tentativa) {
      if (bloqueado(ip)) return 'bloqueado';
      if (igual(tentativa ?? '', senha ?? '')) {
        falhas.delete(ip);
        return 'ok';
      }
      registrarFalha(ip);
      return 'errada';
    },
    emitirCookie() {
      const exp = agora() + DURACAO_COOKIE_DIAS * DIA_MS;
      return `${exp}.${assinar(exp)}`;
    },
    cookieValido(valor) {
      const [exp, assinatura] = String(valor ?? '').split('.');
      if (!exp || !assinatura || !/^\d+$/.test(exp) || Number(exp) < agora()) return false;
      return igual(assinatura, assinar(exp));
    },
  };
}

export function lerCookie(cabecalho, nome) {
  for (const parte of String(cabecalho ?? '').split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === nome) return decodeURIComponent(parte.slice(i + 1).trim());
  }
  return null;
}

export const paginaLogin = (erro = '') => `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Evo</title>
<style>
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:#f2f6ff; color:#1e2a44; font:600 16px/1.4 "Nunito","Segoe UI",system-ui,sans-serif; }
  form { background:#fff; border:2px solid #dbe5f6; border-bottom-width:5px; border-radius:18px; padding:28px; width:min(92vw,340px); }
  h1 { margin:0 0 16px; color:#2f6bff; font-size:28px; letter-spacing:.02em; }
  input { width:100%; box-sizing:border-box; border:2px solid #dbe5f6; border-radius:14px; padding:12px 14px; font:inherit; background:#f2f6ff; }
  input:focus { outline:none; border-color:#38bdf8; }
  button { width:100%; margin-top:12px; border:0; border-bottom:4px solid #1b4fd6; background:#2f6bff; color:#fff; border-radius:14px; padding:12px; font:inherit; font-weight:900; text-transform:uppercase; cursor:pointer; }
  .erro { color:#ea2b2b; margin:10px 0 0; font-size:14px; }
</style></head>
<body><form method="post" action="/login">
  <h1>evo</h1>
  <input type="password" name="senha" placeholder="Senha da equipe" autocomplete="current-password" autofocus required>
  <button>Entrar</button>
  ${erro ? `<p class="erro">${erro}</p>` : ''}
</form></body></html>`;
