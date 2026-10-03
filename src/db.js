const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

pool.on('error', (err) => console.error('Database pool error:', err.message));

// Migrations only ever ADD things. Never drop tables or columns here.
// To change the schema later, append a new entry to the end of this list.
const MIGRATIONS = [
  `
  CREATE TABLE IF NOT EXISTS guild_config (
    guild_id TEXT PRIMARY KEY,
    transactions_channel_id TEXT
  );

  CREATE TABLE IF NOT EXISTS clans (
    id SERIAL PRIMARY KEY,
    guild_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color INTEGER NOT NULL,
    color_name TEXT NOT NULL,
    role_id TEXT,
    captain_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS clans_guild_name_idx ON clans (guild_id, lower(name));

  CREATE TABLE IF NOT EXISTS clan_members (
    clan_id INTEGER NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    slot TEXT NOT NULL CHECK (slot IN ('1', '2', '3', 'sub')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (clan_id, user_id),
    CONSTRAINT clan_members_slot_unique UNIQUE (clan_id, slot) DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT clan_members_user_unique UNIQUE (guild_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS transactions_log (
    id SERIAL PRIMARY KEY,
    guild_id TEXT NOT NULL,
    type TEXT NOT NULL,
    clan_name TEXT,
    summary TEXT NOT NULL,
    actor_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS transactions_log_guild_idx ON transactions_log (guild_id, id DESC);
  `,
  `
  ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS matches_channel_id TEXT;

  CREATE TABLE IF NOT EXISTS matches (
    id SERIAL PRIMARY KEY,
    guild_id TEXT NOT NULL,
    clan_a_id INTEGER REFERENCES clans(id) ON DELETE SET NULL,
    clan_b_id INTEGER REFERENCES clans(id) ON DELETE SET NULL,
    clan_a_name TEXT NOT NULL,
    clan_b_name TEXT NOT NULL,
    planned_games INTEGER,
    status TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'finished', 'cancelled')),
    started_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
  );
  CREATE INDEX IF NOT EXISTS matches_guild_status_idx ON matches (guild_id, status);

  CREATE TABLE IF NOT EXISTS match_games (
    id SERIAL PRIMARY KEY,
    match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    game_number INTEGER NOT NULL,
    player_a TEXT NOT NULL,
    player_b TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'finished')),
    winner_side TEXT CHECK (winner_side IN ('a', 'b')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    UNIQUE (match_id, game_number)
  );
  `,
  `
  ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS captain_role_id TEXT;
  `,
];

async function connectWithRetry(attempts = 10, delayMs = 3000) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await pool.query('SELECT 1');
      console.log('Connected to the database.');
      return;
    } catch (err) {
      console.error(`Database connection failed (${i}/${attempts}): ${err.message}`);
      if (i === attempts) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  const { rows } = await pool.query('SELECT version FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.version));

  for (let i = 0; i < MIGRATIONS.length; i++) {
    const version = i + 1;
    if (applied.has(version)) continue;
    await tx(async (db) => {
      await db.query(MIGRATIONS[i]);
      await db.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
    });
    console.log(`Applied database migration ${version}.`);
  }
}

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // connection already gone
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, tx, connectWithRetry, migrate };
