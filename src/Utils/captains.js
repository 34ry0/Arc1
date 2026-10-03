const store = require('../store');
const roles = require('./roles');

const CAPTAIN_COLOR = 0xd4af37;

// Returns the ID of the captain role. Uses the one an admin picked with /admin set-captain-role,
// or creates a role called "Captain" the first time it is needed.
async function ensureCaptainRole(guild) {
  const config = await store.getConfig(guild.id);
  if (config && config.captain_role_id) {
    const existing = guild.roles.cache.get(config.captain_role_id) || (await guild.roles.fetch(config.captain_role_id).catch(() => null));
    if (existing) return existing.id;
  }
  const roleId = await roles.create(guild, 'Captain', CAPTAIN_COLOR, { hoist: true, reason: 'Captain role created by the bot' });
  if (roleId) await store.setCaptainRole(guild.id, roleId);
  return roleId;
}

// The role is only a label. Who counts as a captain is stored in the database.
async function give(guild, userId) {
  const roleId = await ensureCaptainRole(guild);
  return roleId ? roles.give(guild, roleId, userId) : false;
}

async function take(guild, userId) {
  const config = await store.getConfig(guild.id);
  if (config && config.captain_role_id) await roles.take(guild, config.captain_role_id, userId);
}

module.exports = { ensureCaptainRole, give, take };
