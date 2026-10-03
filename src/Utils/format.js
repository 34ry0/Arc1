const { EmbedBuilder } = require('discord.js');

const SLOTS = ['1', '2', '3', 'sub'];

const slotLabel = (slot) => (slot === 'sub' ? 'SUB' : `Starter ${slot}`);
const slotShort = (slot) => (slot === 'sub' ? 'SUB' : slot);

function slotMap(members) {
  return new Map(members.map((m) => [m.slot, m.user_id]));
}

function rosterLines(clan, members) {
  const slots = slotMap(members);
  const who = (s) => (slots.has(s) ? `<@${slots.get(s)}>` : 'Open');
  return [
    `Color: ${clan.color_name}`,
    `Captain: ${clan.captain_id ? `<@${clan.captain_id}>` : 'None'}`,
    '',
    `1: ${who('1')}`,
    `2: ${who('2')}`,
    `3: ${who('3')}`,
    `SUB: ${who('sub')}`,
  ];
}

function rosterEmbed(clan, members) {
  return new EmbedBuilder()
    .setTitle(clan.name)
    .setDescription(rosterLines(clan, members).join('\n'))
    .setColor(clan.color);
}

// One embed per 10 clans. The caller sends at most 3 embeds per message.
function clanListEmbeds(clans, members) {
  if (!clans.length) {
    return [new EmbedBuilder().setTitle('Clans').setDescription('No clans have been created yet.').setColor(0x808080)];
  }
  const byClan = new Map();
  for (const m of members) {
    if (!byClan.has(m.clan_id)) byClan.set(m.clan_id, []);
    byClan.get(m.clan_id).push(m);
  }

  const embeds = [];
  for (let i = 0; i < clans.length; i += 10) {
    const embed = new EmbedBuilder().setColor(0x808080);
    if (i === 0) embed.setTitle('Clans');
    for (const clan of clans.slice(i, i + 10)) {
      embed.addFields({
        name: clan.name,
        value: rosterLines(clan, byClan.get(clan.id) || []).join('\n'),
        inline: true,
      });
    }
    embeds.push(embed);
  }
  embeds[embeds.length - 1].setFooter({ text: `${clans.length} clan${clans.length === 1 ? '' : 's'}` });
  return embeds;
}

module.exports = { SLOTS, slotLabel, slotShort, rosterEmbed, clanListEmbeds };
