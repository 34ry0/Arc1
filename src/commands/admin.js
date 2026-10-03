const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const store = require('../store');
const { pool, tx } = require('../db');
const { UserError } = require('../utils/errors');
const { SLOTS, slotLabel, rosterEmbed } = require('../utils/format');
const { parseColor } = require('../utils/colors');
const { requireAdmin } = require('../utils/permissions');
const { recordTransaction } = require('../utils/transactions');
const { handleAutocomplete } = require('../utils/autocomplete');
const roles = require('../utils/roles');
const captains = require('../utils/captains');

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._~-]{1,23}$/;
const MAX_BACKUP_BYTES = 5 * 1024 * 1024;

const data = new SlashCommandBuilder()
  .setName('admin')
  .setDescription('Admin tools')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) =>
    s
      .setName('create-clan')
      .setDescription('Create an official clan')
      .addStringOption((o) => o.setName('name').setDescription('Clan name (2 to 24 characters)').setRequired(true))
      .addStringOption((o) =>
        o.setName('color').setDescription('Color name or hex code like #FF8800').setRequired(true).setAutocomplete(true)
      )
      .addUserOption((o) => o.setName('captain').setDescription('Clan captain').setRequired(true))
  )
  .addSubcommand((s) =>
    s
      .setName('delete-clan')
      .setDescription('Delete a clan and its roster')
      .addStringOption((o) => o.setName('name').setDescription('Clan to delete').setRequired(true).setAutocomplete(true))
      .addBooleanOption((o) => o.setName('confirm').setDescription('Set to True to confirm').setRequired(true))
  )
  .addSubcommand((s) =>
    s
      .setName('set-transactions-channel')
      .setDescription('Choose the channel where roster moves are posted')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Transactions channel')
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      )
  )
  .addSubcommand((s) =>
    s
      .setName('set-captain')
      .setDescription('Make someone the captain of a clan (adds them to the roster if needed)')
      .addUserOption((o) => o.setName('user').setDescription('New captain').setRequired(true))
      .addStringOption((o) => o.setName('clan').setDescription('Clan they will lead').setRequired(true).setAutocomplete(true))
  )
  .addSubcommand((s) =>
    s
      .setName('remove-captain')
      .setDescription('Take the captain role away from a clan captain (they stay on the roster)')
      .addStringOption((o) => o.setName('clan').setDescription('Clan to remove the captain from').setRequired(true).setAutocomplete(true))
  )
  .addSubcommand((s) =>
    s
      .setName('set-captain-role')
      .setDescription('Choose the Discord role given to clan captains')
      .addRoleOption((o) => o.setName('role').setDescription('Captain role').setRequired(true))
  )
  .addSubcommand((s) => s.setName('sync-captains').setDescription('Give the captain role to every current clan captain'))
  .addSubcommand((s) =>
    s
      .setName('set-matches-channel')
      .setDescription('Choose the channel where match announcements are posted')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Matches channel')
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      )
  )
  .addSubcommand((s) =>
    s
      .setName('history')
      .setDescription('Show recent roster moves')
      .addIntegerOption((o) => o.setName('amount').setDescription('How many entries (default 15, max 25)').setMinValue(1).setMaxValue(25))
  )
  .addSubcommand((s) => s.setName('backup').setDescription('Export all clan data to a JSON file'))
  .addSubcommand((s) =>
    s
      .setName('restore')
      .setDescription('Replace all clan data with the contents of a backup file')
      .addAttachmentOption((o) => o.setName('file').setDescription('Backup file from /admin backup').setRequired(true))
      .addBooleanOption((o) => o.setName('confirm').setDescription('Set to True to confirm').setRequired(true))
  );

async function createClan(interaction) {
  const guildId = interaction.guildId;
  const name = interaction.options.getString('name', true).trim().replace(/\s+/g, ' ');
  const color = parseColor(interaction.options.getString('color', true));
  const captain = interaction.options.getUser('captain', true);

  if (!NAME_PATTERN.test(name)) {
    throw new UserError('Clan names must be 2 to 24 characters and use only letters, numbers, spaces, dots, dashes, underscores or tildes.');
  }
  if (!color) throw new UserError('Unknown color. Pick one from the list or use a hex code like #FF8800.');
  if (captain.bot) throw new UserError('A bot cannot be captain.');

  const clan = await tx(async (db) => {
    if (await store.getClanByName(guildId, name, db)) throw new UserError('A clan with that name already exists.');
    const existing = await store.getMembership(guildId, captain.id, db);
    if (existing) throw new UserError(`${captain} is already in ${existing.clan_name}.`);

    const { rows } = await db.query(
      'INSERT INTO clans (guild_id, name, color, color_name, captain_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [guildId, name, color.value, color.name, captain.id]
    );
    await db.query("INSERT INTO clan_members (clan_id, guild_id, user_id, slot) VALUES ($1, $2, $3, '1')", [
      rows[0].id,
      guildId,
      captain.id,
    ]);
    return rows[0];
  });

  const roleId = await roles.create(interaction.guild, clan.name, clan.color);
  if (roleId) {
    await store.setClanRole(clan.id, roleId);
    clan.role_id = roleId;
    await roles.give(interaction.guild, roleId, captain.id);
  }
  await captains.give(interaction.guild, captain.id);

  await recordTransaction(interaction.guild, {
    type: 'clan_create',
    title: 'Clan Created',
    clan,
    actorId: interaction.user.id,
    lines: [`**${clan.name}** was created.`, `Captain: ${captain}`, `Color: ${clan.color_name}`, `By: ${interaction.user}`],
  });

  const roster = await store.getRoster(clan.id);
  await interaction.editReply({
    content: roleId
      ? `Created ${clan.name}.`
      : `Created ${clan.name}. The clan role could not be created (the bot needs the Manage Roles permission). The clan works without it.`,
    embeds: [rosterEmbed(clan, roster)],
  });
}

async function deleteClan(interaction) {
  const name = interaction.options.getString('name', true);
  if (!interaction.options.getBoolean('confirm', true)) {
    throw new UserError('Nothing was deleted. Set confirm to True to delete the clan.');
  }

  const clan = await store.getClanByName(interaction.guildId, name);
  if (!clan) throw new UserError('No clan found with that name.');
  const roster = await store.getRoster(clan.id);

  await tx(async (db) => {
    await db.query(
      "UPDATE matches SET status = 'cancelled', finished_at = now() WHERE status = 'live' AND (clan_a_id = $1 OR clan_b_id = $1)",
      [clan.id]
    );
    await db.query('DELETE FROM clans WHERE id = $1', [clan.id]);
  });
  await roles.remove(interaction.guild, clan.role_id);
  if (clan.captain_id) await captains.take(interaction.guild, clan.captain_id);

  const names = roster.map((m) => `<@${m.user_id}>`).join(', ') || 'nobody';
  await recordTransaction(interaction.guild, {
    type: 'clan_delete',
    title: 'Clan Deleted',
    clan,
    actorId: interaction.user.id,
    lines: [`**${clan.name}** was deleted.`, `Roster at the time: ${names}`, `By: ${interaction.user}`],
  });

  await interaction.editReply(`Deleted ${clan.name}.`);
}

async function setCaptain(interaction) {
  const guildId = interaction.guildId;
  const target = interaction.options.getUser('user', true);
  const clanName = interaction.options.getString('clan', true);
  if (target.bot) throw new UserError('A bot cannot be captain.');

  const found = await store.getClanByName(guildId, clanName);
  if (!found) throw new UserError('No clan found with that name.');

  const { clan, previous, addedSlot } = await tx(async (db) => {
    const clan = await store.getClanById(found.id, db, true);
    if (!clan) throw new UserError('That clan no longer exists.');

    const existing = await store.getMembership(guildId, target.id, db);
    if (existing && existing.clan_id !== clan.id) {
      throw new UserError(`${target} is already in ${existing.clan_name}. Remove them from that clan first.`);
    }
    if (clan.captain_id === target.id) throw new UserError(`${target} is already the captain of ${clan.name}.`);

    let addedSlot = null;
    if (!existing) {
      const roster = await store.getRoster(clan.id, db);
      const taken = new Set(roster.map((r) => r.slot));
      addedSlot = SLOTS.find((s) => !taken.has(s));
      if (!addedSlot) throw new UserError(`${clan.name} has a full roster. Free a spot first with /roster remove.`);
      await db.query('INSERT INTO clan_members (clan_id, guild_id, user_id, slot) VALUES ($1, $2, $3, $4)', [
        clan.id,
        guildId,
        target.id,
        addedSlot,
      ]);
    }

    await db.query('UPDATE clans SET captain_id = $1 WHERE id = $2', [target.id, clan.id]);
    return { clan: { ...clan, captain_id: target.id }, previous: clan.captain_id, addedSlot };
  });

  if (addedSlot) await roles.give(interaction.guild, clan.role_id, target.id);
  const gotRole = await captains.give(interaction.guild, target.id);
  if (previous) await captains.take(interaction.guild, previous);

  if (addedSlot) {
    await recordTransaction(interaction.guild, {
      type: 'add',
      title: 'Player Added',
      clan,
      actorId: interaction.user.id,
      lines: [`${target} was added to **${clan.name}**.`, `Slot: ${slotLabel(addedSlot)}`, `By: ${interaction.user}`],
    });
  }
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

  const roster = await store.getRoster(clan.id);
  await interaction.editReply({
    content: gotRole
      ? `${target} is now captain of ${clan.name}.`
      : `${target} is now captain of ${clan.name}, but I could not give them the captain role. Check that my role is above it and that I have Manage Roles. They can still use captain commands.`,
    embeds: [rosterEmbed(clan, roster)],
  });
}

async function removeCaptain(interaction) {
  const name = interaction.options.getString('clan', true);
  const found = await store.getClanByName(interaction.guildId, name);
  if (!found) throw new UserError('No clan found with that name.');

  const { clan, previous } = await tx(async (db) => {
    const clan = await store.getClanById(found.id, db, true);
    if (!clan) throw new UserError('That clan no longer exists.');
    if (!clan.captain_id) throw new UserError(`${clan.name} has no captain.`);
    await db.query('UPDATE clans SET captain_id = NULL WHERE id = $1', [clan.id]);
    return { clan: { ...clan, captain_id: null }, previous: clan.captain_id };
  });

  await captains.take(interaction.guild, previous);
  await recordTransaction(interaction.guild, {
    type: 'captain',
    title: 'Captain Change',
    clan,
    actorId: interaction.user.id,
    lines: [`**${clan.name}** has no captain now.`, `Previous captain: <@${previous}>`, `By: ${interaction.user}`],
  });
  await interaction.editReply(`${clan.name} has no captain now. <@${previous}> stays on the roster. Use /admin set-captain to pick a new one.`);
}

async function setCaptainRole(interaction) {
  const role = interaction.options.getRole('role', true);
  if (role.id === interaction.guildId) throw new UserError('Pick a real role, not @everyone.');
  if (role.managed) throw new UserError('That role is managed by an integration and cannot be given out.');
  if (!role.editable) {
    throw new UserError('I cannot manage that role. In Server Settings > Roles, drag my bot role above it and make sure I have Manage Roles.');
  }
  await store.setCaptainRole(interaction.guildId, role.id);
  await interaction.editReply(`The captain role is now ${role}. Run /admin sync-captains to give it to the current captains.`);
}

async function syncCaptains(interaction) {
  const clans = (await store.listClans(interaction.guildId)).filter((c) => c.captain_id);
  if (!clans.length) throw new UserError('No clan has a captain yet.');

  const roleId = await captains.ensureCaptainRole(interaction.guild);
  if (!roleId) throw new UserError('I could not create or find the captain role. I need the Manage Roles permission.');

  let given = 0;
  const failed = [];
  for (const clan of clans) {
    if (await roles.give(interaction.guild, roleId, clan.captain_id)) given++;
    else failed.push(`<@${clan.captain_id}> (${clan.name})`);
  }

  let text = `Captain role given to ${given} of ${clans.length} captains.`;
  if (failed.length) {
    text += ` I could not give it to: ${failed.join(', ')}. They may have left the server, or my role is below the captain role.`;
  }
  await interaction.editReply(text);
}

function pickPostableChannel(interaction) {
  const channel = interaction.options.getChannel('channel', true);
  const perms = channel.permissionsFor(interaction.guild.members.me);
  if (!perms || !perms.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
    throw new UserError('I need View Channel, Send Messages and Embed Links in that channel first.');
  }
  return channel;
}

async function setTransactionsChannel(interaction) {
  const channel = pickPostableChannel(interaction);
  await store.setTransactionsChannel(interaction.guildId, channel.id);
  await interaction.editReply(`Roster moves will be posted in ${channel}.`);
}

async function setMatchesChannel(interaction) {
  const channel = pickPostableChannel(interaction);
  await store.setMatchesChannel(interaction.guildId, channel.id);
  await interaction.editReply(`Match announcements will be posted in ${channel}.`);
}

async function history(interaction) {
  const amount = interaction.options.getInteger('amount') || 15;
  const rows = await store.recentTransactions(interaction.guildId, amount);
  if (!rows.length) throw new UserError('No roster moves have been recorded yet.');

  const lines = rows.map((r) => {
    const when = Math.floor(new Date(r.created_at).getTime() / 1000);
    return `<t:${when}:f> ${r.summary}`;
  });
  const embed = new EmbedBuilder().setTitle('Recent Moves').setColor(0x808080).setDescription(lines.join('\n').slice(0, 4000));
  await interaction.editReply({ embeds: [embed] });
}

async function backup(interaction) {
  const guildId = interaction.guildId;
  const [config, clans, members, transactions, matches, games] = await Promise.all([
    store.getConfig(guildId),
    store.listClans(guildId),
    store.listMembers(guildId),
    pool.query('SELECT type, clan_name, summary, actor_id, created_at FROM transactions_log WHERE guild_id = $1 ORDER BY id', [guildId]),
    pool.query('SELECT * FROM matches WHERE guild_id = $1 ORDER BY id', [guildId]),
    pool.query('SELECT g.* FROM match_games g JOIN matches m ON m.id = g.match_id WHERE m.guild_id = $1 ORDER BY g.id', [guildId]),
  ]);

  const payload = {
    app: 'ar1c-bot',
    version: 1,
    exported_at: new Date().toISOString(),
    guild_id: guildId,
    config: {
      transactions_channel_id: config ? config.transactions_channel_id : null,
      matches_channel_id: config ? config.matches_channel_id : null,
      captain_role_id: config ? config.captain_role_id : null,
    },
    clans: clans.map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      color_name: c.color_name,
      role_id: c.role_id,
      captain_id: c.captain_id,
      created_at: c.created_at,
    })),
    members: members.map((m) => ({ clan_id: m.clan_id, user_id: m.user_id, slot: m.slot, joined_at: m.joined_at })),
    transactions: transactions.rows,
    matches: matches.rows,
    games: games.rows,
  };

  const file = new AttachmentBuilder(Buffer.from(JSON.stringify(payload, null, 2)), {
    name: `ar1c-backup-${new Date().toISOString().slice(0, 10)}.json`,
  });
  await interaction.editReply({
    content: `Backup ready: ${clans.length} clan${clans.length === 1 ? '' : 's'}, ${members.length} roster spot${members.length === 1 ? '' : 's'}. Keep this file somewhere safe.`,
    files: [file],
  });
}

function validateBackup(data, guildId) {
  const bad = () => new UserError('That file is not a valid backup.');
  if (!data || data.app !== 'ar1c-bot' || data.version !== 1) throw bad();
  if (data.guild_id !== guildId) throw new UserError('That backup belongs to a different server.');
  if (!Array.isArray(data.clans) || !Array.isArray(data.members)) throw bad();

  for (const c of data.clans) {
    if (!c || typeof c.name !== 'string' || !NAME_PATTERN.test(c.name)) throw bad();
    if (!Number.isInteger(c.color) || typeof c.color_name !== 'string') throw bad();
  }
  const names = new Set(data.clans.map((c) => c.name.toLowerCase()));
  if (names.size !== data.clans.length) throw bad();
  for (const m of data.members) {
    if (!m || typeof m.user_id !== 'string' || !/^\d+$/.test(m.user_id) || !SLOTS.includes(m.slot)) throw bad();
  }

  // Older backups have no match data, so these fields are optional.
  if (data.matches !== undefined) {
    if (!Array.isArray(data.matches) || (data.games !== undefined && !Array.isArray(data.games))) throw bad();
    for (const m of data.matches) {
      const okStatus = m && ['live', 'finished', 'cancelled'].includes(m.status);
      if (!okStatus || typeof m.clan_a_name !== 'string' || typeof m.clan_b_name !== 'string') throw bad();
    }
    for (const g of data.games || []) {
      const okWinner = g && (g.winner_side == null || ['a', 'b'].includes(g.winner_side));
      const okPlayers = g && /^\d+$/.test(String(g.player_a)) && /^\d+$/.test(String(g.player_b));
      if (!okWinner || !okPlayers || !Number.isInteger(g.game_number) || !['live', 'finished'].includes(g.status)) throw bad();
    }
  }
}

async function restore(interaction) {
  if (!interaction.options.getBoolean('confirm', true)) {
    throw new UserError('Nothing was restored. Set confirm to True to replace the current clan data.');
  }
  const attachment = interaction.options.getAttachment('file', true);
  if (attachment.size > MAX_BACKUP_BYTES) throw new UserError('That file is too large to be a backup.');

  let parsed;
  try {
    const res = await fetch(attachment.url);
    parsed = JSON.parse(await res.text());
  } catch {
    throw new UserError('I could not read that file. Upload the JSON file created by /admin backup.');
  }
  validateBackup(parsed, interaction.guildId);

  const guildId = interaction.guildId;
  const counts = await tx(async (db) => {
    await db.query('DELETE FROM clans WHERE guild_id = $1', [guildId]);

    const idMap = new Map();
    for (const c of parsed.clans) {
      const { rows } = await db.query(
        `INSERT INTO clans (guild_id, name, color, color_name, role_id, captain_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now())) RETURNING id`,
        [guildId, c.name, c.color, c.color_name, c.role_id || null, c.captain_id || null, c.created_at || null]
      );
      idMap.set(c.id, rows[0].id);
    }

    let restored = 0;
    for (const m of parsed.members) {
      const clanId = idMap.get(m.clan_id);
      if (!clanId) continue;
      await db.query(
        'INSERT INTO clan_members (clan_id, guild_id, user_id, slot, joined_at) VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now()))',
        [clanId, guildId, m.user_id, m.slot, m.joined_at || null]
      );
      restored++;
    }

    const cfg = parsed.config || {};
    if (cfg.transactions_channel_id) await store.setTransactionsChannel(guildId, cfg.transactions_channel_id, db);
    if (cfg.matches_channel_id) await store.setMatchesChannel(guildId, cfg.matches_channel_id, db);
    if (cfg.captain_role_id) await store.setCaptainRole(guildId, cfg.captain_role_id, db);

    // Match history is never wiped by a restore. If this server has none (fresh database), import it from the backup.
    // Otherwise keep what is there and just re-link it to the restored clans by name.
    const { rows: haveMatches } = await db.query('SELECT 1 FROM matches WHERE guild_id = $1 LIMIT 1', [guildId]);
    if (!haveMatches.length && Array.isArray(parsed.matches)) {
      const matchIdMap = new Map();
      for (const m of parsed.matches) {
        const { rows } = await db.query(
          `INSERT INTO matches (guild_id, clan_a_id, clan_b_id, clan_a_name, clan_b_name, planned_games, status, started_by, created_at, finished_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::timestamptz, now()), $10::timestamptz) RETURNING id`,
          [
            guildId,
            idMap.get(m.clan_a_id) || null,
            idMap.get(m.clan_b_id) || null,
            m.clan_a_name,
            m.clan_b_name,
            m.planned_games || null,
            m.status,
            m.started_by || null,
            m.created_at || null,
            m.finished_at || null,
          ]
        );
        matchIdMap.set(m.id, rows[0].id);
      }
      for (const g of parsed.games || []) {
        const matchId = matchIdMap.get(g.match_id);
        if (!matchId) continue;
        await db.query(
          `INSERT INTO match_games (match_id, game_number, player_a, player_b, status, winner_side, created_at, finished_at)
           VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()), $8::timestamptz)`,
          [matchId, g.game_number, String(g.player_a), String(g.player_b), g.status, g.winner_side || null, g.created_at || null, g.finished_at || null]
        );
      }
    } else {
      await db.query(
        `UPDATE matches m SET clan_a_id = c.id FROM clans c
         WHERE m.guild_id = $1 AND c.guild_id = $1 AND m.clan_a_id IS NULL AND lower(c.name) = lower(m.clan_a_name)`,
        [guildId]
      );
      await db.query(
        `UPDATE matches m SET clan_b_id = c.id FROM clans c
         WHERE m.guild_id = $1 AND c.guild_id = $1 AND m.clan_b_id IS NULL AND lower(c.name) = lower(m.clan_b_name)`,
        [guildId]
      );
    }
    await db.query(
      "UPDATE matches SET status = 'cancelled', finished_at = now() WHERE guild_id = $1 AND status = 'live' AND (clan_a_id IS NULL OR clan_b_id IS NULL)",
      [guildId]
    );
    return { clans: parsed.clans.length, members: restored };
  });

  await recordTransaction(interaction.guild, {
    type: 'restore',
    title: 'Data Restored',
    clan: null,
    actorId: interaction.user.id,
    lines: [`Clan data was restored from a backup: ${counts.clans} clans, ${counts.members} roster spots.`, `By: ${interaction.user}`],
  });

  await interaction.editReply(`Restored ${counts.clans} clans and ${counts.members} roster spots from the backup.`);
}

module.exports = {
  data,
  autocomplete: handleAutocomplete,
  async execute(interaction) {
    requireAdmin(interaction);
    const sub = interaction.options.getSubcommand();
    if (sub === 'create-clan') return createClan(interaction);
    if (sub === 'delete-clan') return deleteClan(interaction);
    if (sub === 'set-transactions-channel') return setTransactionsChannel(interaction);
    if (sub === 'set-matches-channel') return setMatchesChannel(interaction);
    if (sub === 'set-captain') return setCaptain(interaction);
    if (sub === 'remove-captain') return removeCaptain(interaction);
    if (sub === 'set-captain-role') return setCaptainRole(interaction);
    if (sub === 'sync-captains') return syncCaptains(interaction);
    if (sub === 'history') return history(interaction);
    if (sub === 'backup') return backup(interaction);
    if (sub === 'restore') return restore(interaction);
  },
};
