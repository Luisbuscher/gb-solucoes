exports.up = (pgm) =>
  pgm.sql(`
ALTER TABLE clients ADD COLUMN legal_name varchar(160) NOT NULL DEFAULT '',
 ADD COLUMN cnpj varchar(18) NOT NULL DEFAULT '', ADD COLUMN municipal_registration varchar(40) NOT NULL DEFAULT '',
 ADD COLUMN city varchar(80) NOT NULL DEFAULT '', ADD COLUMN state varchar(2) NOT NULL DEFAULT '',
 ADD COLUMN phone varchar(20) NOT NULL DEFAULT '';
ALTER TABLE mail_outbox ADD COLUMN last_error text, ADD COLUMN provider_id text,
 ADD COLUMN sent_at timestamptz;
UPDATE mail_outbox m SET status='Pendente',attempts=0,next_attempt_at=now() FROM auth_tokens t WHERE t.id=m.id AND m.status='Falhou' AND t.used_at IS NULL AND t.expires_at>now();
ALTER TABLE orders ADD COLUMN board_position integer NOT NULL DEFAULT 0,
 ADD COLUMN board_revision integer NOT NULL DEFAULT 0;
CREATE TABLE vault_grants (
 session_hash text NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
 client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL, PRIMARY KEY(session_hash,client_id)
);
CREATE TABLE client_credentials (
 id uuid PRIMARY KEY, client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 label varchar(80) NOT NULL, kind text NOT NULL CHECK(kind IN ('prefeitura','simples','govbr','outro')),
 secret_payload text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE client_certificates (
 id uuid PRIMARY KEY, client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 label varchar(80) NOT NULL, filename text NOT NULL, object_key text UNIQUE NOT NULL,
 size integer NOT NULL, valid_until date, secret_payload text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE revenue_assessments (
 client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE, month char(7) NOT NULL,
 commerce_with_invoice numeric(14,2) NOT NULL CHECK(commerce_with_invoice>=0),
 commerce_without_invoice numeric(14,2) NOT NULL CHECK(commerce_without_invoice>=0),
 industry_with_invoice numeric(14,2) NOT NULL CHECK(industry_with_invoice>=0),
 industry_without_invoice numeric(14,2) NOT NULL CHECK(industry_without_invoice>=0),
 services_with_invoice numeric(14,2) NOT NULL CHECK(services_with_invoice>=0),
 services_without_invoice numeric(14,2) NOT NULL CHECK(services_without_invoice>=0),
 total numeric(14,2) NOT NULL CHECK(total>=0), notes text NOT NULL DEFAULT '',
 assessed_by uuid REFERENCES users(id) ON DELETE SET NULL, assessed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(client_id,month)
);
CREATE TABLE revenue_evidence (
 client_id uuid NOT NULL, month char(7) NOT NULL, document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
 PRIMARY KEY(client_id,month,document_id), FOREIGN KEY(client_id,month) REFERENCES revenue_assessments(client_id,month) ON DELETE CASCADE
);
CREATE TABLE annual_inputs (
 client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE, year integer NOT NULL,
 had_employee boolean, PRIMARY KEY(client_id,year)
);
CREATE TABLE report_versions (
 id uuid PRIMARY KEY, client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('monthly','annual')), period text NOT NULL, revision integer NOT NULL,
 source_hash text NOT NULL, snapshot jsonb NOT NULL, object_key text UNIQUE,
 storage_status text NOT NULL DEFAULT 'Pendente', storage_error text,
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(client_id,kind,period,revision)
);
CREATE INDEX reports_client_period ON report_versions(client_id,kind,period,revision DESC);
CREATE INDEX vault_credentials_client ON client_credentials(client_id);
CREATE INDEX certificates_client ON client_certificates(client_id);
INSERT INTO settings(key,value) VALUES('organization','{"name":"GB Soluções","crc":"RS-107227/0"}') ON CONFLICT(key) DO UPDATE SET value=excluded.value;
UPDATE settings SET value=jsonb_set(value,'{whatsapp}','"5551991056678"'::jsonb) WHERE key='contact';
`);
exports.down = false;
