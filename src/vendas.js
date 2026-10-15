// Paliativo para o "vendido hoje" enquanto a API pública do Nexu não informa a data real do ganho (`wonAt`).
// Funções puras: o conector só faz as chamadas e o armazenamento.
//
// O problema: a API só dá `updatedAt` do lead, que muda a cada edição. Um lead ganho em setembro e editado hoje
// parece venda de hoje. E upsells que não passam por lead nunca aparecem em "Ganho".
// A solução em três regras:
//  1) Congelar a data da primeira vez que o Evo viu o lead em "Ganho" (editar depois não move a venda para hoje).
//  2) Vendas sem lead (tickets comerciais "COM-…" criados hoje e já aprovados) entram pelos tickets.
//  3) Uma lista manual de exceções para o que o Evo já encontrou "editado hoje" na primeira execução.

const alfanum = (s) => String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const digitos = (s) => String(s ?? '').replace(/\D/g, '');

// Regra 1. `vistos` = { idDoLead: ISO da primeira vez que foi visto }. Devolve a data de cada lead e o que é novo.
// Lead que o Evo já conhecia mantém a data guardada; lead novo guarda o `updatedAt` de agora (ou o momento atual).
export function congelarDatas(leads, vistos = {}, agora = new Date()) {
  const datas = new Map();
  const novos = {};
  for (const l of leads) {
    const guardada = vistos[l.id];
    const data = l.wonAt ?? guardada ?? l.updatedAt ?? agora.toISOString(); // wonAt (quando a API trouxer) é a verdade
    datas.set(l.id, data);
    if (!guardada) novos[l.id] = data;
  }
  return { datas, novos };
}

// Tickets comerciais já aprovados (saíram de "pendente_financeiro") não contam enquanto aguardam o financeiro.
const STATUS_NAO_APROVADOS = new Set(['pendente_financeiro', 'cancelado', 'devolvido_para_consultor']);

// Regra 2. Vendas que o Nexu conta no "Total aprovado" mas que não têm lead em "Ganho": tickets `COM-…` criados
// a partir de `inicio` e aprovados. Não duplica com uma venda de lead do mesmo cliente (por CNPJ, ou nome).
export function vendasDeTickets(tickets, vendasDeLeads, inicio) {
  const cnpjsDeLeads = new Set(vendasDeLeads.map((v) => digitos(v.cnpj)).filter((d) => d.length >= 11));
  const nomesDeLeads = new Set(vendasDeLeads.map((v) => alfanum(v.cliente)).filter(Boolean));
  return tickets
    .filter((t) => String(t.code ?? '').startsWith('COM-'))
    .filter((t) => new Date(t.createdAt) >= inicio)
    .filter((t) => !STATUS_NAO_APROVADOS.has(t.status))
    .filter((t) => (Number(t.setupAmount) || 0) + (Number(t.recurringAmount) || 0) > 0)
    .filter((t) => !cnpjsDeLeads.has(digitos(t.cnpj)) && !nomesDeLeads.has(alfanum(t.company)))
    .map((t) => ({
      id: `ticket:${t.code}`,
      cliente: String(t.company ?? '').trim(),
      cnpj: t.cnpj ?? null,
      valor: (Number(t.setupAmount) || 0) + (Number(t.recurringAmount) || 0),
      vendedor: null,
      fechadoEm: t.createdAt,
      origem: 'ticket',
    }));
}

// Regra 3. "Cliente A; Cliente B; id-do-lead": nomes (sem diferenciar maiúscula/acento/pontuação) ou ids.
export function aplicarIgnorar(vendas, texto = '') {
  const alvos = String(texto).split(';').map((s) => s.trim()).filter(Boolean);
  if (!alvos.length) return vendas;
  const ids = new Set(alvos);
  const nomes = new Set(alvos.map(alfanum));
  return vendas.filter((v) => !ids.has(v.id) && !nomes.has(alfanum(v.cliente)));
}
