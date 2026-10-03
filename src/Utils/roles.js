// Clan roles are a convenience. If the bot lacks permission, the clan still works.

async function create(guild, name, color, extra = {}) {
  try {
    const role = await guild.roles.create({ name, color, mentionable: false, reason: 'Clan created', ...extra });
    return role.id;
  } catch (err) {
    console.warn(`Could not create role for clan "${name}": ${err.message}`);
    return null;
  }
}

async function give(guild, roleId, userId) {
  if (!roleId) return false;
  try {
    const member = await guild.members.fetch(userId);
    await member.roles.add(roleId, 'Clan roster update');
    return true;
  } catch (err) {
    console.warn(`Could not add role to ${userId}: ${err.message}`);
    return false;
  }
}

async function take(guild, roleId, userId) {
  if (!roleId) return;
  try {
    const member = await guild.members.fetch(userId);
    await member.roles.remove(roleId, 'Clan roster update');
  } catch (err) {
    console.warn(`Could not remove clan role from ${userId}: ${err.message}`);
  }
}

async function remove(guild, roleId) {
  if (!roleId) return;
  try {
    await guild.roles.delete(roleId, 'Clan deleted');
  } catch (err) {
    console.warn(`Could not delete clan role ${roleId}: ${err.message}`);
  }
}

module.exports = { create, give, take, remove };
