# GB Soluções

Sistema de gestão empresarial e contábil da GB Soluções. React + TypeScript no frontend, API Express + TypeScript e PostgreSQL externo no backend. O visual foi adaptado dos templates fornecidos.

## Acesso local

- Aplicação: **http://localhost:3000**
- Administração: **http://localhost:3000/admin**
- Portal do cliente: **http://localhost:3000/portal**
- Catálogo público: **http://localhost:3000/solicitar**

O login é único. As credenciais do administrador primário ficam em `backend/.env`, nas variáveis `ADMIN_EMAIL` e `ADMIN_PASSWORD`. O painel não pode modificar esse acesso.

```powershell
docker compose up -d --build
docker compose ps
docker compose logs --tail 100 backend
```

Somente `127.0.0.1:3000` é publicada. A porta 3001 da API fica na rede interna. O PostgreSQL permanece no host ou servidor externo; não há container de banco.

## Instalação em outra máquina

1. Instale Docker com Compose e disponibilize um PostgreSQL 16 ou superior.
2. Copie `backend/.env.example` para `backend/.env` e preencha as variáveis.
3. Gere **duas chaves diferentes** de 32 bytes hexadecimais para `DATA_ENCRYPTION_KEY` e `BACKUP_ENCRYPTION_KEY`:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

4. Para PostgreSQL local no Windows, execute `./scripts/setup-local.ps1`. Ele instala as dependências operacionais, cria o banco **somente se ausente** e inicia o Compose. Para banco remoto, crie o banco no provedor e execute apenas o Compose.

`DATABASE_URL` é derivada das variáveis `DB_*`, com escape das credenciais. Dentro do Docker, `localhost`, `127.0.0.1` e `::1` são traduzidos para `host.docker.internal`; um hostname remoto não é alterado. Fora do Docker, `localhost` continua local.

Migrations rodam antes da API, com transação, histórico e advisory lock. As tabelas ficam no schema `gb_clareza`. Não há reset, sincronização destrutiva ou geração de tabelas com sufixos. Uma tabela conflitante interrompe a migration, em vez de ser sobrescrita. Seeds só inserem configurações ausentes e sincronizam o administrador primário com o ambiente.

Nunca apague o histórico de migrations para tentar resolver um erro. Faça backup antes de atualizar versões.

## Uso

- **Clientes:** cadastre a empresa e seu contrato inicial. O e-mail de contato não cria uma conta automaticamente. Em Usuários, vincule cada acesso de cliente ao respectivo cadastro; um cliente pode ter mais de um usuário.
- **Faturamento:** valores enviados pelo portal aguardam revisão. A gestora pode aprovar, corrigir ou rejeitar. Um reenvio não substitui um valor aprovado. Lançamentos da gestora também geram histórico.
- **Checklist:** etapas mensais e periódicas variam conforme o plano. Atualizações são parciais e preservam outras tarefas e competências.
- **Honorários:** cada competência tem sua cobrança. Alterações contratuais preservam meses anteriores e recebimentos confirmados. Não existe cobrança, transferência bancária ou emissão de boleto automática.
- **Solicitações:** pedidos públicos entram como interessados. A vinculação é manual; o sistema não associa um visitante por e-mail. O preço de referência é copiado para cada pedido e o valor combinado é confirmado pela gestão.
- **Documentos:** a gestora publica guias e relatórios; o cliente envia extratos. Downloads sempre passam pela autorização da API.
- **Ficha completa:** razão social, CNPJ, inscrição municipal, cidade, UF e telefone, além de abas para documentos, apuração, relatórios e cofre.
- **Cofre:** acessos à prefeitura, códigos do Simples e outros portais são cifrados. A consulta exige confirmação da senha administrativa e é liberada por cinco minutos, somente para a ficha selecionada. Dados revelados são ocultados após 30 segundos e nunca aparecem na listagem ou auditoria. Certificados A1 em PFX/P12 são validados com a senha, cifrados antes do envio ao GCS e baixados apenas pela administração com o cofre desbloqueado. A senha do certificado também fica cifrada. Certificados A3 em token/cartão não são arquivos para upload.
- **Kanban:** solicitações entram em Recebidas e podem ser arrastadas para Em andamento, Concluídas e Cobradas. O seletor do cartão atende celular e teclado. Coluna e posição persistem no banco, com proteção contra sobrescrever uma movimentação concorrente.
- **Apuração e PDFs:** ao aprovar faturamento, o sistema cria a declaração mensal e o consolidado anual. A aba Apuração permite detalhar comércio, indústria e serviços, com ou sem nota fiscal, vincular documentos e informar se houve empregado no ano. Mudanças aprovadas geram novas versões; lançamentos pendentes ou rejeitados não entram nos totais. Zero confirmado é diferente de mês não informado.
- **Declarações anuais:** o consolidado do MEI serve de apoio à DASN-SIMEI; o da ME serve de apoio à DEFIS e indica a necessidade das demais informações contábeis. PDFs incompletos ou de ano em andamento aparecem como prévias. A virada de ano é verificada diariamente no fuso de São Paulo. Não há transmissão oficial ou assinatura digital automática.
- **Arquivamento:** impede o acesso e mantém o histórico. A exclusão definitiva remove dados ativos e objetos do GCS; backups já existentes expiram conforme a retenção. Se a remoção de um objeto falhar, o cliente fica bloqueado e a exclusão pode ser repetida.

Os indicadores fiscais são gerenciais: não há emissão fiscal, transmissão ao governo ou apuração oficial. RBT12 sem 12 meses anteriores é uma estimativa; o valor oficial deve ser conferido no PGDAS-D. Parâmetros anuais ausentes aparecem como **A definir**, sem copiar valores de outro ano. Os valores iniciais de 2026 têm a fonte registrada no painel. Configure anos seguintes após verificar vigência e legislação.

## GCS e Resend

As integrações ficam pendentes enquanto suas credenciais estiverem vazias. A aplicação continua funcionando, mas nenhum upload ou e-mail é marcado falsamente como enviado.

Os PDFs podem ser baixados de forma autenticada a partir de suas versões, mesmo quando a cópia privada em nuvem aguarda configuração. O banco guarda os dados da versão e os metadados, sem o binário PDF. Certificados e documentos enviados dependem do GCS e não têm fallback para disco local ou banco.

### Armazenamento privado

Preencha `GCS_BUCKET_NAME` e **uma** das opções:

- `GCS_SERVICE_ACCOUNT_JSON`: JSON completo entre aspas no `.env`.
- `GCS_SERVICE_ACCOUNT_FILE`: arquivo em `backend/secrets`, referenciado como `/app/secrets/arquivo.json` dentro do container.

Ative **Public access prevention: Enforced** e **Uniform bucket-level access** no bucket. O upload verifica a prevenção de acesso público. Remova concessões `allUsers` e `allAuthenticatedUsers`; use uma conta de serviço dedicada com acesso apenas ao bucket necessário. Configure versionamento, recuperação e ciclo de vida no provedor conforme sua política de retenção.

A conta precisa de `storage.buckets.get` para verificar a proteção do bucket, além de criar, ler e excluir objetos. Erros de permissão não são contornados pelo aplicativo: o painel indica a pendência e nenhum upload é anunciado como concluído.

Arquivos permitidos: PDF, OFX, CSV, JPEG e PNG, até 10 MB. O backend verifica o conteúdo além da extensão. O nome do objeto não contém nomes de pessoas ou arquivos. O banco guarda apenas metadados, nunca o binário.

### E-mail

Preencha `RESEND_API_KEY` e `RESEND_FROM_EMAIL` com um domínio verificado. Reinicie o backend após modificar o `.env`:

```powershell
docker compose up -d --force-recreate backend
```

Convites e recuperações ficam em uma fila cifrada, processada a cada 30 segundos, com tentativas limitadas e chave de idempotência. Convites expiram em 24 horas e recuperações em 30 minutos. Reenvie convites antigos pelo painel após concluir a configuração. Tokens são pessoais, de uso único e armazenados como hash; links não entram nos logs de acesso.

Convites criados pela administração são tentados imediatamente. A lista de usuários distingue **aguardando definição de senha**, **envio aceito pelo Resend**, **pendente** e **falha de envio**, com orientação do erro. Aceitação pelo provedor não confirma leitura nem chegada à caixa de entrada. O remetente configurado para este projeto é `GB Solucoes <contato@mail.luisbuscher.com.br>`.

`APP_URL` determina o endereço do link recebido. Enquanto for `http://localhost:3000`, o convite só abre neste computador. Configure o domínio público HTTPS antes de convidar clientes para acesso externo.

## Segurança e produção

- Senhas Argon2id, cookies HttpOnly / SameSite, proteção CSRF e verificação de origem.
- Sessões com 30 minutos de inatividade e duração máxima de oito horas, revogadas em redefinições e desativações.
- Autorização por perfil e cliente no servidor, incluindo arquivos e filtros.
- Observações, descrições livres, identificação de contas e fila de e-mail cifradas com AES-256-GCM.
- Auditoria de acessos e alterações sem senhas, tokens ou conteúdo de documentos. Configurações também possuem histórico no banco.
- Credenciais e chaves nunca entram no Git ou nas imagens. Guarde cópias das chaves fora desta máquina; perder a chave impede recuperar os campos cifrados e os backups.

Para produção, configure `APP_URL=https://seu-dominio`, `COOKIE_SECURE=true`, `REQUIRE_HTTPS=true`, `DB_SSL=true` e, quando necessário, `DB_SSL_CA_FILE`. A API recusa URL pública com proteção HTTPS desativada. A validação do certificado PostgreSQL permanece habilitada.

O proxy público deve terminar TLS e sobrescrever `X-Forwarded-Proto` com o protocolo real, sem aceitar esse cabeçalho diretamente dos visitantes. Mantenha a publicação Docker vinculada ao loopback e encaminhe pelo proxy. O Nginx interno encaminha o protocolo informado pelo proxy local. O HTTPS público e os certificados não são provisionados por este projeto.

Use um usuário PostgreSQL dedicado e acesso de rede restrito ao banco da aplicação. O usuário local `postgres` foi usado conforme solicitado; o usuário de produção precisa de permissões para migrations no schema da aplicação. Configure criptografia de disco e backups no servidor externo.

## Backups e restauração

O backup usa `pg_dump` em formato custom, cifrado com AES-256-GCM e chave própria. Nenhum dump em texto claro é salvo durante o backup. Por padrão, os arquivos ficam em `%LOCALAPPDATA%/GBClareza/backups` no Windows, com retenção de 30 dias. Configure `BACKUP_DIR` em um volume protegido e mantenha cópia externa; somente uma cópia no mesmo computador não protege contra perda da máquina.

```powershell
cd backend
npm ci
npm run backup
npm run restore -- "C:/caminho/arquivo.gbbackup" gastomensal_restaurado
```

Use clientes `pg_dump` / `pg_restore` compatíveis com a versão do servidor. A restauração autentica a integridade do backup antes de criar o banco e só aceita um destino **novo e diferente do banco ativo**. Nunca restaura sobre os dados existentes. O dump temporário de restauração tem acesso restrito e é removido ao final.

Agendamento Windows:

```powershell
./scripts/install-backup-task.ps1
```

O instalador tenta criar uma tarefa diária às **03h de São Paulo**, independente de sessão. Se o Windows negar essa permissão, instala uma alternativa na Inicialização do usuário: funciona enquanto sua sessão estiver ativa e recupera a execução pendente ao entrar depois das 03h. O processo roda oculto e impede instâncias duplicadas. Consulte `%LOCALAPPDATA%/GBClareza/backup-status.log`. Para execução sem sessão aberta, execute o instalador com uma conta que tenha permissão de registrar a tarefa.

No Linux, instale o cliente PostgreSQL e as dependências operacionais do backend, use um diretório de backup acessível apenas ao usuário do serviço e configure cron em um host com fuso `America/Sao_Paulo`:

```cron
0 3 * * * cd /opt/gb-clareza/backend && /usr/bin/node scripts/backup.mjs >> /var/log/gb-clareza-backup.log 2>&1
```

Monitore o resultado e copie as cópias cifradas para outro local. Defina a política de retenção dos documentos e backups conforme as obrigações do escritório; exclusão de cliente não apaga silenciosamente backups históricos.

## Desenvolvimento e testes

```powershell
cd backend
npm ci
npm run dev
# Em outro terminal:
cd frontend
npm ci
npm run dev
```

O Vite encaminha `/api` para `localhost:3001`. Se usar a porta 5173 no desenvolvimento, ajuste `APP_URL=http://localhost:5173` no backend e reinicie a API. O Compose usa `http://localhost:3000`.

Crie um banco dedicado `gastomensal_test` antes dos testes, com as credenciais do `.env`. A suíte fixa esse nome e limpa **somente** suas tabelas de teste. Não aponte esse nome para dados reais.

```powershell
cd backend
npm test
npm run build
npm audit --omit=dev
cd ../frontend
npm run build
npm audit --omit=dev
```

A suíte cobre isolamento entre clientes, sessão, CSRF, senhas, tokens, revisão de faturamento, honorários históricos, migrations repetidas, arquivos, cofre, certificados A1, Kanban, relatórios MEI/ME e falhas de configuração. GCS e e-mail usam adaptadores **somente em teste**. Os testes de certificado geram um PFX descartável via OpenSSL; no Windows, configure `OPENSSL_BIN` se o executável não estiver em `C:/Program Files/Git/usr/bin/openssl.exe`. Chamadas reais a GCS e Resend precisam das credenciais e permissões do ambiente.
