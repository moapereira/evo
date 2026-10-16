// Chat: usa o Claude se houver chave; senão responde com um resumo por regras.
const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function resumoLocal(e) {
  const partes = [];
  partes.push(
    e.suporte.atrasados.length
      ? `${e.suporte.atrasados.length} atendimento(s) aberto(s) há mais de ${e.limites.suporte} horas: ` +
          e.suporte.atrasados.map((t) => `${t.cliente} (${Math.floor(t.horas)}h)`).join(', ') + '.'
      : 'Nenhum atendimento atrasado no suporte.',
  );
  partes.push(
    e.funil.parados.length
      ? `${e.funil.parados.length} cliente(s) parado(s) há mais de ${e.limites.funil} horas no funil: ` +
          e.funil.parados.map((n) => `${n.cliente} em ${n.etapa} (${Math.floor(n.horas)}h)`).join(', ') + '.'
      : 'Nenhum cliente parado no funil.',
  );
  partes.push(`Hoje foram ${e.vendas.hoje.length} venda(s), ${brl(e.vendas.valor)}.`);
  partes.push(e.reunioes.semDados
    ? 'Ainda não consegui ler as reuniões do comercial.'
    : `Reuniões do comercial hoje: ${e.reunioes.realizadas} realizada(s) e ${e.reunioes.agendadas} a seguir, para uma meta de ${e.reunioes.meta}.`);
  if (e.negocio && !e.negocio.semDados) {
    partes.push(`${brl(e.negocio.financeiro.valor)} aguardando o financeiro (${e.negocio.financeiro.quantidade} tickets) e ${brl(e.negocio.pipeline.valor)} em pipeline, com ${e.negocio.pipeline.antigos.length} lead(s) aberto(s) há mais de ${e.negocio.pipeline.limiteDias} dias.`);
  }
  if (e.instancias && !e.instancias.vazio) {
    const z = e.instancias.semMovimento.filter((x) => x.motivo === 'zerado').length;
    partes.push(`${e.instancias.semMovimento.length} cliente(s) sem movimento de mensagens oficiais (${z} zerado(s) em 30 dias).`);
  }
  return partes.join(' ');
}

export async function responder(pergunta, estado) {
  const chave = process.env.ANTHROPIC_API_KEY;
  if (!chave) return resumoLocal(estado);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': chave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-5-5',
      max_tokens: 600,
      system:
        'Você é o Evo, assistente interno do escritório Único Contato. Responda em português do Brasil, ' +
        'de forma curta e falada (sem markdown, listas ou emojis), usando APENAS os dados do JSON fornecido. ' +
        'Se a informação não estiver nos dados, diga que não sabe.',
      messages: [{ role: 'user', content: `Dados atuais:\n${JSON.stringify(estado)}\n\nPergunta: ${pergunta}` }],
    }),
  });
  if (!res.ok) return `Não consegui consultar o Claude (erro ${res.status}). ${resumoLocal(estado)}`;
  const j = await res.json();
  return j.content?.map((c) => c.text ?? '').join('') || resumoLocal(estado);
}
 
