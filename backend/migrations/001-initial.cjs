exports.up = (pgm) =>
  pgm.sql(`
CREATE TABLE clients (
 id uuid PRIMARY KEY, name varchar(80) NOT NULL, email varchar(254), type text NOT NULL CHECK(type IN ('MEI','ME')),
 activity text NOT NULL CHECK(activity IN ('servicos','comercio','ambos')), partners integer NOT NULL DEFAULT 0 CHECK(partners>=0),
 since_month char(7) NOT NULL, opening_month char(7), drive text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '',
 active boolean NOT NULL DEFAULT true, deletion_pending boolean NOT NULL DEFAULT false, onboarding jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE users (
 id uuid PRIMARY KEY, email varchar(254) UNIQUE NOT NULL, name varchar(80) NOT NULL, password_hash text,
 role text NOT NULL CHECK(role IN ('admin','cliente')), client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
 active boolean NOT NULL DEFAULT true, primary_admin boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((role='cliente' AND client_id IS NOT NULL AND primary_admin=false) OR (role='admin' AND client_id IS NULL))
);
CREATE UNIQUE INDEX one_primary_admin ON users(primary_admin) WHERE primary_admin;
CREATE TABLE sessions (token_hash text PRIMARY KEY, user_id uuid REFERENCES users(id) ON DELETE CASCADE, csrf text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), touched_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE auth_tokens (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash text UNIQUE NOT NULL, kind text NOT NULL CHECK(kind IN ('invite','reset')), expires_at timestamptz NOT NULL, used_at timestamptz);
CREATE TABLE security_limits (key text PRIMARY KEY, attempts integer NOT NULL, started_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE plans (code text PRIMARY KEY);
CREATE TABLE plan_versions (id uuid PRIMARY KEY, code text NOT NULL REFERENCES plans(code), effective char(7) NOT NULL, amount numeric(14,2) NOT NULL CHECK(amount>=0), ceiling numeric(14,2), partners integer, hours numeric(6,2), UNIQUE(code,effective));
CREATE TABLE client_contracts (client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE, effective char(7) NOT NULL, plan text NOT NULL REFERENCES plans(code), amount numeric(14,2) NOT NULL CHECK(amount>=0), PRIMARY KEY(client_id,effective));
CREATE TABLE service_versions (id uuid PRIMARY KEY, code text NOT NULL, effective char(7) NOT NULL, category text NOT NULL, name text NOT NULL, description text NOT NULL, price_label text NOT NULL, amount numeric(14,2) CHECK(amount>=0), UNIQUE(code,effective));
CREATE TABLE fiscal_configs (year integer PRIMARY KEY CHECK(year BETWEEN 2000 AND 2200), config jsonb NOT NULL, source text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE settings (key text PRIMARY KEY, value jsonb NOT NULL);
CREATE TABLE monthly_tasks (client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE, month char(7) NOT NULL, tasks jsonb NOT NULL DEFAULT '{}', notes_count integer NOT NULL DEFAULT 0 CHECK(notes_count>=0), PRIMARY KEY(client_id,month));
CREATE TABLE revenues (client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE, month char(7) NOT NULL, amount numeric(14,2) NOT NULL CHECK(amount>=0), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(client_id,month));
CREATE TABLE revenue_reviews (id uuid PRIMARY KEY, client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE, month char(7) NOT NULL, amount numeric(14,2) NOT NULL CHECK(amount>=0), approved_amount numeric(14,2), status text NOT NULL DEFAULT 'Pendente' CHECK(status IN ('Pendente','Aprovado','Rejeitado')), submitted_by uuid REFERENCES users(id) ON DELETE SET NULL, reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL, submitted_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz, reason text NOT NULL DEFAULT '');
CREATE TABLE fees (client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE, month char(7) NOT NULL, plan text NOT NULL, amount numeric(14,2) NOT NULL CHECK(amount>=0), paid boolean NOT NULL DEFAULT false, paid_at timestamptz, PRIMARY KEY(client_id,month));
CREATE TABLE orders (id uuid PRIMARY KEY, client_id uuid REFERENCES clients(id) ON DELETE CASCADE, contact_name varchar(80) NOT NULL, contact_email varchar(254), business varchar(80) NOT NULL DEFAULT '', declared_plan text NOT NULL DEFAULT '', service_code text, service_name text NOT NULL, price_label text NOT NULL, reference_amount numeric(14,2), amount numeric(14,2) CHECK(amount>=0), details text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'Recebida' CHECK(status IN ('Recebida','Em andamento','Concluída','Cobrada')), source text NOT NULL CHECK(source IN ('publico','cliente','admin')), date date NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE documents (id uuid PRIMARY KEY, client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE, title varchar(120) NOT NULL, filename text NOT NULL, object_key text UNIQUE NOT NULL, mime text NOT NULL, size integer NOT NULL, category text NOT NULL CHECK(category IN ('Guias','Relatórios','Declarações','Cadastro','Extratos','Outros')), month char(7) NOT NULL, account text NOT NULL DEFAULT '', uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE audit_events (id bigserial PRIMARY KEY, actor_id uuid REFERENCES users(id) ON DELETE SET NULL, action text NOT NULL, entity_type text NOT NULL, entity_id text, ip text, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE mail_outbox (id uuid PRIMARY KEY, user_id uuid REFERENCES users(id) ON DELETE CASCADE, payload text NOT NULL, status text NOT NULL DEFAULT 'Pendente', attempts integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), next_attempt_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX orders_client ON orders(client_id,date DESC);
CREATE INDEX documents_client ON documents(client_id,month DESC);
CREATE INDEX reviews_client ON revenue_reviews(client_id,submitted_at DESC);
CREATE INDEX audit_created ON audit_events(created_at DESC);
CREATE INDEX sessions_touched ON sessions(touched_at);
INSERT INTO settings VALUES ('contact','{"whatsapp":"","instagram":"https://www.instagram.com/gbsolucoes.rs","agenda":"https://calendar.app.google/6QyPVUxcd98w2THk7"}');
`);
exports.down = false;
