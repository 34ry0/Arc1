const { SlashCommandBuilder } = require('discord.js');
const store = require('../store');
const { clanListEmbeds } = require('../Utils/format');

module.exports = {
  data: new SlashCommandBuilder().setName('clans').setDescription('List every clan and its roster'),
  isPublic: () => true,
  async execute(interaction) {
    const clans = await store.listClans(interaction.guildId);
    const members = await store.listMembers(interaction.guildId);
    const embeds = clanListEmbeds(clans, members);

    // Discord caps the combined size of embeds in one message, so send 3 at a time.
    for (let i = 0; i < embeds.length; i += 3) {
      const payload = { embeds: embeds.slice(i, i + 3) };
      if (i === 0) await interaction.editReply(payload);
      else await interaction.followUp(payload);
    }
  },
};
