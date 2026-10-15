# Evo

Painel interno do escritório, feito para ficar num monitor (tela única, horizontal, sem rolagem).
Endereço publicado: https://evo-ebon.vercel.app (a senha da equipe fica na variável `EVO_SENHA`; não a escreva em arquivos).

## O que o painel mostra

| Cartão | O que é | Fonte |
|---|---|---|
| **Anel + "Reuniões por hora"** | Reuniões do comercial hoje, meta de **10 realizadas por dia**; barras por hora | Agenda do Teams (Microsoft 365) |
| **Vendas fechadas hoje** | Lista de vendas com valor e consultora; "Fechado hoje: R$" no topo | Nexu |
| **Suporte** | Atendimentos abertos há mais de 24 h | Atender Bem |
| **Funil de implantação** | Clientes parados há mais de 48 h, por etapa | Nexu (ainda com aviso, veja *Limitações*) |
| **Sem msgs oficiais** | Clientes **com fila WA oficial** sem mensagem oficial (zerado em 30 dias, ou parado há 3+ dias) | Planilha do painel de parceiros |
| **Missões / ❤️ / nível / 🔥** | Gamificação (abaixo) | Calculada |
| **Mascote** | Muda de expressão conforme o que diz (feliz, animado, preocupado, triste, pensativo) | — |
| **Chat** | Pergunte por texto ou voz; com `ANTHROPIC_API_KEY` entende perguntas livres | — |

**Clique em qualquer cartão** para abrir o pop-up com a lista completa (busca e ordenação por coluna). Tecle **F** (ou clique no
logo) para tela cheia. O painel consulta o servidor a cada 15 s, e o servidor recalcula a cada 30 s.

## Segunda tela (negócio) e rotação

No modo monitor o painel **alterna sozinho a cada 20 s** entre a tela principal e a tela de **negócio**; as bolinhas no topo mostram onde
está e dá para clicar nelas ou usar as setas ← →. A rotação **pausa** com pop-up aberto, com o mouse mexendo (8 s), digitando no chat ou
com a voz falando. `?fixa` na URL trava a tela atual e `?tela=2` abre direto na de negócio.

| Cartão da tela de negócio | Como é calculado |
|---|---|
| **Travado no financeiro** | Soma setup + recorrência dos tickets em "pendente financeiro" (Nexu). A idade conta desde a criação do ticket |
| **Pipeline em aberto** | Soma dos leads em etapas vivas (fora Ganho, Perdido, Congelado e No Show), por etapa |
| **Leads abertos há muito tempo** | Leads vivos criados há mais de 30 dias (`LIMITE_LEAD_ANTIGO_DIAS`). Não dá para medir "parado" pela última atualização: o Nexu atualiza todos os leads toda semana |
| **MRR em risco** | Soma do "Custo Mensal Médio" dos clientes com fila WA oficial e sem mensagens (planilha de instâncias) |
| **Base de clientes** | Ativos, em teste e em cancelamento; e clientes em **queda de uso** (mensagens oficiais caíram 30% ou mais desde a exportação anterior, base mínima de 100; aparece a partir da 2ª exportação) |

Fonte do Nexu: `SOURCE_NEGOCIO=real`.

## Corações, nível e sequência

- Missões do dia: **atendimentos em dia**, **implantações andando** e **meta de reuniões**. Missão cuja fonte está fora do ar fica
  de fora (não pune nem premia).
- Bateu as metas do dia → **ganha 1 ❤️ na hora** (e fica garantido mesmo que um atraso apareça depois).
- A cada **5 corações sobe 1 nível**. O nível vem do total de corações, então perder coração pode baixá-lo.
- Não bateu: o **1º dia útil é tolerado**; a partir do **2º dia seguido** perde 1 ❤️ por dia (nunca abaixo de 0).
- Sábado e domingo não contam. Dia sem avaliação (Evo desligado ou fontes fora do ar) não conta.
- 🔥 sequência = dias úteis seguidos batendo as metas.

## Como rodar no computador

Requisito: Node.js 20 ou mais novo.

```bash
npm install
cp .env.example .env     # preencha as chaves
npm start                # http://127.0.0.1:3000
```

Só o próprio computador acessa. Para a rede, use `HOST=0.0.0.0` (o Evo **se recusa a iniciar sem `EVO_SENHA`** nesse caso).

## Publicado na Vercel (como está hoje)

- Projeto `evo`, equipe **Programação**, região São Paulo. Banco **Redis (Upstash)** `evo-dados` guarda histórico, corações,
  planilhas e avisos já enviados (na Vercel não há disco nem processo sempre ligado).
- Republicar: `vercel deploy --prod --scope programacao-6af68abc`. Variáveis: Settings > Environment Variables (chaves como *sensíveis*).
- Sem `EVO_SENHA` a Vercel responde 503. Erros de senha repetidos bloqueiam por 10 min.
- **Avisos do Teams só saem enquanto o painel está aberto** (não há agendador na Vercel; o monitor ligado resolve na prática).
- Planilhas enviadas pelo botão ⬆ têm limite de 4 MB.
- O plano gratuito (Hobby) da Vercel é só para uso pessoal/não comercial: confirme que a equipe está no plano Pro.
- Alternativa: Render (`render.yaml`) ou o computador do escritório; o mesmo código roda nos três.

## Configuração (variáveis)

| Variável | Para quê |
|---|---|
| `EVO_SENHA` | Senha única da equipe (obrigatória na nuvem). `EVO_SEGREDO` opcional (assina o cookie) |
| `NEXU_TOKEN`, `NEXU_BASE_URL` | Chave da API do Nexu (Configurações > Credenciais) |
| `NEXU_FUNIS`, `NEXU_FUNIL_IGNORAR`, `NEXU_ETAPAS_GANHO` | Kanbans lidos, colunas ignoradas (hoje Berçario e Configuração Serviços Extra), etapa que vale como venda |
| `ATENDERBEM_TOKEN`, `ATENDERBEM_BASE_URL`, `ATENDERBEM_FILAS` | API do Atender Bem e ids das filas de suporte (hoje 254) |
| `TEAMS_WEBHOOK_URL` | Webhook do canal do Teams (sem ele os alertas aparecem só no painel) |
| `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` | App do Microsoft 365 para ler as agendas (veja abaixo) |
| `META_REUNIOES_DIA`, `REUNIOES_PESSOAS`, `REUNIOES_SO_TEAMS` | Meta (10), pessoas contadas e se conta só reunião do Teams |
| `LIMITE_SUPORTE_HORAS`, `LIMITE_FUNIL_HORAS`, `LIMITE_INSTANCIAS_DIAS` | Limites dos alertas (24, 48, 3) |
| `VENDEDORES_ALIAS` | Nomes que são a mesma pessoa: `Nicole=Nicole Assis, ...` |
| `VENDEDOR_POR_CLIENTE` | Vendas sem vendedor no Nexu: `Cliente=Vendedor; Outro=Outra` |
| `VENDAS_IGNORAR` | Vendas antigas que aparecem "editadas hoje": nomes ou ids separados por `;` |
| `SOURCE_VENDAS`, `SOURCE_SUPORTE`, `SOURCE_FUNIL`, `SOURCE_REUNIOES` | `real` ou `mock` (dados de exemplo) |
| `POLL_SEGUNDOS`, `NEXU_CACHE_SEGUNDOS` | Intervalo de atualização (30) e cache das consultas ao Nexu (60) |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Redis (a Vercel preenche sozinha ao conectar o Upstash) |
| `DADOS_DIR`, `IMPORTAR_DIR`, `EVO_FUSO`, `HOST`, `PORT` | Pastas de dados, fuso (padrão America/Sao_Paulo) e rede |
| `ANTHROPIC_API_KEY` | Opcional: chat com o Claude |

Nunca envie o `.env` por e-mail ou chat: ele contém as chaves. As que já circularam em conversa devem ser trocadas.

## Avisos no Teams

Fluxo **"Evo - alertas"** criado em *Único Contato › Geral* (Fluxos de trabalho > "Enviar alertas de webhook para um canal").
Copie o link do webhook dele e coloque em `TEAMS_WEBHOOK_URL`. O primeiro envio é um resumo (até 8 alertas); depois só o que for novo.
Vendas fechadas, atendimentos atrasados, implantações paradas e clientes sem mensagens oficiais geram avisos (cada um uma vez).

## Reuniões do comercial (Microsoft 365)

Conta Ityara, Nicole, Camilla, Daniel e Hugo Henrique Belini. Lê a agenda do Teams de cada um: só reunião **online**, uma vez
mesmo que esteja em duas agendas, ignorando cancelada, recusada e "dia inteiro". **Realizada** = já terminou (só ela conta para a
meta e para o coração); as que ainda vão acontecer aparecem como "a seguir". O e-mail de cada pessoa vem do Nexu.

**Configuração (uma vez, por um administrador do Microsoft 365):**
1. Entra ID > Registros de aplicativo > **Novo registro** ("Evo"). Anote o *ID do locatário* e o *ID do aplicativo (cliente)*.
2. Permissões de API > Microsoft Graph > **Permissões de aplicativo** > `Calendars.Read` > **Conceder consentimento do administrador**.
3. Certificados e segredos > **Novo segredo do cliente**: copie o *valor* na hora.
4. **Restrinja o app às 5 caixas** (recomendado): `Calendars.Read` de aplicativo, sozinha, dá acesso à agenda de TODOS. No Exchange Online
   PowerShell, crie um grupo de segurança habilitado para e-mail só com as 5 pessoas e rode
   `New-ApplicationAccessPolicy -AppId <ID do cliente> -PolicyScopeGroupId <e-mail do grupo> -AccessRight RestrictAccess -Description "Evo"`
   (confira com `Test-ApplicationAccessPolicy`; leva até 1 h para valer).
5. Preencha `MS_TENANT_ID`, `MS_CLIENT_ID` e `MS_CLIENT_SECRET` e republique.

Sem isso o anel mostra "sem dados" e a missão de reuniões fica fora do cálculo.

## Clientes sem mensagens oficiais

O painel de parceiros do Atender Bem só mostra o total de 30 dias. Para o Evo montar histórico:
1. No painel de instâncias, **Seletor de Colunas**: marque **Filas WA Oficiais** (sem ela o Evo não sabe quem tem fila oficial e conta todos).
2. **Exportar todos os dados** (.xlsx) e envie pelo botão **⬆** do cartão (no computador, também dá para soltar o arquivo em `importar/`).

Só contam clientes **não bloqueados, com assinatura viva (não cancelada), online e com fila WA oficial**. "Zerado" = 0 mensagens em 30
dias. "Parado" = total igual por 3+ dias (precisa de exportações em dias diferentes). Cada nova planilha substitui a anterior.

## Vendas de hoje (paliativo)

A API pública do Nexu não informa a data real do ganho nem o vendedor. Enquanto isso o Evo: (1) **congela** a data da primeira vez que
viu cada lead em "Ganho" (editar depois não o move para hoje); (2) soma upsells que não passam por lead (tickets `COM-…` criados hoje e
já aprovados); (3) aceita `VENDAS_IGNORAR` para o que já estava "editado hoje" na primeira execução. Hoje o total bate com o
"Total aprovado" do Dashboard do Nexu. A consultora vem do campo `consultant` das notas do lead, de `VENDEDOR_POR_CLIENTE` e de `VENDEDORES_ALIAS`.

## Limitações conhecidas (API pública do Nexu)

- **Funil de implantação:** a API não informa a coluna do kanban. O painel mostra aviso até o Nexu expor `columnName`, `funnelName` e
  `columnEnteredAt` em `GET /tickets/implantacao`.
- **Vendas:** quando a API expuser `wonAt` e `seller`, o Evo passa a usá-los e o paliativo deixa de ser necessário.
- **Reuniões:** o Nexu só conta quem conectou o Teams lá; por isso o Evo lê a agenda direto do Microsoft 365.

## Pendências

Webhook do Teams (URL), app do Microsoft 365 (administrador), coluna do kanban no Nexu, plano da Vercel e troca das chaves que
passaram por conversa.

## Para quem for mexer no código

- `src/motor.js` busca as fontes e monta o estado; `src/app.js` são as rotas; `src/server.js` (computador/Render) e `api/index.js` (Vercel) as exercitam.
- Conectores em `src/connectors/` (`nexu`, `atenderbem`, `reunioes`, `mock`); regras puras em `src/rules.js`, `vendas.js`, `instancias.js`, `gamificacao.js`.
- Armazenamento em `src/armazenamento.js` (arquivo local ou Redis). Interface em `web/index.html` (arquivo único).

```bash
npm test     # 54 testes
```
