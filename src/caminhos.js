// Onde o Evo guarda o que precisa sobreviver a reinícios (histórico, avisos já enviados, planilhas).
// Na nuvem, aponte DADOS_DIR (e IMPORTAR_DIR) para um disco persistente; senão tudo se perde a cada deploy.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));

export const DADOS = process.env.DADOS_DIR || join(RAIZ, 'dados');
export const IMPORTAR = process.env.IMPORTAR_DIR || join(RAIZ, 'importar');

export const ARQUIVOS = {
  historico: join(DADOS, 'historico.json'),
  avisados: join(DADOS, 'avisados.json'),
  instancias: join(DADOS, 'instancias.json'),
};
// Locais antigos (versões anteriores guardavam na raiz do projeto): só leitura, para não perder histórico.
export const LEGADO = {
  historico: join(RAIZ, '.historico.json'),
  avisados: join(RAIZ, '.avisados.json'),
};
