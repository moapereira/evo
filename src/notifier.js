// Avisos no Teams via webhook, sem repetir o mesmo alerta (mesmo com várias instâncias do Evo rodando).
import { reivindicar, liberar } from './armazenamento.js';

// Chaves que este processo já sabe que foram reivindicadas: evita consultar o armazenamento a cada ciclo
// para centenas de alertas que continuam ativos.
const conhecidas = new Set();
let avisouSemWebhook = false;

// itens: [{ chave, texto }]. Envia só os que ainda não foram avisados.
export async function avisarTeams(itens) {
  const candidatos = itens.filter((i) => !conhecidas.has(i.chave));
  if (!candidatos.length) return { enviados: 0 };

  const url = process.env.TEAMS_WEBHOOK_URL;
  if (!url) {
    // Sem webhook nada é reivindicado: quando você configurar, os alertas ainda ativos saem.
    if (!avisouSemWebhook) console.log('[teams] webhook não configurado; alertas aparecem só no painel');
    avisouSemWebhook = true;
    return { enviados: 0 };
  }

  // Reivindica antes de enviar: se duas instâncias rodarem ao mesmo tempo, só uma envia cada aviso.
  const reivindicadas = new Set(await reivindicar('avisados', candidatos.map((c) => c.chave)));
  candidatos.forEach((c) => conhecidas.add(c.chave));
  const novos = candidatos.filter((c) => reivindicadas.has(c.chave));
  if (!novos.length) return { enviados: 0 };

  // Muitos avisos de uma vez (ex.: primeiro ciclo): manda um resumo em vez de uma enxurrada.
  const MAX_DETALHADOS = 8;
  const blocos = novos.slice(0, MAX_DETALHADOS).map((n) => ({ type: 'TextBlock', text: n.texto, wrap: true }));
  if (novos.length > MAX_DETALHADOS) {
    blocos.push({ type: 'TextBlock', text: `…e mais ${novos.length - MAX_DETALHADOS} alertas. Veja todos no painel.`, wrap: true, isSubtle: true });
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'message',
        attachments: [
          {
            contentType: 'application/vnd.microsoft.card.adaptive',
            content: {
              $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
              type: 'AdaptiveCard',
              version: '1.4',
              body: [
                { type: 'TextBlock', text: `Evo: ${novos.length} novo(s) alerta(s)`, weight: 'Bolder', size: 'Medium' },
                ...blocos,
              ],
            },
          },
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Teams respondeu ${res.status}`);
  } catch (e) {
    // Falhou: devolve os avisos para serem tentados de novo no próximo ciclo.
    await liberar('avisados', novos.map((n) => n.chave)).catch(() => {});
    novos.forEach((n) => conhecidas.delete(n.chave));
    throw e;
  }
  return { enviados: novos.length };
}
