// Clientes (instâncias) sem movimento de mensagens oficiais.
//
// O painel de parceiros do Atender Bem só mostra o total dos últimos 30 dias ("Msgs oficiais (30 dias)"),
// sem detalhe por dia. Por isso o Evo guarda o próprio histórico: a cada exportação do painel
// (.xlsx ou .csv, colocada na pasta `importar/`) ele registra uma "foto" do dia e compara com as anteriores.
//
//  - "zerado": o total de 30 dias é 0 (nenhuma mensagem oficial em 30 dias, logo também nos últimos 3).
//  - "parado": o total ficou idêntico por N dias ou mais. Em uma janela móvel de 30 dias, total idêntico
//    significa que nada entrou (nem saiu) nesse período.
//
// A fila de WhatsApp oficial só entra se a exportação trouxer uma coluna sobre isso; caso contrário
// fica como "não verificada".

import { readFile, readdir, rename, mkdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { IMPORTAR } from './caminhos.js';
import { ler, gravar } from './armazenamento.js';

export const PASTA_IMPORTAR = IMPORTAR;
const DIAS_GUARDADOS = 60;
const QUEDA_MINIMA = 0.3;
const QUEDA_BASE_MINIMA = 100;
const DIA_MS = 24 * 3600 * 1000;

const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();
export const chaveDia = (d = new Date()) => new Date(d).toLocaleDateString('sv-SE');
const diasEntre = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / DIA_MS);

// "R$ 1.231,60" -> 1231.6 ; 231.6 -> 231.6 ; "" -> 0
export function moedaBR(v) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').replace(/[^\d,.-]/g, '');
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) ? n : 0;
}

// "4.196" -> 4196 ; 4196 -> 4196 ; "" -> 0
export function numeroBR(v) {
  if (typeof v === 'number') return v;
  const n = Number(String(v ?? '').replace(/\./g, '').replace(/[^\d-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

const simNao = (v) => {
  const s = normalizar(v);
  if (['sim', 's', 'true', '1', 'yes'].includes(s)) return true;
  if (['nao', 'n', 'false', '0', 'no', ''].includes(s)) return false;
  return null;
};

// Qual coluna diz se o cliente tem fila de WhatsApp oficial. O painel de instâncias tem (no Seletor de Colunas)
// "Filas WA Oficiais" e "Filas oficiais ativas"; usamos a primeira, e a segunda só se faltar. "Filas WA" sozinha
// (todas as filas de WhatsApp, oficiais ou não) NÃO serve. Aceita também uma coluna simples "Fila WA Oficial: Sim/Não".
function colunaFilaOficial(cab) {
  const por = (teste) => cab.findIndex(teste);
  const i = por((x) => x === 'filas wa oficiais')
    ?? -1;
  if (i >= 0) return i;
  const alternativas = [
    (x) => x.startsWith('filas wa oficia'),
    (x) => x.includes('fila') && x.includes('wa') && x.includes('oficial'),
    (x) => x === 'filas oficiais ativas',
    (x) => x.includes('fila') && x.includes('oficial') && !x.includes('nao'),
  ];
  for (const teste of alternativas) {
    const k = por(teste);
    if (k >= 0) return k;
  }
  return -1;
}

// Célula da coluna de fila -> tem fila oficial? Número > 0, "Sim", ou uma lista com nomes de fila contam como sim;
// vazio, 0 e "Não" contam como não.
export function temFila(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'number') return v > 0;
  const s = normalizar(v);
  if (['', '0', 'nao', 'n', 'false', 'no', '-', 'nenhuma'].includes(s)) return false;
  if (/^\d+$/.test(s)) return Number(s) > 0;
  return true;
}

// Matriz (linhas x colunas, como vem da planilha) -> lista de clientes.
export function normalizarLinhas(matriz) {
  const iCab = matriz.findIndex((l) => l.some((c) => normalizar(c).startsWith('msgs oficiais')));
  if (iCab < 0) throw new Error('Planilha sem a coluna "Msgs oficiais (30 dias)": exporte pelo painel de instâncias');
  const cab = matriz[iCab].map(normalizar);
  const col = (...nomes) => cab.findIndex((c) => nomes.some((n) => c === n || c.startsWith(n)));
  const c = {
    id: col('id'), instancia: col('instancia'), documento: col('documento'), plano: col('plano'),
    msgs: col('msgs oficiais'), custo: col('custo mensal'), bloq: col('bloq'), servico: col('servico'), assinatura: col('assinatura'),
    fila: colunaFilaOficial(cab),
  };
  if (c.instancia < 0 && c.id < 0) throw new Error('Planilha sem a coluna "Instância" ou "ID"');

  return matriz.slice(iCab + 1)
    .filter((l) => l.some((x) => x !== null && x !== ''))
    .map((l) => ({
      id: String(l[c.id] ?? l[c.instancia]),
      instancia: String(l[c.instancia] ?? ''),
      documento: String(l[c.documento] ?? ''),
      plano: String(l[c.plano] ?? ''),
      msgs30: numeroBR(l[c.msgs]),
      custo: c.custo >= 0 ? moedaBR(l[c.custo]) : 0, // custo mensal médio do cliente (base do "MRR em risco")
      // O painel escreve "Bloqueada" / "Desbloqueada" (atenção: "desbloqueada" NÃO é bloqueada).
      bloqueado: c.bloq >= 0 && /^(bloquead[ao]|sim|s|true|1)$/.test(normalizar(l[c.bloq])),
      assinatura: c.assinatura >= 0 ? String(l[c.assinatura] ?? '').trim() : null,
      online: c.servico >= 0 ? normalizar(l[c.servico]) === 'online' : null,
      filaOficial: c.fila >= 0 ? temFila(l[c.fila]) : null,
    }));
}

// CSV simples (aspas duplas, ; ou , como separador).
export function lerCsv(texto) {
  const t = texto.replace(/^﻿/, '');
  const sep = (t.split('\n')[0].match(/;/g)?.length ?? 0) >= (t.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const linhas = []; let campo = '', linha = [], aspas = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (aspas) {
      if (ch === '"' && t[i + 1] === '"') { campo += '"'; i++; } else if (ch === '"') aspas = false; else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === sep) { linha.push(campo); campo = ''; }
    else if (ch === '\n') { linha.push(campo.replace(/\r$/, '')); linhas.push(linha); linha = []; campo = ''; }
    else campo += ch;
  }
  if (campo || linha.length) { linha.push(campo.replace(/\r$/, '')); linhas.push(linha); }
  return linhas;
}

// ----- histórico (puro) -----
// Estado guardado: { dias: [AAAA-MM-DD, ...], ultimoDia, clientes: { id: { ...dados do cliente, desde } } }
// `desde` é o primeiro dia em que o total de 30 dias ficou com o valor atual. Isso basta para saber há
// quantos dias o cliente está parado, sem guardar uma foto completa de cada dia (cabe em um Redis pequeno).
export function registrar(historico, clientes, dia) {
  const base = historico?.clientes ? historico : { dias: [], ultimoDia: null, clientes: {} };
  if (base.ultimoDia && dia < base.ultimoDia) return base; // planilha mais antiga que a última: já está refletida
  const novos = {};
  for (const c of clientes) {
    const anterior = base.clientes[c.id];
    const mudou = anterior && anterior.msgs30 !== c.msgs30;
    novos[c.id] = {
      ...c,
      desde: anterior && !mudou ? anterior.desde : dia,
      // valor da exportação anterior (só muda quando o total muda): serve para medir queda de uso
      msgs30Anterior: mudou ? anterior.msgs30 : anterior?.msgs30Anterior ?? null,
      anteriorEm: mudou ? base.ultimoDia : anterior?.anteriorEm ?? null,
    };
  }
  const dias = [...new Set([...base.dias, dia])].sort().slice(-DIAS_GUARDADOS);
  return { dias, ultimoDia: dia, clientes: novos };
}

// Formato antigo (uma foto completa por dia) -> formato atual, reaplicando os dias em ordem.
export function migrar(historico) {
  if (!historico?.fotos) return historico;
  let atual = null;
  for (const dia of Object.keys(historico.fotos).sort()) atual = registrar(atual, Object.values(historico.fotos[dia]), dia);
  return atual ?? { dias: [], ultimoDia: null, clientes: {} };
}

// Quais clientes estão sem movimento há `dias` dias ou mais, olhando o último dia importado.
export function analisar(historico, { dias = 3, soOnline = true } = {}) {
  if (!historico?.ultimoDia) return { vazio: true, semMovimento: [], total: 0, ultimoDia: null, diasDeHistorico: 0, limiteDias: dias };
  // Só clientes que ainda contam: não bloqueados, com assinatura viva (cancelada não gera alerta) e, por padrão, online.
  const ativos = Object.values(historico.clientes).filter(
    (x) => !x.bloqueado && normalizar(x.assinatura) !== 'cancelada' && (!soOnline || x.online !== false),
  );
  // Mensagem oficial só existe para quem tem fila de WhatsApp oficial: sem fila, zero é esperado e não é alerta.
  // Se a planilha não trouxe a coluna de filas, não dá para saber: conta todos e avisa (semInfoFila).
  const comInfoFila = ativos.some((x) => x.filaOficial !== null && x.filaOficial !== undefined);
  const elegiveis = comInfoFila ? ativos.filter((x) => x.filaOficial === true) : ativos;

  const semMovimento = [];
  for (const x of elegiveis) {
    const diasParado = diasEntre(x.desde, historico.ultimoDia);
    if (x.msgs30 === 0) semMovimento.push({ ...x, motivo: 'zerado', diasParado: Math.max(diasParado, 30) });
    else if (diasParado >= dias) semMovimento.push({ ...x, motivo: 'parado', diasParado, desde: x.desde });
  }
  // Zerados primeiro (mais grave), depois os parados há mais tempo.
  semMovimento.sort((a, b) => (a.motivo === b.motivo ? b.diasParado - a.diasParado : a.motivo === 'zerado' ? -1 : 1));
  // Queda de uso: o total de 30 dias caiu 30% ou mais desde a exportação anterior (com base mínima, para não alarmar à toa).
  const quedas = elegiveis
    .filter((x) => x.msgs30Anterior >= QUEDA_BASE_MINIMA && x.msgs30 > 0 && x.msgs30 <= x.msgs30Anterior * (1 - QUEDA_MINIMA))
    .map((x) => ({ ...x, queda: 1 - x.msgs30 / x.msgs30Anterior }))
    .sort((a, b) => b.queda - a.queda);
  const vivos = Object.values(historico.clientes).filter((x) => !x.bloqueado && normalizar(x.assinatura) !== 'cancelada');
  const base = {
    ativos: vivos.filter((x) => normalizar(x.assinatura) === 'ativa').length,
    emTeste: vivos.filter((x) => normalizar(x.assinatura) === 'trial').length,
    emCancelamento: vivos.filter((x) => normalizar(x.assinatura).includes('cancelamento')).length,
  };

  return {
    vazio: false, semMovimento, total: elegiveis.length,
    mrrEmRisco: semMovimento.reduce((s, x) => s + (x.custo || 0), 0), // soma do custo mensal de quem está sem movimento
    quedas, base, ultimoDia: historico.ultimoDia, diasDeHistorico: historico.dias.length, limiteDias: dias,
    semInfoFila: !comInfoFila, // true = planilha sem a coluna de filas oficiais: o filtro não pôde ser aplicado
    ignoradosSemFila: comInfoFila ? ativos.length - elegiveis.length : 0,
  };
}

// ----- armazenamento e importação -----
export async function carregarHistorico() {
  return migrar(await ler('instancias')) ?? { dias: [], ultimoDia: null, clientes: {} };
}

// Lê uma planilha já na memória (.xlsx ou .csv) e devolve a lista de clientes.
export async function lerPlanilha(nome, buffer) {
  const ext = extname(nome).toLowerCase();
  if (ext === '.xlsx') {
    const { readSheet } = await import('read-excel-file/node');
    return normalizarLinhas(await readSheet(buffer));
  }
  if (ext === '.csv') return normalizarLinhas(lerCsv(buffer.toString('utf8')));
  throw new Error(`formato não suportado: ${ext}`);
}

// Registra uma planilha no histórico. O dia vem de uma data AAAA-MM-DD no nome do arquivo, senão é `dia`.
export async function importarPlanilha(nome, buffer, dia = chaveDia()) {
  const clientes = await lerPlanilha(nome, buffer);
  const historico = registrar(await carregarHistorico(), clientes, nome.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? dia);
  await gravar('instancias', historico);
  return historico;
}

// Uso local: importa tudo o que estiver em `importar/` (mais antigos primeiro) e move para `importar/processados/`.
// Na nuvem a pasta não existe: a planilha chega pelo botão de envio do painel (importarPlanilha).
export async function importarPasta() {
  let nomes;
  try {
    nomes = (await readdir(PASTA_IMPORTAR)).filter((n) => ['.xlsx', '.csv'].includes(extname(n).toLowerCase()) && !n.startsWith('~$'));
  } catch {
    return { importados: 0, erros: [] }; // pasta inexistente (ex.: ambiente sem disco): nada a importar
  }
  if (!nomes.length) return { importados: 0, erros: [] };
  await mkdir(join(PASTA_IMPORTAR, 'processados'), { recursive: true });

  const comData = await Promise.all(nomes.map(async (n) => ({ n, m: (await stat(join(PASTA_IMPORTAR, n))).mtime })));
  comData.sort((a, b) => a.m - b.m);

  let importados = 0;
  const erros = [];
  for (const { n, m } of comData) {
    const caminho = join(PASTA_IMPORTAR, n);
    try {
      await importarPlanilha(n, await readFile(caminho), chaveDia(m));
      await rename(caminho, join(PASTA_IMPORTAR, 'processados', `${Date.now()}-${n}`));
      importados++;
    } catch (e) {
      erros.push(`${n}: ${e.message}`); // fica na pasta para você ver e corrigir
    }
  }
  return { importados, erros };
}
