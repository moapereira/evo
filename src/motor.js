// O "cérebro" do Evo: busca as fontes, calcula o estado do painel e dispara os avisos.
// Não sabe nada de HTTP: roda igual num servidor sempre ligado (setInterval) e na Vercel (a cada requisição).
import './fuso.js';
import * as mock from './connectors/mock.js';
import * as atenderbem from './connectors/atenderbem.js';
import * as nexu from './connectors/nexu.js';
import { reunioesDeHoje, reunioesPorHora } from './connectors/reunioes.js';
import {
  ticketsAbertos, ticketsAtrasados, funilParado, resumoEtapas,
  vendasDeHoje, vendasPorHora, ranking, chaveAlerta, unificarVendedores, atribuirVendedoresManuais,
} from './rules.js';
import { chaveDia, calcularJogo, missoes, julgarDia } from './gamificacao.js';
import { avisarTeams } from './notifier.js';
import { importarPasta, importarPlanilha, carregarHistorico, analisar as analisarInstancias } from './instancias.js';
import { ler, gravar } from './armazenamento.js';

const env = process.env;
const limites = {
  suporte: Number(env.LIMITE_SUPORTE_HORAS ?? 24),
  funil: Number(env.LIMITE_FUNIL_HORAS ?? 48),
  instancias: Number(env.LIMITE_INSTANCIAS_DIAS ?? 3),
};
const metaReunioesDia = Number(env.META_REUNIOES_DIA ?? 10);
const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const intervaloMs = () => Number(env.POLL_SEGUNDOS ?? 30) * 1000;
const RECARGA_INSTANCIAS_MS = 5 * 60 * 1000; // outra instância pode ter recebido uma planilha nova

const fonte = (nome, real, falso) => (env[nome] === 'real' ? real : falso);
const origens = {
  vendas: fonte('SOURCE_VENDAS', nexu.vendas, mock.vendas),
  tickets: fonte('SOURCE_SUPORTE', atenderbem.tickets, mock.tickets),
  funil: fonte('SOURCE_FUNIL', nexu.funil, mock.funil),
  reunioes: fonte('SOURCE_REUNIOES', reunioesDeHoje, mock.reunioes),
  negocio: fonte('SOURCE_NEGOCIO', nexu.negocio, mock.negocio),
};

// Último dado bom de cada fonte: uma falha momentânea não zera o painel.
const NEGOCIO_VAZIO = {
  financeiro: { valor: 0, quantidade: 0, maisAntigoDias: 0, itens: [] },
  pipeline: { valor: 0, quantidade: 0, etapas: [], antigos: [], valorAntigos: 0, limiteDias: 30 },
};
const dados = { vendas: [], tickets: [], funil: [], reunioes: [], negocio: NEGOCIO_VAZIO };
let historico = null; // { 'AAAA-MM-DD': { vendas, atrasosMax, bateu, avaliado } }
let ultimoGravado = '';
let histInstancias = null;
let instanciasLidoEm = 0;
let estado = null;
let ultimoCiclo = 0;

async function buscar(nome, erros) {
  try {
    const lido = await origens[nome]();
    dados[nome] = lido;
    // Fonte parcial (ex.: uma fila recusou a chave): usa o que veio, mas mostra o aviso no painel.
    if (lido?.avisos?.length) erros[nome === 'tickets' ? 'suporte' : nome] = lido.avisos.join('; ');
    return true;
  } catch (e) {
    erros[nome === 'tickets' ? 'suporte' : nome] = e.message;
    console.error(`[${nome}] ${e.message}`);
    return false;
  }
}

// Um ciclo por vez: se a atualização anterior ainda não terminou, quem pedir espera por ela.
let rodando = null;
export function atualizar() {
  rodando ??= ciclo().finally(() => { rodando = null; });
  return rodando;
}

// Devolve o estado atual, atualizando antes se ele já passou do intervalo. É o que a Vercel usa:
// lá não há processo ligado, então "tempo real" é o painel perguntando de poucos em poucos segundos.
export async function obterEstado() {
  if (!estado || Date.now() - ultimoCiclo > intervaloMs()) await atualizar();
  return estado;
}

// Registra uma planilha do painel de instâncias (enviada pela tela) e já atualiza o card.
export async function receberPlanilha(nome, buffer) {
  histInstancias = await importarPlanilha(nome, buffer);
  instanciasLidoEm = Date.now();
  if (rodando) await rodando.catch(() => {});
  await atualizar();
  return estado.instancias;
}

async function ciclo() {
  const erros = {};
  const comarmazenamento = async (fn, rotulo) => {
    try {
      return await fn();
    } catch (e) {
      erros.armazenamento = e.message;
      console.error(`[armazenamento:${rotulo}] ${e.message}`);
      return undefined;
    }
  };

  historico ??= (await comarmazenamento(() => ler('historico'), 'historico')) ?? {};
  if (!histInstancias) {
    histInstancias = (await comarmazenamento(carregarHistorico, 'instancias')) ?? { dias: [], ultimoDia: null, clientes: {} };
    instanciasLidoEm = Date.now();
  }

  const [okVendas, okTickets, okFunil, okReunioes, okNegocio] = await Promise.all([
    buscar('vendas', erros), buscar('tickets', erros), buscar('funil', erros), buscar('reunioes', erros), buscar('negocio', erros),
  ]);

  const vendasHoje = unificarVendedores(
    atribuirVendedoresManuais(vendasDeHoje(dados.vendas), env.VENDEDOR_POR_CLIENTE),
    env.VENDEDORES_ALIAS,
  );
  const atrasadosSuporte = ticketsAtrasados(dados.tickets, limites.suporte);
  const parados = funilParado(dados.funil, limites.funil);
  const etapas = resumoEtapas(dados.funil, limites.funil);
  const abertos = ticketsAbertos(dados.tickets).length;
  const ativosFunil = etapas.reduce((s, e) => s + e.total, 0);
  const totalAtrasos = atrasadosSuporte.length + parados.length;
  const reunioesHoje = dados.reunioes;
  const reunioesRealizadas = reunioesHoje.filter((r) => r.realizada).length;
  const valor = vendasHoje.reduce((s, v) => s + (Number(v.valor) || 0), 0);

  // Metas do dia -> corações. O coração é ganho assim que todas as metas que dá para avaliar estão batidas
  // (e fica ganho, mesmo que um atraso apareça mais tarde). Fonte fora do ar não é julgada.
  const listaMissoes = missoes({
    abertos, atrasadosSuporte: atrasadosSuporte.length, ativosFunil,
    paradosFunil: parados.length, reunioes: reunioesRealizadas, metaReunioes: metaReunioesDia,
  });
  const julgamento = julgarDia(listaMissoes, { suporte: okTickets, funil: okFunil, reunioes: okReunioes });
  const hoje = chaveDia();
  if (julgamento.avaliado) {
    const anterior = historico[hoje] ?? {};
    historico[hoje] = {
      vendas: okVendas ? vendasHoje.length : anterior.vendas ?? 0,
      atrasosMax: Math.max(anterior.atrasosMax ?? 0, totalAtrasos),
      avaliado: true,
      bateu: anterior.bateu === true || julgamento.bateu,
    };
    const texto = JSON.stringify(historico);
    if (texto !== ultimoGravado) {
      await comarmazenamento(() => gravar('historico', historico), 'gravar historico');
      ultimoGravado = texto;
    }
  }

  // Clientes sem movimento de mensagens oficiais: planilhas exportadas do painel de instâncias.
  // Local: pasta `importar/`. Nuvem: botão de envio da tela (receberPlanilha).
  const imp = await importarPasta().catch((e) => ({ importados: 0, erros: [e.message] }));
  if (imp.erros.length) erros.instancias = imp.erros.join('; ');
  if (imp.importados || Date.now() - instanciasLidoEm > RECARGA_INSTANCIAS_MS) {
    histInstancias = (await comarmazenamento(carregarHistorico, 'instancias')) ?? histInstancias;
    instanciasLidoEm = Date.now();
  }
  const inst = analisarInstancias(histInstancias, { dias: limites.instancias });

  const novoEstado = {
    atualizadoEm: new Date().toISOString(),
    limites,
    meta: { reunioesDia: metaReunioesDia },
    vendas: {
      hoje: vendasHoje, valor, porHora: vendasPorHora(vendasHoje), ranking: ranking(vendasHoje),
    },
    reunioes: {
      meta: metaReunioesDia,
      hoje: reunioesHoje,
      realizadas: reunioesRealizadas,
      agendadas: reunioesHoje.length - reunioesRealizadas,
      porHora: reunioesPorHora(reunioesHoje),
      pessoas: reunioesHoje.pessoas ?? [],
      semDados: !okReunioes && !reunioesHoje.length, // fonte fora do ar e nada guardado: não mostrar "0" como se fosse verdade
    },
    negocio: { ...dados.negocio, semDados: !okNegocio && dados.negocio === NEGOCIO_VAZIO },
    suporte: { abertos, atrasados: atrasadosSuporte },
    funil: { etapas, parados, ativos: ativosFunil },
    jogo: {
      ...calcularJogo(historico),
      missoes: listaMissoes,
      semAvaliar: listaMissoes.filter((m) => !{ suporte: okTickets, funil: okFunil, reunioes: okReunioes }[m.id]).map((m) => m.id),
    },
    instancias: inst,
    erros,
  };
  estado = novoEstado;

  const semana = Math.floor(Date.now() / (7 * 24 * 3600 * 1000)); // um aviso por cliente por semana
  const avisos = [
    ...vendasHoje.map((v) => ({
      chave: chaveAlerta.venda(v),
      texto: `🎉 Venda fechada: ${v.cliente}, ${brl(Number(v.valor) || 0)}${v.vendedor ? ` (${v.vendedor})` : ''}.`,
    })),
    ...atrasadosSuporte.map((t) => ({
      chave: chaveAlerta.suporte(t),
      texto: `Suporte: ${t.cliente} está há ${Math.floor(t.horas)}h sem resolução ("${t.assunto}", atendente ${t.atendente}).`,
    })),
    ...parados.map((n) => ({
      chave: chaveAlerta.funil(n),
      texto: `Implantação: ${n.cliente} parado há ${Math.floor(n.horas)}h em "${n.etapa}" (responsável ${n.responsavel}).`,
    })),
    ...inst.semMovimento.map((x) => ({
      chave: `instancia:${x.id}:${semana}`,
      texto: `Mensagens oficiais: ${x.instancia} ${x.motivo === 'zerado' ? 'zerado nos últimos 30 dias' : `sem variação há ${x.diasParado} dias`} (${x.filaOficial === true ? 'tem fila WA oficial' : x.filaOficial === false ? 'SEM fila WA oficial' : 'fila WA oficial não verificada'}).`,
    })),
  ];
  try {
    await avisarTeams(avisos);
  } catch (e) {
    novoEstado.erros.teams = e.message;
    console.error(`[teams] ${e.message}`);
  }
  ultimoCiclo = Date.now();
}
