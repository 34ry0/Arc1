const { PermissionFlagsBits } = require('discord.js');
const store = require('../store');
const { UserError } = require('./errors');

function isAdmin(interaction) {
  const perms = interaction.memberPermissions;
  return Boolean(perms && (perms.has(PermissionFlagsBits.Administrator) || perms.has(PermissionFlagsBits.ManageGuild)));
}

function requireAdmin(interaction) {
  if (!isAdmin(interaction)) throw new UserError('You need the Manage Server permission to use this command.');
}

// Captains act on their own clan. Admins can pass the "clan" option to act on any clan.
async function resolveActingClan(interaction) {
  const guildId = interaction.guildId;
  const clanName = interaction.options.getString('clan');

  if (clanName) {
    if (!isAdmin(interaction)) throw new UserError('Only admins can use the clan option.');
    const clan = await store.getClanByName(guildId, clanName);
    if (!clan) throw new UserError('No clan found with that name.');
    return clan;
  }

  const clan = await store.getClanByCaptain(guildId, interaction.user.id);
  if (!clan) {
    throw new UserError(
      isAdmin(interaction)
        ? 'You are not a captain. Use the clan option to pick which clan to act on.'
        : 'Only clan captains can use this command.'
    );
  }
  return clan;
}

module.exports = { isAdmin, requireAdmin, resolveActingClan };
