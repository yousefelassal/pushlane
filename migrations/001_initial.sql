CREATE TABLE projects (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  environment text NOT NULL CHECK (environment IN ('development', 'production')),
  plan text NOT NULL CHECK (plan IN ('free', 'pro', 'self_hosted')),
  api_key_hash text NOT NULL UNIQUE,
  credentials_ciphertext text NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE installation_sessions (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id),
  installation_id uuid NOT NULL,
  user_id text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz(3) NOT NULL,
  revoked_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (project_id, id)
);

CREATE UNIQUE INDEX installation_sessions_active
  ON installation_sessions(project_id, installation_id) WHERE revoked_at IS NULL;

CREATE TABLE installations (
  project_id uuid NOT NULL REFERENCES projects(id),
  id uuid NOT NULL,
  user_id text NOT NULL,
  session_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('apns', 'fcm', 'webpush')),
  endpoint_hash text NOT NULL,
  endpoint_ciphertext text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  revoked_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, session_id) REFERENCES installation_sessions(project_id, id)
);

CREATE UNIQUE INDEX installations_active_endpoint
  ON installations(project_id, endpoint_hash) WHERE revoked_at IS NULL;

CREATE INDEX installations_user ON installations(project_id, user_id) WHERE revoked_at IS NULL;

CREATE TABLE notifications (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id),
  user_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  payload jsonb NOT NULL,
  delivery_count integer NOT NULL CHECK (delivery_count >= 0),
  expires_at timestamptz(3) NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (project_id, idempotency_key),
  UNIQUE (project_id, id)
);

CREATE INDEX notifications_logs ON notifications(project_id, created_at DESC, id DESC);
CREATE INDEX notifications_user_logs ON notifications(project_id, user_id, created_at DESC, id DESC);

CREATE TABLE deliveries (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  notification_id uuid NOT NULL,
  installation_id uuid NOT NULL,
  session_id uuid NOT NULL,
  endpoint_version integer NOT NULL,
  provider text NOT NULL CHECK (provider IN ('apns', 'fcm', 'webpush')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'provider_accepted', 'retrying', 'failed', 'expired', 'suppressed')),
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz(3) NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_expires_at timestamptz(3),
  provider_message_id text,
  last_error text,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, notification_id) REFERENCES notifications(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, installation_id) REFERENCES installations(project_id, id),
  FOREIGN KEY (project_id, session_id) REFERENCES installation_sessions(project_id, id),
  UNIQUE (notification_id, installation_id)
);

CREATE INDEX deliveries_pending ON deliveries(next_attempt_at) WHERE status IN ('queued', 'retrying');
CREATE INDEX deliveries_leases ON deliveries(lease_expires_at) WHERE status = 'processing';
CREATE INDEX deliveries_notification ON deliveries(project_id, notification_id);

CREATE TABLE delivery_attempts (
  delivery_id uuid NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  attempt integer NOT NULL,
  started_at timestamptz(3) NOT NULL,
  finished_at timestamptz(3) NOT NULL DEFAULT now(),
  result text NOT NULL CHECK (result IN ('accepted', 'retry', 'rejected', 'expired', 'suppressed')),
  code text,
  PRIMARY KEY (delivery_id, attempt)
);

CREATE TABLE monthly_usage (
  project_id uuid NOT NULL REFERENCES projects(id),
  month date NOT NULL,
  reserved_dispatches integer NOT NULL DEFAULT 0 CHECK (reserved_dispatches >= 0),
  PRIMARY KEY (project_id, month)
);
