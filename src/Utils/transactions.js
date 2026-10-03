const { EmbedBuilder } = require('discord.js');
const store = require('../store');

// Saves the move in the database history and posts it in the transactions channel.
async function recordTransaction(guild, { type, title, clan, lines, actorId }) {
  try {
    await store.logTransaction({
      guildId: guild.id,
      type,
      clanName: clan ? clan.name : null,
      summary: lines[0],
      actorId: actorId || null,
    });
  } catch (err) {
    console.error('Could not save transaction history:', err.message);
  }

  try {
    const config = await store.getConfig(guild.id);
    if (!config || !config.transactions_channel_id) return;
    const channel = await guild.channels.fetch(config.transactions_channel_id).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(lines.join('\n'))
      .setColor(clan ? clan.color : 0x808080)
      .setTimestamp();
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (err) {
    console.error('Could not post transaction:', err.message);
  }
}

module.exports = { recordTransaction };
