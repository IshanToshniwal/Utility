const { Events } = require('discord.js');
const verification = require('../lib/verification');

module.exports = {
  name: Events.MessageCreate,
  async execute(client, message) {
    if (!message.inGuild() || message.author?.bot) return;
    await verification.onProofMessage(client, message);
  },
};
