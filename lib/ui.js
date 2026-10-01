// Components V2 message builder. Every message the bot sends is a "card": a container with an
// accent colour, markdown text, optional thumbnail / images / file / buttons.
//   card({ color, title, text, fields, thumbnail, image, images, rows, footer, files })  -> ContainerBuilder
//   msg(cardOrCards, { content, ephemeral, files })  -> payload for reply/send/edit
const {
  ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize,
  MediaGalleryBuilder, MediaGalleryItemBuilder, FileBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} = require('discord.js');

const COLORS = { blue: 0x5865f2, green: 0x3ddc84, red: 0xff5c6c, yellow: 0xffc857, purple: 0x9b6bff, grey: 0x99aab5, orange: 0xff8c50, teal: 0x2dd4bf };
const LIMIT = 3900; // Discord allows 4000 chars of text per message across all text displays

const td = (s) => new TextDisplayBuilder().setContent(String(s).slice(0, LIMIT));
const sep = (big = false) => new SeparatorBuilder().setSpacing(big ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small).setDivider(true);

function fieldsText(fields) {
  return fields
    .filter((f) => f && f.value !== undefined && f.value !== null && String(f.value).length)
    .map((f) => (f.inline ? `**${f.name}:** ${f.value}` : `**${f.name}**\n${f.value}`))
    .join('\n');
}

function card({ color = COLORS.blue, title, text, fields = [], thumbnail, image, images, galleries = [], rows = [], footer, files = [] } = {}) {
  const c = new ContainerBuilder().setAccentColor(color);
  let budget = LIMIT;
  const take = (s) => { const out = String(s ?? '').slice(0, Math.max(0, budget)); budget -= out.length; return out; };
  const head = [title ? `## ${title}` : '', text || ''].filter(Boolean).join('\n');
  if (head) {
    const body = take(head);
    if (thumbnail) c.addSectionComponents(new SectionBuilder().addTextDisplayComponents(td(body)).setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnail)));
    else c.addTextDisplayComponents(td(body));
  } else if (thumbnail) c.addSectionComponents(new SectionBuilder().addTextDisplayComponents(td('​')).setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnail)));
  const ft = fieldsText(fields);
  if (ft) {
    if (head) c.addSeparatorComponents(sep());
    c.addTextDisplayComponents(td(take(ft)));
  }
  const imgs = [...(images || []), ...(image ? [image] : [])].filter(Boolean);
  if (imgs.length) c.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(...imgs.slice(0, 10).map((u) => new MediaGalleryItemBuilder().setURL(u))));
  // one gallery per entry -> each image gets the full width instead of being tiled and cropped
  for (const g of galleries.filter((x) => x && x.length).slice(0, 10)) c.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(...[].concat(g).slice(0, 10).map((u) => new MediaGalleryItemBuilder().setURL(u))));
  for (const f of files) c.addFileComponents(new FileBuilder().setURL(`attachment://${f}`));
  for (const r of rows.filter(Boolean)) c.addActionRowComponents(r);
  if (footer) {
    c.addSeparatorComponents(sep());
    c.addTextDisplayComponents(td(take(`-# ${footer}`)));
  }
  return c;
}

// payload for interaction.reply / channel.send / message.edit
function msg(cards, { content = null, ephemeral = false, files = [], rows = [] } = {}) {
  const list = Array.isArray(cards) ? cards : [cards];
  const components = [];
  if (content) components.push(td(content));
  components.push(...list.filter(Boolean), ...rows.filter(Boolean));
  const payload = { components, flags: MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0) };
  if (files.length) payload.files = files;
  // editing a message with V2 components: make sure legacy fields are cleared
  payload.content = null;
  payload.embeds = [];
  return payload;
}
const simple = (color, text, opts = {}) => msg(card({ color, text }), opts);
const ok = (text, opts = {}) => simple(COLORS.green, `✅ ${text}`, opts);
const fail = (text, opts = {}) => simple(COLORS.red, `❌ ${text}`, { ephemeral: true, ...opts });

const button = (id, label, style = ButtonStyle.Secondary, emoji = null, disabled = false) => {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
  if (emoji) b.setEmoji(emoji);
  return b;
};
const row = (...buttons) => new ActionRowBuilder().addComponents(...buttons.filter(Boolean));

module.exports = { COLORS, card, msg, simple, ok, fail, button, row, td, sep, LIMIT };
