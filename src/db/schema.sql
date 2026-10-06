-- Domain tables for the shift-swap library entities.
-- id is shared with the Better Auth "user" table (see signup hook in src/lib/auth.ts).

CREATE TABLE IF NOT EXISTS funcionario (
  id TEXT PRIMARY KEY REFERENCES "user" (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS supervisor (
  id TEXT PRIMARY KEY REFERENCES "user" (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS turno (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  hora_inicio TEXT NOT NULL,
  hora_fim TEXT NOT NULL,
  funcionario_id TEXT NOT NULL REFERENCES funcionario (id) ON DELETE CASCADE
);

-- Histórico de solicitações de troca: sem ON DELETE CASCADE de propósito, para
-- não perder auditoria quando um turno/funcionário é removido.
-- Fluxo: pendente (aguarda o destinatário) -> aguardando_aprovacao (aguarda o supervisor)
--        -> aprovada | rejeitada; ou pendente -> recusada; cancelada/expirada em aberto.
CREATE TABLE IF NOT EXISTS solicitacao_troca_turno (
  id TEXT PRIMARY KEY,
  turno_id TEXT NOT NULL REFERENCES turno (id),
  solicitante_id TEXT NOT NULL REFERENCES funcionario (id),
  destinatario_id TEXT NOT NULL REFERENCES funcionario (id),
  status TEXT NOT NULL,
  respondida_em TIMESTAMPTZ,
  decidido_por_id TEXT REFERENCES supervisor (id),
  decidido_em TIMESTAMPTZ,
  motivo TEXT
);

-- Migração (idempotente) de bancos criados antes do aceite do destinatário.
ALTER TABLE solicitacao_troca_turno ADD COLUMN IF NOT EXISTS respondida_em TIMESTAMPTZ;

-- No modelo antigo o pedido era aberto e não tinha destinatário: as pendentes não têm como
-- seguir no novo fluxo e são canceladas; nas demais, o solicitante vira destinatário
-- provisório só para a coluna poder ser NOT NULL.
UPDATE solicitacao_troca_turno SET status = 'cancelada'
  WHERE status = 'pendente' AND destinatario_id IS NULL;
UPDATE solicitacao_troca_turno SET destinatario_id = solicitante_id
  WHERE destinatario_id IS NULL;
ALTER TABLE solicitacao_troca_turno ALTER COLUMN destinatario_id SET NOT NULL;

ALTER TABLE solicitacao_troca_turno DROP CONSTRAINT IF EXISTS solicitacao_troca_turno_status_check;
ALTER TABLE solicitacao_troca_turno ADD CONSTRAINT solicitacao_troca_turno_status_check
  CHECK (status IN ('pendente', 'aguardando_aprovacao', 'aprovada', 'rejeitada', 'recusada', 'cancelada', 'expirada'));
