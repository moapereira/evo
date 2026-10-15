// Dados de exemplo, sempre relativos ao momento atual.
const h = (horas) => new Date(Date.now() - horas * 3600 * 1000).toISOString();
// Hoje, na hora indicada (sem passar do momento atual).
const hoje = (hora) => {
  const d = new Date();
  d.setHours(hora, 15, 0, 0);
  return new Date(Math.min(d.getTime(), Date.now() - 60_000)).toISOString();
};

export async function vendas() {
  return [
    { id: 'V-501', cliente: 'Clínica Sorriso', valor: 3200, vendedor: 'Bianca', fechadoEm: hoje(8) },
    { id: 'V-502', cliente: 'Mercado Bom Preço', valor: 1890, vendedor: 'Diego', fechadoEm: hoje(9) },
    { id: 'V-503', cliente: 'Auto Elétrica Reis', valor: 2450, vendedor: 'Bianca', fechadoEm: hoje(9) },
    { id: 'V-504', cliente: 'Studio Fit', valor: 980, vendedor: 'Lucas', fechadoEm: hoje(10) },
    { id: 'V-505', cliente: 'Pet Shop Amigo', valor: 1500, vendedor: 'Diego', fechadoEm: hoje(11) },
    { id: 'V-480', cliente: 'Loja de Ontem', valor: 5000, vendedor: 'Lucas', fechadoEm: h(30) },
  ];
}

export async function tickets() {
  return [
    { id: 'S-1042', cliente: 'Clínica Vida', assunto: 'Sistema fora do ar', status: 'aberto', abertoEm: h(31), atendente: 'Paulo' },
    { id: 'S-1051', cliente: 'Padaria Central', assunto: 'Erro ao imprimir', status: 'em atendimento', abertoEm: h(26), atendente: 'Ana' },
    { id: 'S-1060', cliente: 'Auto Peças Silva', assunto: 'Dúvida de relatório', status: 'aberto', abertoEm: h(5), atendente: 'Paulo' },
    { id: 'S-1062', cliente: 'Escola Aprender', assunto: 'Trocar senha', status: 'aberto', abertoEm: h(2), atendente: 'Ana' },
    { id: 'S-1033', cliente: 'Mercado Bom Preço', assunto: 'Acesso negado', status: 'resolvido', abertoEm: h(60), atendente: 'Ana' },
  ];
}

export async function funil() {
  return [
    { id: 'N-201', cliente: 'Clínica Vida', etapa: 'Treinamento', etapaDesde: h(53), responsavel: 'Carla', concluido: false },
    { id: 'N-207', cliente: 'Drogaria Norte', etapa: 'Migração de dados', etapaDesde: h(20), responsavel: 'Rafael', concluido: false },
    { id: 'N-213', cliente: 'Escola Aprender', etapa: 'Configuração', etapaDesde: h(49), responsavel: 'Carla', concluido: false },
    { id: 'N-218', cliente: 'Clínica Sorriso', etapa: 'Configuração', etapaDesde: h(10), responsavel: 'Rafael', concluido: false },
    { id: 'N-220', cliente: 'Studio Fit', etapa: 'Contrato', etapaDesde: h(4), responsavel: 'Carla', concluido: false },
    { id: 'N-221', cliente: 'Pet Shop Amigo', etapa: 'Contrato', etapaDesde: h(1), responsavel: 'Rafael', concluido: false },
    { id: 'N-190', cliente: 'Padaria Central', etapa: 'Concluído', etapaDesde: h(200), responsavel: 'Rafael', concluido: true },
  ];
}

// Reuniões de hoje (exemplo): algumas já terminaram, outras ainda vão acontecer.
export async function reunioes() {
  const h = (hora, min = 0) => { const d = new Date(); d.setHours(hora, min, 0, 0); return d; };
  const agora = Date.now();
  const lista = [
    [9, 'Apresentação CRM', ['Nicole Assis']], [10, 'Demo Atender Bem', ['Daniel Miguel']], [10, 'Alinhamento comercial', ['Ityara Oliveira', 'Nicole Assis']],
    [11, 'Proposta farmácia', ['Camilla Caldeira']], [14, 'Reunião de fechamento', ['Hugo Henrique Belini']], [15, 'Demo CRM', ['Daniel Miguel']], [16, 'Apresentação', ['Ityara Oliveira']],
  ].map(([hora, assunto, pessoas]) => ({ id: assunto + hora, assunto, pessoas, inicio: h(hora).toISOString(), fim: h(hora, 45).toISOString(), realizada: h(hora, 45).getTime() <= agora }));
  lista.pessoas = ['Ityara Oliveira', 'Nicole Assis', 'Camilla Caldeira', 'Daniel Miguel', 'Hugo Henrique Belini'];
  return lista;
}

export async function negocio() {
  const d = (dias) => new Date(Date.now() - dias * 24 * 3600 * 1000).toISOString();
  return {
    financeiro: {
      valor: 5613, quantidade: 3, maisAntigoDias: 9,
      itens: [
        { id: 'COM-101', cliente: 'Drogaria Central', tipo: 'novo', setup: 1500, recorrencia: 993, valor: 2493, dias: 9 },
        { id: 'COM-102', cliente: 'Farmácia Vida', tipo: 'upsell', setup: 0, recorrencia: 620, valor: 620, dias: 4 },
        { id: 'COM-103', cliente: 'Rede Saúde', tipo: 'novo', setup: 1500, recorrencia: 1000, valor: 2500, dias: 1 },
      ],
    },
    pipeline: {
      valor: 28400, quantidade: 14, limiteDias: 30, valorAntigos: 10200,
      etapas: [{ etapa: 'Conexão', quantidade: 5, valor: 4000 }, { etapa: 'Reunião Agendada', quantidade: 4, valor: 9000 }, { etapa: 'Proposta', quantidade: 5, valor: 15400 }],
      antigos: [
        { id: 'l1', empresa: 'Drogaria Norte', etapa: 'Proposta', valor: 6200, dias: 61 },
        { id: 'l2', empresa: 'Rede Bem Estar', etapa: 'Conexão', valor: 900, dias: 44 },
        { id: 'l3', empresa: 'Farma Sul', etapa: 'Reunião Agendada', valor: 3100, dias: 33 },
      ],
    },
  };
}
