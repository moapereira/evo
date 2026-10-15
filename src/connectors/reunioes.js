// Reuniões do comercial, lidas direto da agenda do Microsoft 365 (Teams) via Microsoft Graph.
//
// Por que não do Nexu: a integração do Nexu só conta quem conectou o Teams lá (Camilla e Hugo não conectaram) e a API
// pública do Nexu não expõe esses números. A agenda do Microsoft 365 é a fonte original e cobre todo mundo.
//
// Permissão necessária no Azure (Entra ID): app com permissão de APLICATIVO `Calendars.Read` + consentimento do admin.
// Recomendado: restringir o app às caixas das pessoas listadas com uma Application Access Policy (veja o LEIAME).
import { listarUsuarios } from './nexu.js';

const LOGIN = () => process.env.MS_LOGIN_BASE || 'https://login.microsoftonline.com';
const GRAPH = () => process.env.MS_GRAPH_BASE || 'https://graph.microsoft.com/v1.0';

const sem = (s) => String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

let token = { valor: null, expira: 0 };
async function obterToken() {
  if (token.valor && Date.now() < token.expira - 60_000) return token.valor;
  const { MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET } = process.env;
  if (!MS_TENANT_ID || !MS_CLIENT_ID || !MS_CLIENT_SECRET) {
    throw new Error('Microsoft 365 ainda não conectado: um administrador precisa criar o app no Azure (veja o LEIAME).');
  }
  const r = await fetch(`${LOGIN()}/${MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: MS_CLIENT_ID, client_secret: MS_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`Microsoft 365 recusou o login do app (HTTP ${r.status}). Confira tenant, client id e secret.`);
  const j = await r.json();
  token = { valor: j.access_token, expira: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return token.valor;
}

// ----- regras (puras) -----

// Evento da agenda -> é uma reunião que conta? Teams (online), não cancelada, não "dia inteiro", não recusada.
export function contaComoReuniao(ev, { soTeams = true } = {}) {
  if (!ev || ev.isCancelled || ev.isAllDay) return false;
  if (ev.responseStatus?.response === 'declined') return false;
  if (soTeams && ev.isOnlineMeeting !== true) return false;
  return true;
}

const comoUtc = (g) => {
  const t = g?.dateTime ?? '';
  return new Date(/Z$|[+-]\d\d:\d\d$/.test(t) ? t : `${t}Z`); // o Graph devolve horário sem fuso quando pedimos UTC
};

// [{ pessoa, eventos }] -> reuniões únicas (a mesma reunião em duas agendas conta uma vez, com as duas pessoas).
export function consolidarReunioes(porPessoa, { agora = new Date(), soTeams = true } = {}) {
  const por = new Map();
  for (const { pessoa, eventos } of porPessoa) {
    for (const ev of eventos) {
      if (!contaComoReuniao(ev, { soTeams })) continue;
      const chave = ev.iCalUId || ev.id;
      const inicio = comoUtc(ev.start), fim = comoUtc(ev.end);
      if (Number.isNaN(inicio.getTime())) continue;
      const atual = por.get(chave) ?? { id: chave, assunto: ev.subject || '(sem assunto)', inicio: inicio.toISOString(), fim: fim.toISOString(), pessoas: [] };
      if (!atual.pessoas.includes(pessoa)) atual.pessoas.push(pessoa);
      por.set(chave, atual);
    }
  }
  return [...por.values()]
    .map((r) => ({ ...r, realizada: new Date(r.fim) <= agora }))
    .sort((a, b) => a.inicio.localeCompare(b.inicio));
}

// Quantas reuniões começam em cada hora do dia (horário local do servidor, que o Evo fixa em São Paulo).
export function reunioesPorHora(reunioes) {
  const horas = Array(24).fill(0);
  for (const r of reunioes) horas[new Date(r.inicio).getHours()]++;
  return horas;
}

// Nomes configurados -> pessoas do Nexu (com e-mail). Aceita parte do nome, sem diferenciar acento/maiúscula.
// Se um nome bater com mais de uma pessoa, usa a que tem o nome mais parecido (igual ou começando igual).
export function resolverPessoas(nomes, usuarios) {
  const achadas = [], faltando = [];
  for (const nome of nomes) {
    const alvo = sem(nome);
    const candidatos = usuarios.filter((u) => u.email && sem(u.name).includes(alvo));
    const exato = candidatos.filter((u) => sem(u.name) === alvo);
    const escolhidos = exato.length ? exato : candidatos;
    if (escolhidos.length === 1) achadas.push({ nome: escolhidos[0].name, email: escolhidos[0].email });
    else faltando.push(escolhidos.length ? `${nome} (mais de uma pessoa: ${escolhidos.map((u) => u.name).join(', ')})` : nome);
  }
  return { achadas, faltando };
}

// ----- leitura do Graph -----
async function eventosDaAgenda(email, inicioIso, fimIso) {
  const url = new URL(`${GRAPH()}/users/${encodeURIComponent(email)}/calendarView`);
  url.searchParams.set('startDateTime', inicioIso);
  url.searchParams.set('endDateTime', fimIso);
  url.searchParams.set('$select', 'id,iCalUId,subject,start,end,isCancelled,isAllDay,isOnlineMeeting,responseStatus');
  url.searchParams.set('$top', '100');
  const eventos = [];
  let proxima = url.toString();
  for (let pagina = 0; proxima && pagina < 10; pagina++) {
    const r = await fetch(proxima, {
      headers: { Authorization: `Bearer ${await obterToken()}`, Prefer: 'outlook.timezone="UTC"' },
      signal: AbortSignal.timeout(20_000),
    });
    if (r.status === 403 || r.status === 401) {
      console.error(`[reunioes] sem permissão para ler a agenda de ${email} (HTTP ${r.status}): falta consentimento do admin para Calendars.Read, ou a política de acesso do app não inclui essa caixa`);
      throw new Error('sem permissão para ler a agenda');
    }
    if (r.status === 404) {
      console.error(`[reunioes] caixa de e-mail não encontrada: ${email}`);
      throw new Error('caixa de e-mail não encontrada');
    }
    if (!r.ok) throw new Error(`erro ${r.status} do Microsoft Graph`);
    const j = await r.json();
    eventos.push(...(j.value ?? []));
    proxima = j['@odata.nextLink'];
  }
  return eventos;
}

const cacheUsuarios = { em: 0, valor: null };
async function usuarios() {
  if (cacheUsuarios.valor && Date.now() - cacheUsuarios.em < 10 * 60_000) return cacheUsuarios.valor;
  cacheUsuarios.valor = await listarUsuarios();
  cacheUsuarios.em = Date.now();
  return cacheUsuarios.valor;
}

// -> { reunioes: [...], pessoas: [nomes lidos], avisos: [...] }   (avisos = pessoas que não deu para ler)
export async function reunioesDeHoje() {
  await obterToken(); // sem credenciais (ou login recusado) o erro é um só, em vez de um por pessoa
  const nomes = (process.env.REUNIOES_PESSOAS ?? 'Ityara Oliveira,Nicole Assis,Camilla Caldeira,Daniel Miguel,Hugo Henrique Belini')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const { achadas, faltando } = resolverPessoas(nomes, await usuarios());
  const ini = new Date(); ini.setHours(0, 0, 0, 0);
  const fim = new Date(); fim.setHours(23, 59, 59, 999);

  const avisos = faltando.map((n) => `${n}: não achei no Nexu`);
  const porPessoa = [];
  await Promise.all(achadas.map(async (p) => {
    try {
      porPessoa.push({ pessoa: p.nome, eventos: await eventosDaAgenda(p.email, ini.toISOString(), fim.toISOString()) });
    } catch (e) {
      avisos.push(`${p.nome}: ${e.message}`);
    }
  }));
  if (!porPessoa.length) throw new Error(avisos.join(' · ') || 'nenhuma agenda pôde ser lida');

  const reunioes = consolidarReunioes(porPessoa, { soTeams: process.env.REUNIOES_SO_TEAMS !== 'false' });
  const resultado = reunioes;
  resultado.pessoas = porPessoa.map((p) => p.pessoa);
  resultado.avisos = avisos;
  return resultado;
}
