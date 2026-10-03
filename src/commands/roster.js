const { SlashCommandBuilder } = require('discord.js');
const store = require('../store');
const { tx } = require('../db');
const { UserError } = require('../utils/errors');
const { SLOTS, slotLabel, rosterEmbed } = require('../utils/format');
const { resolveActingClan } = require('../utils/permissions');
const { recordTransaction } = require('../utils/transactions');
const { handleAutocomplete } = require('../utils/autocomplete');
const roles = require('../utils/roles');

const SLOT_CHOICES = [
  { name: 'Starter 1', value: '1' },
  { name: 'Starter 2', value: '2' },
  { name: 'Starter 3', value: '3' },
  { name: 'Sub', value: 'sub' },
];

const adminClanOption = (o) =>
  o.setName('clan').setDescription('Admins only: act on this clan instead of your own').setAutocomplete(true);

const data = new SlashCommandBuilder()
  .setName('roster')
  .setDescription('View and manage clan rosters')
  .addSubcommand((s) =>
    s
      .setName('view')
      .setDescription('Show a clan roster')
      .addStringOption((o) => o.setName('clan').setDescription('Clan name (defaults to your clan)').setAutocomplete(true))
  )
  .addSubcommand((s) =>
    s
      .setName('add')
      .setDescription('Captains: add a player to your roster')
      .addUserOption((o) => o.setName('user').setDescription('Player to add').setRequired(true))
      .addStringOption((o) => o.setName('slot').setDescription('Slot to put them in (defaults to the first open one)').addChoices(...SLOT_CHOICES))
      .addStringOption(adminClanOption)
  )
  .addSubcommand((s) =>
    s
      .setName('remove')
      .setDescription('Captains: remove a player from your roster')
      .addUserOption((o) => o.setName('user').setDescription('Player to remove').setRequired(true))
      .addStringOption(adminClanOption)
  )
  .addSubcommand((s) =>
    s
      .setName('move')
      .setDescription('Captains: move a player to another slot (swaps if the slot is taken)')
      .addUserOption((o) => o.setName('user').setDescription('Player to move').setRequired(true))
      .addStringOption((o) => o.setName('slot').setDescription('New slot').setRequired(true).addChoices(...SLOT_CHOICES))
      .addStringOption(adminClanOption)
  );

async function view(interaction) {
  const guildId = interaction.guildId;
  const name = interaction.options.getString('clan');
  let clan;

  if (name) {
    clan = await store.getClanByName(guildId, name);
    if (!clan) throw new UserError('No clan found with that name.');
  } else {
    const membership = await store.getMembership(guildId, interaction.user.id);
    if (!membership) throw new UserError('You are not in a clan. Pick one with the clan option or use /clans.');
    clan = await store.getClanById(membership.clan_id);
  }

  const roster = await store.getRoster(clan.id);
  await interaction.editReply({ embeds: [rosterEmbed(clan, roster)] });
}

async function add(interaction) {
  const guildId = interaction.guildId;
  const target = interaction.options.getUser('user');
  const slotOption = interaction.options.getString('slot');
  if (target.bot) throw new UserError('Bots cannot join a roster.');

  const clanRef = await resolveActingClan(interaction);

  const { clan, slot } = await tx(async (db) => {
    const clan = await store.getClanById(clanRef.id, db, true);
    if (!clan) throw new UserError('That clan no longer exists.');

    const existing = await store.getMembership(guildId, target.id, db);
    if (existing) {
      throw new UserError(
        existing.clan_id === clan.id ? `${target} is already on this roster.` : `${target} is already in ${existing.clan_name}.`
      );
    }

    const roster = await store.getRoster(clan.id, db);
    const taken = new Map(roster.map((r) => [r.slot, r.user_id]));
    let slot = slotOption;
    if (slot) {
      if (taken.has(slot)) {
        throw new UserError(`${slotLabel(slot)} is taken by <@${taken.get(slot)}>. Remove them first or use /roster move.`);
      }
    } else {
      slot = SLOTS.find((s) => !taken.has(s));
      if (!slot) throw new UserError('This roster is full.');
    }

    await db.query('INSERT INTO clan_members (clan_id, guild_id, user_id, slot) VALUES ($1, $2, $3, $4)', [
      clan.id,
      guildId,
      target.id,
      slot,
    ]);
    return { clan, slot };
  });

  await roles.give(interaction.guild, clan.role_id, target.id);
  await recordTransaction(interaction.guild, {
    type: 'add',
    title: 'Player Added',
    clan,
    actorId: interaction.user.id,
    lines: [`${target} was added to **${clan.name}**.`, `Slot: ${slotLabel(slot)}`, `By: ${interaction.user}`],
  });

  const roster = await store.getRoster(clan.id);
  await interaction.editReply({ content: `Added ${target} to ${clan.name}.`, embeds: [rosterEmbed(clan, roster)] });
}

async function remove(interaction) {
  const guildId = interaction.guildId;
  const target = interaction.options.getUser('user');
  const clanRef = await resolveActingClan(interaction);

  const { clan, slot } = await tx(async (db) => {
    const clan = await store.getClanById(clanRef.id, db, true);
    if (!clan) throw new UserError('That clan no longer exists.');
    const member = await store.getMember(clan.id, target.id, db);
    if (!member) throw new UserError(`${target} is not on this roster.`);
    if (clan.captain_id === target.id) {
      throw new UserError('You cannot remove the captain. Transfer captaincy first with /clan captain.');
    }
    await db.query('DELETE FROM clan_members WHERE clan_id = $1 AND user_id = $2', [clan.id, target.id]);
    return { clan, slot: member.slot };
  });

  await roles.take(interaction.guild, clan.role_id, target.id);
  await recordTransaction(interaction.guild, {
    type: 'remove',
    title: 'Player Removed',
    clan,
    actorId: interaction.user.id,
    lines: [`${target} was removed from **${clan.name}**.`, `Previous slot: ${slotLabel(slot)}`, `By: ${interaction.user}`],
  });

  const roster = await store.getRoster(clan.id);
  await interaction.editReply({ content: `Removed ${target} from ${clan.name}.`, embeds: [rosterEmbed(clan, roster)] });
}

async function move(interaction) {
  const target = interaction.options.getUser('user');
  const slot = interaction.options.getString('slot', true);
  const clanRef = await resolveActingClan(interaction);

  const { clan, from, occupant } = await tx(async (db) => {
    const clan = await store.getClanById(clanRef.id, db, true);
    if (!clan) throw new UserError('That clan no longer exists.');
    const member = await store.getMember(clan.id, target.id, db);
    if (!member) throw new UserError(`${target} is not on this roster.`);
    if (member.slot === slot) throw new UserError(`${target} is already in that slot.`);

    const roster = await store.getRoster(clan.id, db);
    const other = roster.find((r) => r.slot === slot);

    // The slot uniqueness check is deferred to commit, so a swap is safe.
    await db.query('UPDATE clan_members SET slot = $1 WHERE clan_id = $2 AND user_id = $3', [slot, clan.id, target.id]);
    if (other) {
      await db.query('UPDATE clan_members SET slot = $1 WHERE clan_id = $2 AND user_id = $3', [member.slot, clan.id, other.user_id]);
    }
    return { clan, from: member.slot, occupant: other ? other.user_id : null };
  });

  const lines = [`${target} moved from ${slotLabel(from)} to ${slotLabel(slot)} in **${clan.name}**.`];
  if (occupant) lines.push(`<@${occupant}> moved from ${slotLabel(slot)} to ${slotLabel(from)}.`);
  lines.push(`By: ${interaction.user}`);

  await recordTransaction(interaction.guild, {
    type: 'move',
    title: 'Roster Change',
    clan,
    actorId: interaction.user.id,
    lines,
  });

  const roster = await store.getRoster(clan.id);
  await interaction.editReply({ content: `Moved ${target} to ${slotLabel(slot)}.`, embeds: [rosterEmbed(clan, roster)] });
}

module.exports = {
  data,
  isPublic: (interaction) => interaction.options.getSubcommand() === 'view',
  autocomplete: handleAutocomplete,
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'view') return view(interaction);
    if (sub === 'add') return add(interaction);
    if (sub === 'remove') return remove(interaction);
    if (sub === 'move') return move(interaction);
  },
};
