const { SlashCommandBuilder } = require('discord.js');
const store = require('../store');
const { tx } = require('../db');
const { UserError } = require('../Utils/errors');
const { slotLabel } = require('../Utils/format');
const { resolveActingClan } = require('../Utils/permissions');
const { recordTransaction } = require('../Utils/transactions');
const { handleAutocomplete } = require('../Utils/autocomplete');
const roles = require('../Utils/roles');
const captains = require('../Utils/captains');

const data = new SlashCommandBuilder()
  .setName('clan')
  .setDescription('Clan actions')
  .addSubcommand((s) =>
    s
      .setName('captain')
      .setDescription('Captains: hand the captain role to someone on your roster')
      .addUserOption((o) => o.setName('user').setDescription('New captain (must already be on the roster)').setRequired(true))
      .addStringOption((o) =>
        o.setName('clan').setDescription('Admins only: act on this clan instead of your own').setAutocomplete(true)
      )
  )
  .addSubcommand((s) => s.setName('leave').setDescription('Leave your current clan'));

async function captain(interaction) {
  const target = interaction.options.getUser('user');
  if (target.bot) throw new UserError('Bots cannot be captain.');
  const clanRef = await resolveActingClan(interaction);

  const { clan, previous } = await tx(async (db) => {
    const clan = await store.getClanById(clanRef.id, db, true);
    if (!clan) throw new UserError('That clan no longer exists.');
    const member = await store.getMember(clan.id, target.id, db);
    if (!member) throw new UserError(`${target} is not on the ${clan.name} roster. Add them first.`);
    if (clan.captain_id === target.id) throw new UserError(`${target} is already the captain.`);
    await db.query('UPDATE clans SET captain_id = $1 WHERE id = $2', [target.id, clan.id]);
    return { clan: { ...clan, captain_id: target.id }, previous: clan.captain_id };
  });

  await captains.give(interaction.guild, target.id);
  if (previous) await captains.take(interaction.guild, previous);

  const lines = [`${target} is now captain of **${clan.name}**.`];
  if (previous) lines.push(`Previous captain: <@${previous}>`);
  lines.push(`By: ${interaction.user}`);

  await recordTransaction(interaction.guild, {
    type: 'captain',
    title: 'Captain Change',
    clan,
    actorId: interaction.user.id,
    lines,
  });

  await interaction.editReply(`${target} is now captain of ${clan.name}.`);
}

async function leave(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  const { clan, slot } = await tx(async (db) => {
    const membership = await store.getMembership(guildId, userId, db);
    if (!membership) throw new UserError('You are not in a clan.');
    const clan = await store.getClanById(membership.clan_id, db, true);
    if (clan.captain_id === userId) {
      throw new UserError('Captains cannot leave. Hand the captain role to someone else first with /clan captain.');
    }
    await db.query('DELETE FROM clan_members WHERE clan_id = $1 AND user_id = $2', [clan.id, userId]);
    return { clan, slot: membership.slot };
  });

  await roles.take(interaction.guild, clan.role_id, userId);
  await recordTransaction(interaction.guild, {
    type: 'leave',
    title: 'Player Left',
    clan,
    actorId: userId,
    lines: [`${interaction.user} left **${clan.name}**.`, `Previous slot: ${slotLabel(slot)}`],
  });

  await interaction.editReply(`You left ${clan.name}.`);
}

module.exports = {
  data,
  autocomplete: handleAutocomplete,
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'captain') return captain(interaction);
    if (sub === 'leave') return leave(interaction);
  },
};
