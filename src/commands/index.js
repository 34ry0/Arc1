const admin = require('./admin');
const clan = require('./clan');
const clans = require('./clans');
const commandList = require('./commands');
const match = require('./match');
const roster = require('./roster');

const all = [admin, clan, clans, commandList, match, roster];

module.exports = new Map(all.map((c) => [c.data.name, c]));
