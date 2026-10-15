// Servidor "sempre ligado": computador do escritório ou hospedagem com processo contínuo (Render, VPS...).
// Na Vercel quem responde é api/index.js, com o mesmo `tratar`.
import { createServer } from 'node:http';
import { tratar, auth } from './app.js';
import { atualizar, intervaloMs } from './motor.js';

const env = process.env;
const porta = Number(env.PORT ?? 3000);
// Só a própria máquina acessa por padrão. Na nuvem use HOST=0.0.0.0, e então a senha é obrigatória.
const host = env.HOST ?? '127.0.0.1';
if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !auth.exigida) {
  console.error('Recusando iniciar aberto para a rede: defina EVO_SENHA (a senha da equipe) ou use HOST=127.0.0.1.');
  process.exit(1);
}

await atualizar();
createServer(tratar).listen(porta, host, () => console.log(`Evo em http://${host}:${porta}${auth.exigida ? ' (com senha)' : ''}`));
// Mantém avisos do Teams e histórico andando mesmo com o painel fechado.
setInterval(atualizar, intervaloMs());
