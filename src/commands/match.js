const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const store = require('../store');
const { tx } = require('../db');
const { UserError } = require('../Utils/errors');
const { resolveActingClan } = require('../Utils/permissions');
const { handleAutocomplete } = require('../Utils/autocomplete');

const GREY = 0x808080;

const adminClanOption = (o) =>
  o.setName('clan').setDescription('Admins only: act for this clan instead of your own').setAutocomplete(true);

const data = new SlashCommandBuilder()
  .setName('match')
  .setDescription('Announce and track clan matches')
  .addSubcommand((s) =>
    s
      .setName('start')
      .setDescription('Captains: announce a match against another clan')
      .addStringOption((o) => o.setName('opponent').setDescription('Clan you are fighting').setRequired(true).setAutocomplete(true))
      .addIntegerOption((o) => o.setName('games').setDescription('Number of 1v1 games planned').setMinValue(1).setMaxValue(15))
      .addStringOption(adminClanOption)
  )
  .addSubcommand((s) =>
    s
      .setName('fight')
      .setDescription('Captains: announce who is facing who in the next game')
      .addUserOption((o) => o.setName('player').setDescription('A player from one clan').setRequired(true))
      .addUserOption((o) => o.setName('versus').setDescription('The player they face from the other clan').setRequired(true))
      .addStringOption(adminClanOption)
  )
  .addSubcommand((s) =>
    s
      .setName('result')
      .setDescription('Captains: announce who won the current game')
      .addUserOption((o) => o.setName('winner').setDescription('Winner of the current game').setRequired(true))
      .addStringOption(adminClanOption)
  )
  .addSubcommand((s) =>
    s.setName('undo').setDescription('Captains: remove the latest game (use it to fix a mistake)').addStringOption(adminClanOption)
  )
  .addSubcommand((s) =>
    s.setName('end').setDescription('Captains: finish the match and announce the final result').addStringOption(adminClanOption)
  )
  .addSubcommand((s) =>
    s.setName('cancel').setDescription('Captains: cancel the match without a result').addStringOption(adminClanOption)
  )
  .addSubcommand((s) =>
    s
      .setName('announce')
      .setDescription('Captains: post a short update about the match')
      .addStringOption((o) => o.setName('text').setDescription('Message to post').setRequired(true).setMaxLength(300))
      .addStringOption(adminClanOption)
  )
  .addSubcommand((s) =>
    s
      .setName('status')
      .setDescription('Show the current or latest match of a clan')
      .addStringOption((o) => o.setName('clan').setDescription('Clan name (defaults to your clan)').setAutocomplete(true))
  )
  .addSubcommand((s) => s.setName('live').setDescription('Show every match in progress'));

// ---------- helpers ----------

const who = (id) => `<@${id}>`;
const versus = (m) => `**${m.clan_a_name}** vs **${m.clan_b_name}**`;
const scoreText = (m, s) => `${m.clan_a_name} ${s.a} - ${s.b} ${m.clan_b_name}`;
const winnerId = (g) => (g.winner_side === 'a' ? g.player_a : g.player_b);
const loserId = (g) => (g.winner_side === 'a' ? g.player_b : g.player_a);

function tally(games) {
  let a = 0;
  let b = 0;
  for (const g of games) {
    if (g.status !== 'finished') continue;
    if (g.winner_side === 'a') a++;
    else if (g.winner_side === 'b') b++;
  }
  return { a, b };
}

// Returns 'a', 'b' or 'draw'.
function leader(score) {
  if (score.a === score.b) return 'draw';
  return score.a > score.b ? 'a' : 'b';
}

function outcomeText(match, score) {
  const side = leader(score);
  if (side === 'draw') return `**${match.clan_a_name}** and **${match.clan_b_name}** tied ${score.a}-${score.b}.`;
  const win = side === 'a' ? match.clan_a_name : match.clan_b_name;
  const lose = side === 'a' ? match.clan_b_name : match.clan_a_name;
  const high = Math.max(score.a, score.b);
  const low = Math.min(score.a, score.b);
  return `**${win}** defeated **${lose}**, ${high}-${low}.`;
}

async function sideColor(match, side) {
  const id = side === 'a' ? match.clan_a_id : match.clan_b_id;
  if (!id) return GREY;
  const clan = await store.getClanById(id);
  return clan ? clan.color : GREY;
}

function gameSummary(g) {
  return `Game ${g.game_number}: ${who(winnerId(g))} defeated ${who(loserId(g))}`;
}

async function lockLive(db, matchId) {
  const match = await store.getMatchById(matchId, db, true);
  if (!match || match.status !== 'live') throw new UserError('That match is no longer in progress.');
  return match;
}

async function resolveMatch(interaction) {
  const clan = await resolveActingClan(interaction);
  const match = await store.getLiveMatchForClan(clan.id);
  if (!match) throw new UserError(`${clan.name} has no match in progress. Start one with /match start.`);
  return match;
}

// Posts in the matches channel, or in the channel where the command was used.
async function post(interaction, embed) {
  try {
    const config = await store.getConfig(interaction.guildId);
    let channel = null;
    if (config && config.matches_channel_id) {
      channel = await interaction.guild.channels.fetch(config.matches_channel_id).catch(() => null);
    }
    if (!channel) channel = interaction.channel;
    if (!channel || !channel.isTextBased()) return null;
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    return channel;
  } catch (err) {
    console.error('Could not post match announcement:', err.message);
    return null;
  }
}

async function announce(interaction, embed, doneText) {
  const channel = await post(interaction, embed);
  await interaction.editReply(
    channel ? `${doneText} Posted in ${channel}.` : `${doneText} I could not post the announcement, check my permissions in the matches channel.`
  );
}

function statusEmbed(match, games) {
  const score = tally(games);
  const live = games.find((g) => g.status === 'live');
  const done = games.filter((g) => g.status === 'finished');
  const statusText = { live: 'In progress', finished: 'Finished', cancelled: 'Cancelled' }[match.status];

  const lines = [`Status: ${statusText}`, `Score: ${scoreText(match, score)}`];
  if (match.planned_games) lines.push(`Games planned: ${match.planned_games}`);
  if (live) lines.push(`Current game: Game ${live.game_number}, ${who(live.player_a)} vs ${who(live.player_b)}`);
  else if (match.status === 'live') lines.push('Current game: none announced yet');
  if (match.status === 'finished') lines.push(outcomeText(match, score));
  if (done.length) lines.push('', ...done.map(gameSummary));

  return new EmbedBuilder()
    .setTitle(`${match.clan_a_name} vs ${match.clan_b_name}`)
    .setDescription(lines.join('\n'))
    .setColor(GREY);
}

// ---------- subcommands ----------

async function start(interaction) {
  const guildId = interaction.guildId;
  const opponentName = interaction.options.getString('opponent', true);
  const planned = interaction.options.getInteger('games');
  const clanRef = await resolveActingClan(interaction);

  const opponent = await store.getClanByName(guildId, opponentName);
  if (!opponent) throw new UserError('No clan found with that name.');
  if (opponent.id === clanRef.id) throw new UserError('A clan cannot fight itself.');

  const match = await tx(async (db) => {
    const ids = [clanRef.id, opponent.id].sort((x, y) => x - y);
    const { rows: locked } = await db.query('SELECT * FROM clans WHERE id = ANY($1) ORDER BY id FOR UPDATE', [ids]);
    if (locked.length !== 2) throw new UserError('One of those clans no longer exists.');

    for (const clan of locked) {
      if (await store.getLiveMatchForClan(clan.id, db)) {
        throw new UserError(`${clan.name} already has a match in progress. It has to be ended or cancelled first.`);
      }
    }

    const a = locked.find((c) => c.id === clanRef.id);
    const b = locked.find((c) => c.id === opponent.id);
    const { rows } = await db.query(
      `INSERT INTO matches (guild_id, clan_a_id, clan_b_id, clan_a_name, clan_b_name, planned_games, started_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [guildId, a.id, b.id, a.name, b.name, planned, interaction.user.id]
    );
    return rows[0];
  });

  const lines = [versus(match)];
  if (planned) lines.push(`Games planned: ${planned}`);
  lines.push(`Announced by: ${interaction.user}`);
  const embed = new EmbedBuilder().setTitle('Match Started').setDescription(lines.join('\n')).setColor(await sideColor(match, 'a'));

  await announce(interaction, embed, `Match started: ${match.clan_a_name} vs ${match.clan_b_name}.`);
}

async function fight(interaction) {
  const p1 = interaction.options.getUser('player', true);
  const p2 = interaction.options.getUser('versus', true);
  if (p1.id === p2.id) throw new UserError('Pick two different players.');
  if (p1.bot || p2.bot) throw new UserError('Bots cannot play.');
  const found = await resolveMatch(interaction);

  const { match, game, games } = await tx(async (db) => {
    const match = await lockLive(db, found.id);
    const games = await store.getGames(match.id, db);
    const open = games.find((g) => g.status === 'live');
    if (open) {
      throw new UserError(`Game ${open.game_number} is still live. Report it with /match result, or remove it with /match undo.`);
    }

    const p1A = await store.getMember(match.clan_a_id, p1.id, db);
    const p1B = await store.getMember(match.clan_b_id, p1.id, db);
    const p2A = await store.getMember(match.clan_a_id, p2.id, db);
    const p2B = await store.getMember(match.clan_b_id, p2.id, db);

    let playerA;
    let playerB;
    if (p1A && p2B) {
      playerA = p1;
      playerB = p2;
    } else if (p1B && p2A) {
      playerA = p2;
      playerB = p1;
    } else {
      throw new UserError(`One player has to be on the ${match.clan_a_name} roster and the other on the ${match.clan_b_name} roster.`);
    }

    const { rows } = await db.query(
      `INSERT INTO match_games (match_id, game_number, player_a, player_b)
       VALUES ($1, (SELECT COALESCE(MAX(game_number), 0) + 1 FROM match_games WHERE match_id = $1), $2, $3) RETURNING *`,
      [match.id, playerA.id, playerB.id]
    );
    return { match, game: rows[0], games };
  });

  const score = tally(games);
  const embed = new EmbedBuilder()
    .setTitle(`Game ${game.game_number}`)
    .setDescription(
      [
        versus(match),
        `${who(game.player_a)} (${match.clan_a_name}) vs ${who(game.player_b)} (${match.clan_b_name})`,
        `Score: ${scoreText(match, score)}`,
      ].join('\n')
    )
    .setColor(GREY);

  await announce(interaction, embed, `Game ${game.game_number} announced.`);
}

async function result(interaction) {
  const winner = interaction.options.getUser('winner', true);
  const found = await resolveMatch(interaction);

  const { match, game, games } = await tx(async (db) => {
    const match = await lockLive(db, found.id);
    const current = (await store.getGames(match.id, db)).find((g) => g.status === 'live');
    if (!current) throw new UserError('There is no live game. Announce one with /match fight first.');

    let side;
    if (winner.id === current.player_a) side = 'a';
    else if (winner.id === current.player_b) side = 'b';
    else throw new UserError(`The winner has to be ${who(current.player_a)} or ${who(current.player_b)}, the players in Game ${current.game_number}.`);

    const { rows } = await db.query(
      "UPDATE match_games SET status = 'finished', winner_side = $1, finished_at = now() WHERE id = $2 RETURNING *",
      [side, current.id]
    );
    return { match, game: rows[0], games: await store.getGames(match.id, db) };
  });

  const score = tally(games);
  const winnerClan = game.winner_side === 'a' ? match.clan_a_name : match.clan_b_name;
  const embed = new EmbedBuilder()
    .setTitle(`Game ${game.game_number} Result`)
    .setDescription(
      [
        versus(match),
        `${who(winnerId(game))} defeated ${who(loserId(game))}. Point for **${winnerClan}**.`,
        `Score: ${scoreText(match, score)}`,
      ].join('\n')
    )
    .setColor(await sideColor(match, game.winner_side));

  await announce(interaction, embed, `Game ${game.game_number} result announced.`);
}

async function undo(interaction) {
  const found = await resolveMatch(interaction);

  const { match, removed, games } = await tx(async (db) => {
    const match = await lockLive(db, found.id);
    const all = await store.getGames(match.id, db);
    const last = all[all.length - 1];
    if (!last) throw new UserError('There are no games to remove.');
    await db.query('DELETE FROM match_games WHERE id = $1', [last.id]);
    return { match, removed: last, games: all.slice(0, -1) };
  });

  const embed = new EmbedBuilder()
    .setTitle('Game Removed')
    .setDescription(
      [
        versus(match),
        `Game ${removed.game_number} (${who(removed.player_a)} vs ${who(removed.player_b)}) was removed by ${interaction.user}.`,
        `Score: ${scoreText(match, tally(games))}`,
      ].join('\n')
    )
    .setColor(GREY);

  await announce(interaction, embed, `Game ${removed.game_number} removed.`);
}

async function end(interaction) {
  const found = await resolveMatch(interaction);

  const { match, games } = await tx(async (db) => {
    const match = await lockLive(db, found.id);
    const games = await store.getGames(match.id, db);
    const open = games.find((g) => g.status === 'live');
    if (open) throw new UserError(`Game ${open.game_number} is still live. Report it with /match result or remove it with /match undo first.`);
    if (!games.length) throw new UserError('No games have been played. Use /match cancel instead.');
    await db.query("UPDATE matches SET status = 'finished', finished_at = now() WHERE id = $1", [match.id]);
    return { match, games };
  });

  const score = tally(games);
  const side = leader(score);
  const lines = [outcomeText(match, score), `Final score: ${scoreText(match, score)}`, '', ...games.map(gameSummary)];
  const embed = new EmbedBuilder()
    .setTitle('Match Finished')
    .setDescription(lines.join('\n'))
    .setColor(side === 'draw' ? GREY : await sideColor(match, side));

  await announce(interaction, embed, 'Match finished.');
}

async function cancel(interaction) {
  const found = await resolveMatch(interaction);

  const { match, games } = await tx(async (db) => {
    const match = await lockLive(db, found.id);
    await db.query("UPDATE matches SET status = 'cancelled', finished_at = now() WHERE id = $1", [match.id]);
    return { match, games: await store.getGames(match.id, db) };
  });

  const embed = new EmbedBuilder()
    .setTitle('Match Cancelled')
    .setDescription(
      [versus(match), `This match was cancelled by ${interaction.user} with no result.`, `Score when cancelled: ${scoreText(match, tally(games))}`].join('\n')
    )
    .setColor(GREY);

  await announce(interaction, embed, 'Match cancelled.');
}

async function say(interaction) {
  const text = interaction.options.getString('text', true).trim();
  if (!text) throw new UserError('The message is empty.');
  const match = await resolveMatch(interaction);

  const embed = new EmbedBuilder()
    .setTitle('Match Update')
    .setDescription([versus(match), '', text, '', `By: ${interaction.user}`].join('\n'))
    .setColor(GREY);

  await announce(interaction, embed, 'Update sent.');
}

async function status(interaction) {
  const guildId = interaction.guildId;
  const name = interaction.options.getString('clan');
  let clan;

  if (name) {
    clan = await store.getClanByName(guildId, name);
    if (!clan) throw new UserError('No clan found with that name.');
  } else {
    const membership = await store.getMembership(guildId, interaction.user.id);
    if (!membership) throw new UserError('You are not in a clan. Pick one with the clan option or use /match live.');
    clan = await store.getClanById(membership.clan_id);
  }

  const match = await store.getLatestMatchForClan(clan.id);
  if (!match) throw new UserError(`${clan.name} has not played any matches yet.`);
  const games = await store.getGames(match.id);
  await interaction.editReply({ embeds: [statusEmbed(match, games)] });
}

async function live(interaction) {
  const matches = await store.listLiveMatches(interaction.guildId);
  if (!matches.length) {
    await interaction.editReply('No matches are in progress right now.');
    return;
  }

  const games = await store.getGamesForMatches(matches.map((m) => m.id));
  const embed = new EmbedBuilder().setTitle('Matches In Progress').setColor(GREY);
  for (const m of matches.slice(0, 25)) {
    const own = games.filter((g) => g.match_id === m.id);
    const open = own.find((g) => g.status === 'live');
    const lines = [`Score: ${scoreText(m, tally(own))}`];
    lines.push(open ? `Game ${open.game_number}: ${who(open.player_a)} vs ${who(open.player_b)}` : 'No game announced yet');
    embed.addFields({ name: `${m.clan_a_name} vs ${m.clan_b_name}`, value: lines.join('\n') });
  }
  await interaction.editReply({ embeds: [embed] });
}

module.exports = {
  data,
  isPublic: (interaction) => ['status', 'live'].includes(interaction.options.getSubcommand()),
  autocomplete: handleAutocomplete,
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'start') return start(interaction);
    if (sub === 'fight') return fight(interaction);
    if (sub === 'result') return result(interaction);
    if (sub === 'undo') return undo(interaction);
    if (sub === 'end') return end(interaction);
    if (sub === 'cancel') return cancel(interaction);
    if (sub === 'announce') return say(interaction);
    if (sub === 'status') return status(interaction);
    if (sub === 'live') return live(interaction);
  },
};
