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
CREATE TABLE IF NOT EXISTS solicitacao_troca_turno (
  id TEXT PRIMARY KEY,
  turno_id TEXT NOT NULL REFERENCES turno (id),
  solicitante_id TEXT NOT NULL REFERENCES funcionario (id),
  destinatario_id TEXT REFERENCES funcionario (id),
  status TEXT NOT NULL CHECK (status IN ('pendente', 'aprovada', 'rejeitada', 'cancelada', 'expirada')),
  decidido_por_id TEXT REFERENCES supervisor (id),
  decidido_em TIMESTAMPTZ,
  motivo TEXT
);
