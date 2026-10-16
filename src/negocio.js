// Indicadores de negócio calculados a partir do Nexu. Funções puras (o conector faz as chamadas).
const DIA = 24 * 3600 * 1000;
const sem = (s) => String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const dias = (data, agora) => Math.max(0, (agora - new Date(data).getTime()) / DIA);

const digitos = (s) => String(s ?? '').replace(/\D/g, '');
const setupDe = (t) => Number(t.setupAmount) || 0;
const recorrenciaDe = (t) => Number(t.recurringAmount) || 0;

// Como o Dashboard do Nexu classifica os tickets comerciais.
const APROVADOS = new Set(['pagamento_confirmado', 'em_implantacao', 'concluido']);
const AGUARDANDO = 'pendente_financeiro';

// Início do mês do jeito que o Dashboard do Nexu filtra "Este mês": dia 1 às 00:00 UTC (ele manda a data com "Z").
export function inicioDoMes(agora = Date.now()) {
  const d = new Date(agora);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1));
}

// Data da venda de cada ticket, como o Nexu calcula: `wonAt` do lead que gerou o ticket; sem lead ganho, a criação do ticket.
// A API pública não diz qual lead gerou o ticket, então procuramos o lead ganho do mesmo CNPJ com `wonAt` mais
// próximo da criação do ticket (até `janelaDias`). Conferido contra o Dashboard: acerta o mês em ~99% dos tickets.
// Se a API passar a mandar `saleDate`/`wonAt` no ticket, eles têm prioridade.
export function datasDeVenda(tickets, leadsGanhos, { janelaDias = 30 } = {}) {
  const porCnpj = new Map();
  for (const l of leadsGanhos) {
    const c = digitos(l.cnpj);
    if (c.length < 11 || !l.wonAt) continue;
    if (!porCnpj.has(c)) porCnpj.set(c, []);
    porCnpj.get(c).push(l);
  }
  const janela = janelaDias * DIA;
  const datas = new Map();
  for (const t of tickets) {
    let data = t.saleDate ?? t.wonAt ?? null;
    if (!data) {
      const criado = new Date(t.createdAt).getTime();
      let melhor = null;
      let dist = Infinity;
      for (const l of porCnpj.get(digitos(t.cnpj)) ?? []) {
        const d = Math.abs(new Date(l.wonAt).getTime() - criado);
        if (d < dist) [dist, melhor] = [d, l];
      }
      data = melhor && dist <= janela ? melhor.wonAt : t.createdAt;
    }
    datas.set(t, data);
  }
  return datas;
}

const somar = (lista) => {
  const setup = lista.reduce((s, t) => s + setupDe(t), 0);
  const recorrencia = lista.reduce((s, t) => s + recorrenciaDe(t), 0);
  return { quantidade: lista.length, setup, recorrencia, total: setup + recorrencia };
};

// Os números do Dashboard do Nexu ("Este mês"): Total aprovado e Aguardando aprovação, com setup e recorrência.
// Só tickets comerciais (código COM-…) cuja data da venda cai no mês.
export function vendasDoMes(tickets, datas, agora = Date.now()) {
  const inicio = inicioDoMes(agora).getTime();
  const doMes = tickets
    .filter((t) => String(t.code ?? '').startsWith('COM-'))
    .filter((t) => new Date(datas.get(t) ?? t.createdAt).getTime() >= inicio);
  const aprovados = doMes.filter((t) => APROVADOS.has(t.status));
  return {
    desde: new Date(inicio).toISOString(),
    aprovado: somar(aprovados),
    aguardando: somar(doMes.filter((t) => t.status === AGUARDANDO)),
    clientesNovos: aprovados.filter((t) => t.type === 'novo').length,
    upsells: aprovados.filter((t) => t.type !== 'novo').length,
  };
}

// Dinheiro travado no financeiro: tickets comerciais que ainda aguardam a aprovação do pagamento.
// O total de cima é o do mês (igual ao "Aguardando aprovação" do Dashboard do Nexu); os de meses anteriores que
// continuam parados aparecem à parte, para não sumirem. A idade conta desde a criação do ticket.
export function financeiroTravado(tickets, agora = Date.now(), datas = new Map()) {
  const inicio = inicioDoMes(agora).getTime();
  const itens = tickets
    .filter((t) => t.status === AGUARDANDO)
    .map((t) => ({
      id: t.code || t.id,
      cliente: String(t.company ?? '').trim(),
      tipo: t.type ?? null,
      setup: setupDe(t),
      recorrencia: recorrenciaDe(t),
      valor: setupDe(t) + recorrenciaDe(t),
      dias: dias(t.createdAt, agora),
      doMes: new Date(datas.get(t) ?? t.createdAt).getTime() >= inicio,
    }))
    .sort((a, b) => b.dias - a.dias);
  const doMes = itens.filter((i) => i.doMes);
  const anteriores = itens.filter((i) => !i.doMes);
  return {
    valor: doMes.reduce((s, i) => s + i.valor, 0),
    quantidade: doMes.length,
    anteriores: { quantidade: anteriores.length, valor: anteriores.reduce((s, i) => s + i.valor, 0) },
    maisAntigoDias: itens[0]?.dias ?? 0,
    itens,
  };
}

// Etapas que não fazem parte do funil "vivo": ganhos, perdidos, congelados e no-show.
const FORA_DO_FUNIL = ['ganho', 'perdido', 'congelado', 'no show', 'oportunidade futura'];
export const etapaViva = (nome) => !FORA_DO_FUNIL.some((f) => sem(nome).includes(f));

// Pipeline de vendas em aberto e os leads ANTIGOS: abertos há `diasAntigo` dias ou mais, contando da criação.
// (Não dá para medir "parado" pela última atualização: o Nexu atualiza todos os leads vivos toda semana, então
// nenhum aparece com mais de 7 dias sem mexer. A idade desde a criação é o que a API pública permite medir.)
// `ordemEtapas` = nomes na ordem do funil (da API /leads/columns), para listar as etapas na ordem certa.
export function pipelineAberto(leads, { diasAntigo = 30, agora = Date.now(), ordemEtapas = [] } = {}) {
  const vivos = leads.filter((l) => etapaViva(l.status));
  const etapas = new Map();
  for (const l of vivos) {
    const e = etapas.get(l.status) ?? { etapa: l.status, quantidade: 0, valor: 0 };
    e.quantidade++;
    e.valor += Number(l.value) || 0;
    etapas.set(l.status, e);
  }
  const pos = (n) => (ordemEtapas.indexOf(n) >= 0 ? ordemEtapas.indexOf(n) : 999);
  const antigos = vivos
    .map((l) => ({ id: l.id, empresa: String(l.company ?? '').trim(), etapa: l.status, valor: Number(l.value) || 0, dias: dias(l.createdAt, agora) }))
    .filter((l) => l.dias >= diasAntigo)
    .sort((a, b) => b.dias - a.dias);
  return {
    valor: vivos.reduce((s, l) => s + (Number(l.value) || 0), 0),
    quantidade: vivos.length,
    etapas: [...etapas.values()].sort((a, b) => pos(a.etapa) - pos(b.etapa)),
    antigos,
    valorAntigos: antigos.reduce((s, l) => s + l.valor, 0),
    limiteDias: diasAntigo,
  };
}
