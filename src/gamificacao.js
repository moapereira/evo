// Corações, nível, sequência e missões. Funções puras sobre o histórico diário:
//   historico = { 'AAAA-MM-DD': { vendas, atrasosMax, bateu, avaliado } }
//
// Regras:
//  - Bateu as metas do dia (todas as missões que dá para avaliar)  -> ganha 1 coração, na hora.
//  - A cada 5 corações sobe 1 nível (nível = 1 + corações / 5; os 5 corações do cabeçalho mostram o progresso).
//  - Dia útil avaliado em que NÃO bateu: o primeiro é tolerado; a partir do 2º dia seguido sem bater, perde
//    1 coração por dia (nunca abaixo de zero). Bater a meta zera a contagem de dias seguidos sem bater.
//  - Sábado e domingo não contam. Dia sem avaliação (Evo desligado ou fontes fora do ar) não conta.

export const CORACOES_POR_NIVEL = 5;
export const FALTAS_TOLERADAS = 1;

export const chaveDia = (d = new Date()) => new Date(d).toLocaleDateString('sv-SE');

const fimDeSemana = (dia) => {
  const d = new Date(`${dia}T12:00:00`).getDay();
  return d === 0 || d === 6;
};

export function calcularJogo(historico, agora = new Date()) {
  const hoje = chaveDia(agora);
  const dias = Object.keys(historico)
    .filter((d) => historico[d]?.avaliado === true && !fimDeSemana(d) && d <= hoje)
    .sort();

  let coracoes = 0;
  let faltas = 0; // dias úteis seguidos sem bater, antes de hoje
  let sequencia = 0; // dias úteis seguidos batendo as metas
  for (const dia of dias) {
    if (historico[dia].bateu) {
      coracoes++;
      faltas = 0;
      sequencia++;
    } else if (dia < hoje) {
      faltas++;
      sequencia = 0;
      if (faltas > FALTAS_TOLERADAS) coracoes = Math.max(0, coracoes - 1);
    } // hoje ainda sem bater: ainda dá tempo, nada muda
  }

  const ganhouHoje = historico[hoje]?.bateu === true;
  return {
    coracoes,
    nivel: 1 + Math.floor(coracoes / CORACOES_POR_NIVEL),
    noNivel: coracoes % CORACOES_POR_NIVEL,
    porNivel: CORACOES_POR_NIVEL,
    sequencia,
    faltasSeguidas: faltas,
    ganhouHoje,
    // Se hoje não bater, perde coração? (já houve falta suficiente antes de hoje)
    emRisco: !ganhouHoje && faltas >= FALTAS_TOLERADAS,
  };
}

export function missoes({ abertos, atrasadosSuporte, ativosFunil, paradosFunil, reunioes, metaReunioes }) {
  const emDiaSuporte = abertos - atrasadosSuporte;
  const emDiaFunil = ativosFunil - paradosFunil;
  return [
    { id: 'suporte', icone: '🎧', titulo: 'Atendimentos em dia', atual: emDiaSuporte, alvo: abertos, feito: atrasadosSuporte === 0 },
    { id: 'funil', icone: '🚀', titulo: 'Implantações andando', atual: emDiaFunil, alvo: ativosFunil, feito: paradosFunil === 0 },
    // Conta só reunião já realizada (terminou): agendada para a tarde não vale coração de manhã.
    { id: 'reunioes', icone: '📅', titulo: 'Meta de reuniões do dia', atual: Math.min(reunioes, metaReunioes), alvo: metaReunioes, feito: reunioes >= metaReunioes },
  ];
}

// Decide se as metas do dia foram batidas neste instante. Missão cuja fonte de dados está fora do ar
// não pode ser julgada e fica de fora; se nenhuma puder ser julgada, o dia não é avaliado.
export function julgarDia(listaMissoes, fontesOk) {
  const julgaveis = listaMissoes.filter((m) => fontesOk[m.id]);
  return { avaliado: julgaveis.length > 0, bateu: julgaveis.length > 0 && julgaveis.every((m) => m.feito) };
}
