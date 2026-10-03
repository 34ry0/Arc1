const store = require('../store');
const { COLOR_NAMES } = require('./colors');

async function handleAutocomplete(interaction) {
  const focused = interaction.options.getFocused(true);

  if (focused.name === 'color') {
    const text = String(focused.value).toLowerCase();
    const matches = COLOR_NAMES.filter((n) => n.toLowerCase().includes(text)).slice(0, 25);
    return interaction.respond(matches.map((n) => ({ name: n, value: n })));
  }

  if (!interaction.guildId) return interaction.respond([]);
  const names = await store.searchClanNames(interaction.guildId, focused.value);
  return interaction.respond(names.map((n) => ({ name: n, value: n })));
}

module.exports = { handleAutocomplete };
