// Regras de alerta e indicadores. Funções puras: recebem dados e "agora".

const HORA = 3600 * 1000;

export function horasDesde(data, agora = Date.now()) {
  return (agora - new Date(data).getTime()) / HORA;
}

const inicioDoDia = (agora) => {
  const d = new Date(agora);
  d.setHours(0, 0, 0, 0);
  return d;
};

const ticketAberto = (t) => t.status !== 'fechado' && t.status !== 'resolvido';

export const ticketsAbertos = (tickets) => tickets.filter(ticketAberto);

// Tickets ainda não resolvidos há mais de `limite` horas, o mais antigo primeiro.
export function ticketsAtrasados(tickets, limite, agora = Date.now()) {
  return ticketsAbertos(tickets)
    .map((t) => ({ ...t, horas: horasDesde(t.abertoEm, agora) }))
    .filter((t) => t.horas > limite)
    .sort((a, b) => b.horas - a.horas);
}

// Clientes parados na mesma etapa do funil há mais de `limite` horas.
export function funilParado(negocios, limite, agora = Date.now()) {
  return negocios
    .filter((n) => !n.concluido)
    .map((n) => ({ ...n, horas: horasDesde(n.etapaDesde, agora) }))
    .filter((n) => n.horas > limite)
    .sort((a, b) => b.horas - a.horas);
}

// Quantos clientes há em cada etapa (na ordem em que aparecem) e quantos estão parados.
export function resumoEtapas(negocios, limite, agora = Date.now()) {
  const etapas = new Map();
  for (const n of negocios.filter((x) => !x.concluido)) {
    const e = etapas.get(n.etapa) ?? { etapa: n.etapa, total: 0, parados: 0 };
    e.total++;
    if (horasDesde(n.etapaDesde, agora) > limite) e.parados++;
    etapas.set(n.etapa, e);
  }
  return [...etapas.values()];
}

export function vendasDeHoje(vendas, agora = Date.now()) {
  const inicio = inicioDoDia(agora);
  return vendas
    .filter((v) => new Date(v.fechadoEm) >= inicio)
    .sort((a, b) => new Date(b.fechadoEm) - new Date(a.fechadoEm));
}

// 24 posições: quantidade de vendas fechadas em cada hora do dia.
export function vendasPorHora(vendasHoje) {
  const horas = Array(24).fill(0);
  for (const v of vendasHoje) horas[new Date(v.fechadoEm).getHours()]++;
  return horas;
}

const espacos = (s) => String(s).trim().replace(/\s+/g, ' ');
const normNome = (s) => espacos(String(s).normalize('NFD').replace(/\p{Diacritic}/gu, '')).toLowerCase();

// O Nexu grava a mesma pessoa de jeitos diferentes ("Nicole" no campo consultora, "Nicole Assis" no vendedor).
// 1) Apelidos explícitos, no formato "Nicole=Nicole Assis, Jordan=Jordan Petersen" (estável de um dia para o outro).
// 2) Automático: um nome de uma palavra só vira o nome completo quando existe UM único nome completo que
//    começa com ele nas vendas do dia. Se houver dois (ex.: Ana Lima e Ana Souza), não adivinha.
// Vendas que o Nexu não informa de quem são (falta consultora/vendedor na API pública) podem ser atribuídas à mão:
// "Nome do cliente=Vendedor; Outro cliente=Outra pessoa". Só vale para venda SEM vendedor, e compara o nome do cliente
// sem diferenciar maiúsculas, acentos nem espaços repetidos.
export function atribuirVendedoresManuais(vendas, texto = '') {
  const porCliente = new Map();
  for (const par of String(texto).split(';')) {
    const i = par.lastIndexOf('=');
    if (i <= 0) continue;
    const cliente = normNome(par.slice(0, i)), vendedor = espacos(par.slice(i + 1));
    if (cliente && vendedor) porCliente.set(cliente, vendedor);
  }
  if (!porCliente.size) return vendas;
  return vendas.map((v) => (v.vendedor ? v : { ...v, vendedor: porCliente.get(normNome(v.cliente ?? '')) ?? v.vendedor }));
}

export function unificarVendedores(vendas, apelidosTexto = '') {
  const apelidos = new Map(
    String(apelidosTexto).split(/[;,]/).map((p) => p.split('=')).filter((p) => p.length === 2 && p[0].trim() && p[1].trim())
      .map(([de, para]) => [normNome(de), espacos(para)]),
  );
  const completos = [...new Set(vendas.map((v) => v.vendedor).filter(Boolean).map(espacos).filter((n) => n.includes(' ')))];
  const canonico = (nome) => {
    const n = espacos(nome);
    if (apelidos.has(normNome(n))) return apelidos.get(normNome(n));
    if (!n.includes(' ')) {
      const candidatos = completos.filter((c) => normNome(c.split(' ')[0]) === normNome(n));
      if (candidatos.length === 1) return candidatos[0];
    }
    return n;
  };
  return vendas.map((v) => (v.vendedor ? { ...v, vendedor: canonico(v.vendedor) } : v));
}

export function ranking(vendasHoje) {
  const por = new Map();
  const semNome = { vendedor: 'Sem consultora', qtd: 0, valor: 0, semNome: true };
  for (const v of vendasHoje) {
    if (!v.vendedor) {
      semNome.qtd++;
      semNome.valor += Number(v.valor) || 0;
      continue;
    }
    const r = por.get(v.vendedor) ?? { vendedor: v.vendedor, qtd: 0, valor: 0 };
    r.qtd++;
    r.valor += Number(v.valor) || 0;
    por.set(v.vendedor, r);
  }
  const lista = [...por.values()].sort((a, b) => b.qtd - a.qtd || b.valor - a.valor);
  // Vendas sem responsável entram no fim, para o ranking fechar com o total do dia. Se a fonte não
  // informa vendedor nenhum, o ranking fica vazio (em vez de um "Sem consultora" com tudo).
  return lista.length && semNome.qtd ? [...lista, semNome] : lista;
}

// Chave estável para não avisar duas vezes sobre o mesmo fato.
export const chaveAlerta = {
  suporte: (t) => `suporte:${t.id}`,
  funil: (n) => `funil:${n.id}:${n.etapa}`,
  venda: (v) => `venda:${v.id}`,
};
