// Indicadores de negócio calculados a partir do Nexu. Funções puras (o conector faz as chamadas).
const DIA = 24 * 3600 * 1000;
const sem = (s) => String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const dias = (data, agora) => Math.max(0, (agora - new Date(data).getTime()) / DIA);

// Dinheiro travado no financeiro: tickets comerciais que ainda aguardam a aprovação do pagamento.
// A idade conta desde a criação do ticket (a API pública não informa quando entrou na fila).
export function financeiroTravado(tickets, agora = Date.now()) {
  const itens = tickets
    .filter((t) => t.status === 'pendente_financeiro')
    .map((t) => ({
      id: t.code || t.id,
      cliente: String(t.company ?? '').trim(),
      tipo: t.type ?? null,
      setup: Number(t.setupAmount) || 0,
      recorrencia: Number(t.recurringAmount) || 0,
      valor: (Number(t.setupAmount) || 0) + (Number(t.recurringAmount) || 0),
      dias: dias(t.createdAt, agora),
    }))
    .sort((a, b) => b.dias - a.dias);
  return {
    valor: itens.reduce((s, i) => s + i.valor, 0),
    quantidade: itens.length,
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
