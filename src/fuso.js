// "Hoje", "esta hora" e "dia útil" precisam ser os do escritório, não os do servidor (a Vercel roda em UTC,
// o que viraria o dia às 21h de Brasília). Importado antes de qualquer outro módulo que use datas.
process.env.TZ = process.env.EVO_FUSO || 'America/Sao_Paulo';
