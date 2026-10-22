-- Aya's Playground — Postgres schema.
--
-- Applied by `npm run db:migrate`, which runs this file inside a transaction.
-- It is idempotent (`IF NOT EXISTS` throughout), so re-running it is safe.
--
-- Money is `BIGINT`, in whole rupiah — the same unit Midtrans settles in.
-- Never NUMERIC with a scale, and never a float.

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL,
  name           TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  roles          TEXT[] NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL
);

-- Case-insensitive: `A@b.test` and `a@b.test` are one account.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email));

CREATE TABLE IF NOT EXISTS challenges (
  id                 TEXT PRIMARY KEY,
  seller_id          TEXT NOT NULL REFERENCES users (id),
  title              TEXT NOT NULL,
  slug               TEXT NOT NULL UNIQUE,
  category           TEXT NOT NULL,
  current_version_id TEXT,
  created_at         TIMESTAMPTZ NOT NULL,
  updated_at         TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS challenges_seller_idx ON challenges (seller_id, created_at DESC);

CREATE TABLE IF NOT EXISTS challenge_versions (
  id           TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL REFERENCES challenges (id),
  ordinal      INTEGER NOT NULL,
  bundle_hash  TEXT NOT NULL,
  manifest     JSONB NOT NULL,
  spec         JSONB NOT NULL,
  storage_key  TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL,
  UNIQUE (challenge_id, ordinal)
);

CREATE TABLE IF NOT EXISTS verifications (
  id          TEXT PRIMARY KEY,
  version_id  TEXT NOT NULL REFERENCES challenge_versions (id),
  bundle_hash TEXT NOT NULL,
  verdict     TEXT NOT NULL,
  runner_kind TEXT NOT NULL,
  profile     TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  log         TEXT NOT NULL,
  message     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL
);

-- The publish gate reads exactly this: a passing verdict for a given hash.
CREATE INDEX IF NOT EXISTS verifications_pass_idx
  ON verifications (version_id, bundle_hash, created_at DESC)
  WHERE verdict = 'passed';

CREATE INDEX IF NOT EXISTS verifications_version_idx
  ON verifications (version_id, created_at DESC);

CREATE TABLE IF NOT EXISTS listings (
  id               TEXT PRIMARY KEY,
  challenge_id     TEXT NOT NULL REFERENCES challenges (id),
  version_id       TEXT NOT NULL REFERENCES challenge_versions (id),
  seller_id        TEXT NOT NULL REFERENCES users (id),
  title            TEXT NOT NULL,
  slug             TEXT NOT NULL UNIQUE,
  summary          TEXT NOT NULL,
  schemes          TEXT[] NOT NULL,
  difficulty       TEXT NOT NULL,
  price            BIGINT NOT NULL CHECK (price >= 0),
  license_type     TEXT NOT NULL,
  state            TEXT NOT NULL,
  rejection_reason TEXT,
  published_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS listings_browse_idx ON listings (state, created_at DESC);
CREATE INDEX IF NOT EXISTS listings_version_idx ON listings (version_id);
CREATE INDEX IF NOT EXISTS listings_schemes_idx ON listings USING GIN (schemes);

CREATE TABLE IF NOT EXISTS orders (
  id                 TEXT PRIMARY KEY,
  midtrans_order_id  TEXT NOT NULL UNIQUE,
  buyer_id           TEXT NOT NULL REFERENCES users (id),
  seller_id          TEXT NOT NULL REFERENCES users (id),
  listing_id         TEXT NOT NULL REFERENCES listings (id),
  version_id         TEXT NOT NULL REFERENCES challenge_versions (id),
  amount             BIGINT NOT NULL CHECK (amount >= 0),
  commission         BIGINT NOT NULL CHECK (commission >= 0),
  seller_net         BIGINT NOT NULL CHECK (seller_net >= 0),
  license_terms      JSONB NOT NULL,
  flag_format        TEXT NOT NULL,
  state              TEXT NOT NULL,
  snap_token         TEXT,
  snap_redirect_url  TEXT,
  payment_type       TEXT,
  failure_reason     TEXT,
  fulfill_attempts   INTEGER NOT NULL DEFAULT 0,
  expires_at         TIMESTAMPTZ NOT NULL,
  paid_at            TIMESTAMPTZ,
  delivered_at       TIMESTAMPTZ,
  dispute_until      TIMESTAMPTZ,
  payout_matured_at  TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL,
  updated_at         TIMESTAMPTZ NOT NULL,
  -- The commission split must always reconstruct the gross. A row that fails
  -- this is a reconciliation problem nobody would otherwise notice.
  CONSTRAINT orders_split_sums CHECK (commission + seller_net = amount)
);

CREATE INDEX IF NOT EXISTS orders_buyer_idx ON orders (buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_seller_idx ON orders (seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_listing_idx ON orders (listing_id, state);
-- Sweeps: expiry, payout maturation, and stalled-fulfilment recovery.
CREATE INDEX IF NOT EXISTS orders_state_idx ON orders (state, updated_at);
CREATE INDEX IF NOT EXISTS orders_dispute_idx ON orders (dispute_until)
  WHERE state = 'delivered' AND payout_matured_at IS NULL;

CREATE TABLE IF NOT EXISTS deliveries (
  id             TEXT PRIMARY KEY,
  order_id       TEXT NOT NULL UNIQUE REFERENCES orders (id),
  storage_key    TEXT NOT NULL,
  size_bytes     BIGINT NOT NULL,
  sha256         TEXT NOT NULL,
  download_count INTEGER NOT NULL DEFAULT 0,
  max_downloads  INTEGER NOT NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  id            TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL UNIQUE REFERENCES orders (id),
  listing_id    TEXT NOT NULL REFERENCES listings (id),
  challenge_id  TEXT NOT NULL REFERENCES challenges (id),
  reviewer_id   TEXT NOT NULL REFERENCES users (id),
  reviewer_name TEXT NOT NULL,
  rating        INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS reviews_challenge_idx ON reviews (challenge_id, created_at DESC);
CREATE INDEX IF NOT EXISTS reviews_listing_idx ON reviews (listing_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payout_balances (
  seller_id  TEXT PRIMARY KEY REFERENCES users (id),
  pending    BIGINT NOT NULL DEFAULT 0 CHECK (pending >= 0),
  payable    BIGINT NOT NULL DEFAULT 0 CHECK (payable >= 0),
  paid       BIGINT NOT NULL DEFAULT 0 CHECK (paid >= 0),
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS payout_releases (
  id          TEXT PRIMARY KEY,
  seller_id   TEXT NOT NULL REFERENCES users (id),
  amount      BIGINT NOT NULL CHECK (amount > 0),
  reference   TEXT NOT NULL,
  released_by TEXT NOT NULL REFERENCES users (id),
  created_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS payout_releases_seller_idx
  ON payout_releases (seller_id, created_at DESC);

-- Append-only. There is deliberately no UPDATE or DELETE path in the repository
-- interface, and none should be added here.
CREATE TABLE IF NOT EXISTS audit_entries (
  id           TEXT PRIMARY KEY,
  actor        TEXT NOT NULL,
  action       TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id   TEXT NOT NULL,
  detail       JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_entries (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_subject_idx ON audit_entries (subject_type, subject_id, created_at DESC);
