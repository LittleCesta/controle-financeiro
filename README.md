# Controle Financeiro

[![CI](https://github.com/LittleCesta/controle-financeiro/actions/workflows/ci.yml/badge.svg)](https://github.com/LittleCesta/controle-financeiro/actions/workflows/ci.yml)

Divisão de gastos entre amigos, com site e bot do Telegram. Registra quem pagou o quê, divide entre quem participou, calcula quanto cada pessoa deve e acompanha os pagamentos até zerar as contas.

Nasceu de um problema real: depois de cada rolê, uma pessoa paga o Uber, outra paga o bar, e a conta de quem deve a quem vira bagunça no grupo de mensagens. Aqui, o gasto é lançado em uma mensagem no Telegram e o site mostra os saldos na hora.

## Demonstração

![Demonstração](docs/demo.gif)

## Funcionalidades

**Contas e grupos**

- Cadastro e login. Cada grupo só é visível para os seus membros.
- **Convite por link:** quem entra escolhe qual pessoa do grupo é (ou cria o próprio nome), e a conta fica ligada a ela.

**Site**

- Grupos com pessoas e **saídas** (um rolê agrupa vários gastos), com filtro por saída e ordenação por data.
- Gastos com divisão igual ou **valores diferentes por pessoa** (quem chegou tarde, quem não bebeu).
- Saldo de cada pessoa e **transferências mínimas** para zerar as contas, com registro do pagamento em um clique (inclusive parcial).
- Edição de gastos e remoção de gastos e pagamentos, com confirmação em modal.
- **Relatório em PDF** com saldos, gastos detalhados e pagamentos.

**Bot do Telegram**

- Lança gastos por mensagem, com data opcional (sem data, vale o dia do envio).
- Consulta de saldos e envio do relatório em PDF.
- Responde só ao dono, em conversa privada, e só enxerga os grupos da conta dele.

## Como o bot recebe um gasto

```
/gasto Uber 60 pagou:Cesar quem:Cesar,Ana,Bia saida:"Sábado Varanda" data:02/11
/gasto Bar 200 pagou:Ana quem:Cesar,Ana,Bia,Davi:20
```

| Campo    | O que faz                                                                     | Padrão                 |
| -------- | ----------------------------------------------------------------------------- | ---------------------- |
| `pagou:` | Quem pagou                                                                    | Nome definido em `/eu` |
| `quem:`  | Participantes. `Davi:20` fixa 20 para o Davi e divide o resto entre os outros | Todo o grupo           |
| `saida:` | Saída do gasto (precisa existir no site). Use aspas se tiver espaço           | Nenhuma                |
| `data:`  | `02/11`, `02/11/2026`, `hoje` ou `ontem`                                      | Dia do envio           |

Outros comandos: `/grupo Nome`, `/eu Nome`, `/saldo`, `/relatorio`, `/ajuda`. Nomes são comparados sem diferenciar acento ou maiúscula; se o nome for ambíguo, o bot responde com as opções em vez de gravar.

## Decisões técnicas

- **Dinheiro em centavos inteiros.** Em ponto flutuante, `0.1 + 0.2 !== 0.3`; com centavos, a soma das partes de um gasto sempre fecha o total. Na divisão por 3, quem sobra paga 1 centavo a mais.
- **O saldo é calculado, não salvo.** O banco guarda os fatos (gastos, partes de cada um, pagamentos) e o saldo sai de `pagou - parte + pagamentos feitos - pagamentos recebidos`. Corrigir um gasto atualiza tudo sem risco de inconsistência, e a soma dos saldos é sempre zero.
- **Quitação com menos transferências.** Cobrar gasto a gasto gera pagamentos cruzados; o saldo líquido reduz isso. Numa noite com um Uber de R$ 60 e um bar de R$ 200, são 3 transferências em vez de 5.
- **Pessoa e conta são coisas diferentes.** Pessoa é quem participa das contas; conta é quem faz login. Os amigos existem como pessoas antes de ter conta, e o convite liga as duas, sem nunca deixar duas contas na mesma pessoa.
- **Uma guarda de acesso só.** Todas as rotas de `/g/:id` ficam sob o mesmo roteador, que exige login e participação no grupo. Rota nova nasce protegida, e quem não é membro recebe "não encontrado", como se o grupo não existisse.
- **Senhas e sessões.** Senha com `scrypt` e sal aleatório; sessão guardada no MongoDB, em cookie `httpOnly` e `sameSite=lax`, com o id renovado a cada login. O destino depois do login só aceita caminhos internos do site (os testes pegaram uma brecha de redirecionamento com barra invertida, já corrigida).
- **Remoção lógica (_soft delete_).** Gastos e pagamentos removidos ganham `deletedAt` e saem das contas, mas continuam no banco.
- **Um serviço único para criar gasto.** O site e o bot usam as mesmas funções (`createExpense`, `updateExpense`, `loadReportData`), então a validação e o relatório nunca divergem entre os dois.

## Estrutura

```
src/
  config/db.ts            conexão e collections do MongoDB
  domain/                 regras de dinheiro, sem banco nem Express
    finance.ts            conversão, divisão, saldos e quitação
  services/               usado pelo site e pelo bot
    expenses.ts           criar e editar gasto
    report.ts             dados e PDF do relatório
  web/
    server.ts             conecta ao banco e sobe o servidor
    app.ts                monta o Express (sessão, rotas, erros)
    auth.ts               senha, sessão e guardas de acesso
    routes/               account, home, invites e group/ (tudo em /g/:id)
  bot/bot.ts              bot do Telegram (processo separado do site)
  scripts/claim-groups.ts atribui grupos antigos a uma conta
views/                    templates EJS
public/css/               estilos
```

Collections: `users`, `groups`, `people`, `outings`, `expenses`, `payments`, `bot_state` e `sessions`.

## Como executar

Pré-requisitos: Node.js 22+, npm e um MongoDB (local via Docker ou o [Atlas](https://www.mongodb.com/atlas)).

```bash
git clone https://github.com/LittleCesta/controle-financeiro.git
cd controle-financeiro
npm install
docker compose up -d      # MongoDB local (pule se usar o Atlas)
```

Crie um arquivo `.env` na raiz (ele está no `.gitignore`):

```
MONGO_URL=mongodb://localhost:27017
PORT=3000
SESSION_SECRET=um_valor_longo_e_aleatorio   # obrigatório em produção

# Bot (opcional)
TELEGRAM_TOKEN=token_gerado_no_BotFather
TELEGRAM_OWNER_ID=seu_id_numerico_do_telegram
BOT_USER_EMAIL=email_da_sua_conta_no_site
```

Para gerar o `SESSION_SECRET`: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

Depois:

```bash
npm run dev     # site em http://localhost:3000
npm run bot     # bot do Telegram (em outro terminal)
```

No primeiro acesso, abra `/cadastro` e crie a sua conta. Ao criar um grupo você vira o dono e já entra como uma das pessoas; para convidar amigos, copie o link na seção **Membros**. Se você já tinha grupos de antes do login existir, atribua-os à sua conta com `npm run claim -- seu@email.com`.

Para o bot: crie o bot com o `@BotFather` (comando `/newbot`) para obter o token, e descubra o seu ID numérico com o `@userinfobot`.

| Script                   | O que faz                          |
| ------------------------ | ---------------------------------- |
| `npm run dev`            | Site com recarga automática        |
| `npm run bot`            | Bot do Telegram                    |
| `npm run claim -- email` | Atribui grupos antigos à sua conta |
| `npm test`               | Testes                             |
| `npm run build`          | Compila para `dist/`               |
| `npm start`              | Roda o site compilado              |

Observação: o `db.ts` define DNS públicos (1.1.1.1 e 8.8.8.8) para o Node, porque em algumas redes a consulta SRV do `mongodb+srv://` (Atlas) é recusada pelo DNS padrão.

## Testes e CI

`npm test` cobre três áreas:

- **Regras de dinheiro:** conversão de valores, divisão (incluindo valor fixo por pessoa), saldos e quitação. Há um teste de propriedade com 300 cenários aleatórios (semente fixa) que verifica que os saldos somam zero, que as transferências zeram todo mundo e que são no máximo n-1.
- **Autenticação:** senhas (sal, hash adulterado), destino pós-login e tokens de convite.
- **Controle de acesso:** sobe o app com sessão em memória e confere que toda rota de grupo, de convite e de criação redireciona para o login quando não há sessão.

O GitHub Actions roda a checagem de tipos e os testes a cada push.

## Limitações e próximos passos

- **Qualquer membro pode remover gastos e pagamentos de outro.** Não há registro de quem criou cada lançamento (a remoção é lógica, então nada se perde).
- **Autenticação básica:** sem limite de tentativas de login, recuperação de senha, verificação de e-mail ou token CSRF (o cookie `sameSite=lax` cobre a maioria dos casos), e o cadastro é aberto. O dono ainda não remove membros nem sai do grupo.
- **O bot depende de um processo ligado:** mensagens enviadas com ele desligado são processadas ao ligar, se tiverem até 24 horas, e usam a data em que foram enviadas. Não há proteção contra lançamento duplicado se o Telegram reenviar uma atualização (raro com _polling_).
- **Os testes de acesso não cobrem o que depende de banco** (como a regra de quem é membro de qual grupo).
- **Próximos passos:** deploy com Docker, registro de quem criou cada lançamento, limite de tentativas de login, testes com MongoDB no CI, registro de pagamento pelo bot e lançamento por texto livre com confirmação.
