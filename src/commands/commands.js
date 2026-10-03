const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder().setName('commands').setDescription('Show every command and who can use it'),
  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('Command List')
      .setColor(0x808080)
      .addFields(
        {
          name: 'Everyone',
          value: [
            '/clans - List every clan and its roster',
            '/roster view [clan] - Show one roster',
            '/match status [clan] - Show the current or latest match of a clan',
            '/match live - Show every match in progress',
            '/clan leave - Leave your clan',
            '/commands - Show this list',
          ].join('\n'),
        },
        {
          name: 'Captains',
          value: [
            '/roster add user [slot] - Add a player to your roster',
            '/roster remove user - Remove a player from your roster',
            '/roster move user slot - Move a player to another slot, swaps if taken',
            '/clan captain user - Hand the captain role to someone on your roster',
            '/match start opponent [games] - Announce a match against another clan',
            '/match fight player versus - Announce who is facing who in the next game',
            '/match result winner - Announce who won the current game',
            '/match undo - Remove the latest game to fix a mistake',
            '/match end - Finish the match and announce the final result',
            '/match cancel - Cancel the match with no result',
            '/match announce text - Post a short update about the match',
          ].join('\n'),
        },
        {
          name: 'Admins',
          value: [
            '/admin create-clan name color captain - Create an official clan',
            '/admin set-captain user clan - Make someone captain of a clan, adds them to the roster if needed',
            '/admin remove-captain clan - Remove the captain of a clan, they stay on the roster',
            '/admin set-captain-role role - Choose the Discord role given to captains',
            '/admin sync-captains - Give the captain role to every current captain',
            '/admin delete-clan name confirm - Delete a clan',
            '/admin set-transactions-channel channel - Choose where roster moves are posted',
            '/admin set-matches-channel channel - Choose where match announcements are posted',
            '/admin history [amount] - Show recent roster moves',
            '/admin backup - Export all clan data to a file',
            '/admin restore file confirm - Restore clan data from a backup file',
            'Admins can also add the clan option to captain commands to act on any clan.',
          ].join('\n'),
        }
      );
    await interaction.editReply({ embeds: [embed] });
  },
};
