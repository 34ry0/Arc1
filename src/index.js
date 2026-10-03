const { Client, GatewayIntentBits, Events, MessageFlags, REST, Routes } = require('discord.js');
const { pool, connectWithRetry, migrate } = require('./db');
const store = require('./store');
const commands = require('./commands');
const { UserError } = require('./Utils/errors');
const { recordTransaction } = require('./Utils/transactions');
const { slotLabel } = require('./Utils/format');

for (const key of ['DISCORD_TOKEN', 'CLIENT_ID', 'DATABASE_URL']) {
  if (!process.env[key]) {
    console.error(`Missing environment variable: ${key}`);
    process.exit(1);
  }
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  allowedMentions: { parse: [] },
});

async function registerCommands() {
  const rest = new REST().setToken(process.env.DISCORD_TOKEN);
  const body = [...commands.values()].map((c) => c.data.toJSON());
  const route = process.env.GUILD_ID
    ? Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID)
    : Routes.applicationCommands(process.env.CLIENT_ID);
  try {
    await rest.put(route, { body });
    console.log(`Registered ${body.length} commands.`);
  } catch (err) {
    console.error('Command registration failed:', err.message);
  }
}

client.once(Events.ClientReady, (c) => console.log(`Logged in as ${c.user.tag}`));

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) {
    const command = commands.get(interaction.commandName);
    try {
      if (command && command.autocomplete) await command.autocomplete(interaction);
    } catch (err) {
      console.error('Autocomplete error:', err.message);
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  const command = commands.get(interaction.commandName);
  if (!command) return;

  if (!interaction.inGuild()) {
    await interaction.reply({ content: 'These commands only work inside a server.', flags: MessageFlags.Ephemeral });
    return;
  }

  const isPublic = command.isPublic ? command.isPublic(interaction) : false;
  try {
    await interaction.deferReply(isPublic ? {} : { flags: MessageFlags.Ephemeral });
    await command.execute(interaction);
  } catch (err) {
    let message = 'Something went wrong. Try again in a moment.';
    if (err instanceof UserError) message = err.message;
    else if (err && err.code === '23505') message = 'That roster was just changed by someone else. Try again.';
    else console.error(`Error in /${interaction.commandName}:`, err);

    try {
      const payload = { content: message, embeds: [], files: [] };
      if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
      else await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    } catch (replyErr) {
      console.error('Could not send error reply:', replyErr.message);
    }
  }
});

// Someone left the Discord server: free their roster spot so it does not stay blocked.
client.on(Events.GuildMemberRemove, async (member) => {
  try {
    const result = await store.removeDeparted(member.guild.id, member.id);
    if (!result) return;
    const lines = [`<@${member.id}> left the server and was removed from **${result.clan.name}**.`, `Previous slot: ${slotLabel(result.slot)}`];
    if (result.wasCaptain) lines.push('This clan has no captain now. An admin needs to assign one.');
    await recordTransaction(member.guild, { type: 'leave', title: 'Player Left', clan: result.clan, lines });
  } catch (err) {
    console.error('Member removal handling failed:', err.message);
  }
});

process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));

async function shutdown() {
  console.log('Shutting down.');
  try {
    await client.destroy();
    await pool.end();
  } finally {
    process.exit(0);
  }
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

(async () => {
  await connectWithRetry();
  await migrate();
  await registerCommands();
  await client.login(process.env.DISCORD_TOKEN);
})().catch((err) => {
  console.error('Startup failed:', err);
  process.exit(1);
});
