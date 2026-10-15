// Nexu Public API (OpenAPI 3.0.3): https://<instancia>/api/docs
// Autenticação: cabeçalho X-Api-Key. Listagens paginadas (limit máx. 100).
//
// Limitações da API que este conector contorna:
//  - Não há "data de entrada na etapa" nem "data de fechamento": usamos `updatedAt` como aproximação.
//    Qualquer edição no registro (ex.: marcar subtarefa) renova o updatedAt, então um ticket pode
//    parecer menos parado do que realmente está.
//  - Leads não têm vendedor/responsável, então o ranking por vendedor fica vazio.
//  - A listagem vem ordenada por criação, não por atualização: é preciso varrer todas as páginas.

import { ler, gravar } from '../armazenamento.js';
import { congelarDatas, vendasDeTickets, aplicarIgnorar } from '../vendas.js';
import { financeiroTravado, pipelineAberto, etapaViva } from '../negocio.js';

const LIMITE_PAGINA = 100;
const ETAPAS_FINAIS = new Set(['concluido', 'cancelado']);
const cache = new Map();

function config() {
  const base = process.env.NEXU_BASE_URL;
  const token = process.env.NEXU_TOKEN;
  if (!base || !token) throw new Error('Nexu: preencha NEXU_BASE_URL e NEXU_TOKEN no .env');
  return { base: `${base.replace(/\/$/, '')}/api/public/v1`, token };
}

async function get(caminho, params = {}) {
  const { base, token } = config();
  const url = new URL(base + caminho);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { 'X-Api-Key': token }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    const corpo = await res.json().catch(() => null);
    throw new Error(`Nexu respondeu ${res.status}${corpo?.error?.message ? `: ${corpo.error.message}` : ''}`);
  }
  return res.json();
}

// Lê todas as páginas (as demais em paralelo, em lotes de 5).
async function listarTudo(caminho, params = {}) {
  const primeira = await get(caminho, { ...params, limit: LIMITE_PAGINA, page: 1 });
  const itens = [...primeira.items];
  const total = primeira.meta?.totalPages ?? 1; // /users não pagina
  for (let p = 2; p <= total; p += 5) {
    const lote = [];
    for (let i = p; i < Math.min(p + 5, total + 1); i++) lote.push(get(caminho, { ...params, limit: LIMITE_PAGINA, page: i }));
    for (const r of await Promise.all(lote)) itens.push(...r.items);
  }
  return itens;
}

// Evita varrer milhares de registros a cada ciclo do painel. Guarda também as falhas pelo mesmo tempo,
// para não repetir dezenas de chamadas enquanto a API está dando erro.
const cacheMs = () => Number(process.env.NEXU_CACHE_SEGUNDOS ?? 60) * 1000;
function comCache(chave, fn) {
  const c = cache.get(chave);
  if (c && Date.now() - c.em < cacheMs()) return c.promessa;
  const promessa = fn();
  cache.set(chave, { promessa, em: Date.now() });
  return promessa;
}

const normalizar = (s) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();

// O funil é o kanban de Implantação (e o de Upsell / Expansão). A coluna em que cada ticket está
// NÃO vem na API pública hoje: só nas rotas internas do app, que exigem login de usuário.
// O conector espera que a API passe a devolver, em GET /tickets/implantacao:
//   columnName       nome da coluna do kanban        (ex.: "Portifólio")
//   funnelName       nome do kanban/funil            (ex.: "Implantação", "Upsell / Expansão")
//   columnEnteredAt  quando entrou na coluna atual   (ISO; se faltar, cai para updatedAt)
// Enquanto isso não existir, falha com um aviso claro em vez de chutar a etapa. (As notas do
// ticket trazem um histórico de "Etapa alterada", mas ele não é confiável: bate com a coluna
// real em só 23 de 159 tickets.)
export function mapearFunil(tickets, { ignorar, funis }) {
  if (tickets.length && !tickets.some((t) => t.columnName)) {
    throw new Error(
      'A API pública do Nexu ainda não informa a coluna do kanban (faltam columnName, funnelName e columnEnteredAt em /tickets/implantacao)',
    );
  }
  return tickets
    .filter((t) => t.columnName && funis.includes(normalizar(t.funnelName ?? '')))
    .filter((t) => !ignorar.has(normalizar(t.columnName)))
    .map((t) => ({
      id: t.code || t.id,
      cliente: t.company,
      // O primeiro funil da lista é o principal; os outros ganham prefixo para não confundir colunas homônimas.
      etapa: normalizar(t.funnelName) === funis[0] ? t.columnName : `${t.funnelName.split('/')[0].trim()} · ${t.columnName}`,
      etapaDesde: t.columnEnteredAt ?? t.updatedAt,
      responsavel: t.assigneeName || 'Sem responsável',
      concluido: ETAPAS_FINAIS.has(t.status) || normalizar(t.columnName) === 'concluido',
    }));
}

const lista = (valor, padrao) => (valor ?? padrao).split(',').map(normalizar).filter(Boolean);

// Usuários ativos do Nexu ({ id, name, email, sector, role }).
export const listarUsuarios = () => comCache('usuarios', () => listarTudo('/users'));

// Todos os tickets de implantação/comerciais: uma varredura só (cache) serve ao funil e às vendas.
const ticketsBrutos = () => comCache('tickets-brutos', () => listarTudo('/tickets/implantacao'));

// -> { id, cliente, etapa, etapaDesde, responsavel, concluido }
export async function funil() {
  return comCache('funil', async () => {
    const tickets = await ticketsBrutos();
    return mapearFunil(tickets, {
      ignorar: new Set(lista(process.env.NEXU_FUNIL_IGNORAR, 'Berçario,Configuração Serviços Extra')),
      funis: lista(process.env.NEXU_FUNIS, 'Implantação,Upsell / Expansão'),
    });
  });
}

// O detalhe do lead (GET /leads/{id}) traz em `notes` um bloco "__NEXU_LEAD_META__:{...}" com o campo
// `consultant`: a consultora responsável pela venda. A listagem de leads não traz `notes`.
export function consultoraDoLead(notes) {
  const m = /"consultant":("(?:[^"\\]|\\.)*")/.exec(notes ?? '');
  if (!m) return null;
  try {
    return JSON.parse(m[1]).trim() || null;
  } catch {
    return null;
  }
}

const consultoras = new Map(); // `${id}:${updatedAt}` -> nome (o lead só muda se updatedAt mudar)

// Busca a consultora de cada lead (5 por vez). Falha em um lead não derruba as vendas: fica sem vendedor.
async function comConsultora(leads) {
  const resultado = [];
  for (let i = 0; i < leads.length; i += 5) {
    resultado.push(...(await Promise.all(leads.slice(i, i + 5).map(async (l) => {
      const chave = `${l.id}:${l.updatedAt}`;
      if (!consultoras.has(chave)) {
        try {
          const d = await get(`/leads/${l.id}`);
          consultoras.set(chave, consultoraDoLead((d.item ?? d).notes));
        } catch {
          return { ...l, vendedor: null };
        }
      }
      return { ...l, vendedor: consultoras.get(chave) };
    }))));
  }
  return resultado;
}

// Quando a API pública passar a informar, o conector usa os campos corretos do Nexu:
//   wonAt   data real do ganho  (hoje só existe `updatedAt`, que muda a cada edição do lead)
//   seller  { id, name } vendedor responsável  (hoje só há o `consultant` das notas, que às vezes vem vazio)
const nomeDoVendedor = (l) => l.seller?.name ?? l.sellerName ?? null;

// Datas de ganho "congeladas" (veja src/vendas.js): { idDoLead: ISO da primeira vez que o Evo o viu em Ganho }.
let vistosEmMemoria = null;
async function carregarVistos() {
  if (vistosEmMemoria) return vistosEmMemoria;
  try {
    vistosEmMemoria = (await ler('ganhos'))?.vistos ?? {};
  } catch (e) {
    console.error(`[ganhos] sem armazenamento, usando a data de atualização do Nexu: ${e.message}`);
    return null; // sem como congelar: cai para updatedAt, como antes
  }
  return vistosEmMemoria;
}

async function guardarNovos(novos) {
  try {
    // Relê antes de gravar: outra instância pode ter guardado algo; a data mais antiga (a que já estava) vence.
    const atual = (await ler('ganhos'))?.vistos ?? {};
    vistosEmMemoria = { ...novos, ...atual };
    await gravar('ganhos', { vistos: vistosEmMemoria });
  } catch (e) {
    console.error(`[ganhos] não consegui guardar as datas: ${e.message}`);
  }
}

// Leads na etapa "Ganho" (+ upsells que só existem como ticket) -> { id, cliente, valor, vendedor, fechadoEm }
export async function vendas() {
  return comCache('vendas', async () => {
    const etapas = (process.env.NEXU_ETAPAS_GANHO ?? 'Ganho').split(',').map((s) => s.trim()).filter(Boolean);
    const grupos = await Promise.all(etapas.map((status) => listarTudo('/leads', { status })));
    const todos = grupos.flat();

    // Regra 1: a data da venda é a da primeira vez que vimos o lead em Ganho, não a da última edição.
    const guardados = await carregarVistos();
    const { datas, novos } = congelarDatas(todos, guardados ?? {});
    if (guardados && Object.keys(novos).length) await guardarNovos(novos);
    const dataDe = (l) => (guardados ? datas.get(l.id) : (l.wonAt ?? l.updatedAt));

    // O vendedor só importa para o painel de hoje: não vale buscar o detalhe das ~1000 vendas antigas.
    const inicioHoje = new Date();
    inicioHoje.setHours(0, 0, 0, 0);
    const semVendedorDeHoje = todos.filter((l) => !nomeDoVendedor(l) && new Date(dataDe(l)) >= inicioHoje);
    const comNome = new Map((await comConsultora(semVendedorDeHoje)).map((l) => [l.id, l.vendedor]));
    const deLeads = todos.map((l) => ({
      id: l.id,
      cliente: l.company,
      cnpj: l.cnpj ?? null,
      valor: l.value ?? 0,
      vendedor: nomeDoVendedor(l) ?? comNome.get(l.id) ?? null,
      fechadoEm: dataDe(l),
    }));

    // Regra 3 antes da 2: o que foi ignorado não deve impedir/duplicar a venda do ticket.
    const contadas = aplicarIgnorar(deLeads, process.env.VENDAS_IGNORAR);

    // Regra 2: upsells aprovados hoje que não passam por lead.
    const tickets = await ticketsBrutos().catch(() => []);
    const hoje = contadas.filter((v) => new Date(v.fechadoEm) >= inicioHoje);
    return aplicarIgnorar([...contadas, ...vendasDeTickets(tickets, hoje, inicioHoje)], process.env.VENDAS_IGNORAR);
  });
}

// Indicadores de negócio: dinheiro aguardando o financeiro (tickets) e pipeline de vendas em aberto (leads).
// -> { financeiro: {...}, pipeline: {...} }  (formato em src/negocio.js)
export async function negocio() {
  return comCache('negocio', async () => {
    const tickets = await ticketsBrutos();
    const colunas = (await get('/leads/columns')).items ?? [];
    // Só as etapas vivas do funil (sem Ganho/Perdido/Congelado/No Show): poucas consultas, em vez de varrer todos os leads.
    const abertas = colunas.filter((c) => !c.terminal && etapaViva(c.name)).map((c) => c.name);
    const grupos = await Promise.all(abertas.map((status) => listarTudo('/leads', { status })));
    return {
      financeiro: financeiroTravado(tickets),
      pipeline: pipelineAberto(grupos.flat(), {
        diasAntigo: Number(process.env.LIMITE_LEAD_ANTIGO_DIAS ?? 30),
        ordemEtapas: colunas.map((c) => c.name),
      }),
    };
  });
}
