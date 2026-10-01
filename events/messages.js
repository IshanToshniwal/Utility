const { Events } = require('discord.js');
const store = require('../lib/store');
const stats = require('../lib/stats');
const verification = require('../lib/verification');
const applications = require('../lib/applications');

module.exports = {
  name: Events.MessageCreate,
  async execute(client, message) {
    if (message.author?.bot) return;
    // DM -> application conversation
    if (!message.inGuild()) return applications.onDm(client, message);
    const t = store.teamFor(message.guildId);
    if (!t) return;
    // proof channel
    if (await verification.onProofMessage(client, message)) return;
    // activity: messages by staff in the staff server (optionally only some channels)
    if (message.guildId === t.staffGuildId && t.members[message.author.id] && (!t.statsChannels.length || t.statsChannels.includes(message.channelId))) stats.record(t, message.author.id, 'msgs');
  },
};
