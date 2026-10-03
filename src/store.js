const { pool, tx } = require('./db');

const run = (db) => db || pool;

async function getConfig(guildId, db) {
  const { rows } = await run(db).query('SELECT * FROM guild_config WHERE guild_id = $1', [guildId]);
  return rows[0] || null;
}

async function setTransactionsChannel(guildId, channelId, db) {
  await run(db).query(
    `INSERT INTO guild_config (guild_id, transactions_channel_id) VALUES ($1, $2)
     ON CONFLICT (guild_id) DO UPDATE SET transactions_channel_id = EXCLUDED.transactions_channel_id`,
    [guildId, channelId]
  );
}

async function getClanById(id, db, lock = false) {
  const { rows } = await run(db).query(`SELECT * FROM clans WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [id]);
  return rows[0] || null;
}

async function getClanByName(guildId, name, db) {
  const { rows } = await run(db).query('SELECT * FROM clans WHERE guild_id = $1 AND lower(name) = lower($2)', [guildId, name]);
  return rows[0] || null;
}

async function getClanByCaptain(guildId, userId, db) {
  const { rows } = await run(db).query('SELECT * FROM clans WHERE guild_id = $1 AND captain_id = $2', [guildId, userId]);
  return rows[0] || null;
}

async function setClanRole(clanId, roleId, db) {
  await run(db).query('UPDATE clans SET role_id = $1 WHERE id = $2', [roleId, clanId]);
}

async function listClans(guildId, db) {
  const { rows } = await run(db).query('SELECT * FROM clans WHERE guild_id = $1 ORDER BY lower(name)', [guildId]);
  return rows;
}

async function listMembers(guildId, db) {
  const { rows } = await run(db).query('SELECT * FROM clan_members WHERE guild_id = $1', [guildId]);
  return rows;
}

async function getRoster(clanId, db) {
  const { rows } = await run(db).query('SELECT * FROM clan_members WHERE clan_id = $1', [clanId]);
  return rows;
}

async function getMember(clanId, userId, db) {
  const { rows } = await run(db).query('SELECT * FROM clan_members WHERE clan_id = $1 AND user_id = $2', [clanId, userId]);
  return rows[0] || null;
}

async function getMembership(guildId, userId, db) {
  const { rows } = await run(db).query(
    `SELECT m.*, c.name AS clan_name
     FROM clan_members m JOIN clans c ON c.id = m.clan_id
     WHERE m.guild_id = $1 AND m.user_id = $2`,
    [guildId, userId]
  );
  return rows[0] || null;
}

async function searchClanNames(guildId, text) {
  const pattern = `%${String(text).replace(/[\\%_]/g, '\\$&')}%`;
  const { rows } = await pool.query(
    'SELECT name FROM clans WHERE guild_id = $1 AND name ILIKE $2 ORDER BY lower(name) LIMIT 25',
    [guildId, pattern]
  );
  return rows.map((r) => r.name);
}

async function logTransaction({ guildId, type, clanName, summary, actorId }) {
  await pool.query(
    'INSERT INTO transactions_log (guild_id, type, clan_name, summary, actor_id) VALUES ($1, $2, $3, $4, $5)',
    [guildId, type, clanName, summary, actorId]
  );
}

async function recentTransactions(guildId, limit) {
  const { rows } = await pool.query(
    'SELECT * FROM transactions_log WHERE guild_id = $1 ORDER BY id DESC LIMIT $2',
    [guildId, limit]
  );
  return rows;
}

// Called when someone leaves the Discord server entirely.
async function removeDeparted(guildId, userId) {
  return tx(async (db) => {
    const membership = await getMembership(guildId, userId, db);
    if (!membership) return null;
    const clan = await getClanById(membership.clan_id, db, true);
    await db.query('DELETE FROM clan_members WHERE clan_id = $1 AND user_id = $2', [clan.id, userId]);
    const wasCaptain = clan.captain_id === userId;
    if (wasCaptain) await db.query('UPDATE clans SET captain_id = NULL WHERE id = $1', [clan.id]);
    return { clan, slot: membership.slot, wasCaptain };
  });
}

async function setMatchesChannel(guildId, channelId, db) {
  await run(db).query(
    `INSERT INTO guild_config (guild_id, matches_channel_id) VALUES ($1, $2)
     ON CONFLICT (guild_id) DO UPDATE SET matches_channel_id = EXCLUDED.matches_channel_id`,
    [guildId, channelId]
  );
}

async function getMatchById(id, db, lock = false) {
  const { rows } = await run(db).query(`SELECT * FROM matches WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [id]);
  return rows[0] || null;
}

async function getLiveMatchForClan(clanId, db) {
  const { rows } = await run(db).query(
    "SELECT * FROM matches WHERE status = 'live' AND (clan_a_id = $1 OR clan_b_id = $1) ORDER BY id DESC LIMIT 1",
    [clanId]
  );
  return rows[0] || null;
}

// Live match first, otherwise the most recent one.
async function getLatestMatchForClan(clanId, db) {
  const { rows } = await run(db).query(
    `SELECT * FROM matches WHERE clan_a_id = $1 OR clan_b_id = $1
     ORDER BY (status = 'live') DESC, id DESC LIMIT 1`,
    [clanId]
  );
  return rows[0] || null;
}

async function listLiveMatches(guildId, db) {
  const { rows } = await run(db).query("SELECT * FROM matches WHERE guild_id = $1 AND status = 'live' ORDER BY id", [guildId]);
  return rows;
}

async function getGames(matchId, db) {
  const { rows } = await run(db).query('SELECT * FROM match_games WHERE match_id = $1 ORDER BY game_number', [matchId]);
  return rows;
}

async function getGamesForMatches(matchIds, db) {
  if (!matchIds.length) return [];
  const { rows } = await run(db).query('SELECT * FROM match_games WHERE match_id = ANY($1) ORDER BY match_id, game_number', [matchIds]);
  return rows;
}

async function setCaptainRole(guildId, roleId, db) {
  await run(db).query(
    `INSERT INTO guild_config (guild_id, captain_role_id) VALUES ($1, $2)
     ON CONFLICT (guild_id) DO UPDATE SET captain_role_id = EXCLUDED.captain_role_id`,
    [guildId, roleId]
  );
}

module.exports = {
  setCaptainRole,
  setMatchesChannel,
  getMatchById,
  getLiveMatchForClan,
  getLatestMatchForClan,
  listLiveMatches,
  getGames,
  getGamesForMatches,
  getConfig,
  setTransactionsChannel,
  getClanById,
  getClanByName,
  getClanByCaptain,
  setClanRole,
  listClans,
  listMembers,
  getRoster,
  getMember,
  getMembership,
  searchClanNames,
  logTransaction,
  recentTransactions,
  removeDeparted,
};
