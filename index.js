require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent, // needed to read which emojis are in your message
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
});

// Each group = one choice max per person
const GROUPS = {
  department: {
    '⚙️': 'Voidlabs-member',
    '👥': 'HR-member',
    '👁️': 'Vision-member',
    '⬇️': 'Gravity-member',
    '✒️': 'Design-member',
  },
  education: {
    '1️⃣': 'ing1', '2️⃣': 'ing2', '3️⃣': 'ing3', '4️⃣': 'ing4', '5️⃣': 'ing5',
    '⚫': 'L1', '⚪': 'L2', '🟤': 'L3', '🟣': 'L4', '🟠': 'L5',
    '🔵': 'ESI-SBA',
    '🟢': 'MED',
  },
};

// Remove invisible variation selector so ⚙️ and ⚙ match
const normalize = (e) => e.replace(/\uFE0F/g, '');

// emoji -> { group, roleName }
const LOOKUP = {};
for (const [group, map] of Object.entries(GROUPS)) {
  for (const [emoji, roleName] of Object.entries(map)) {
    LOOKUP[normalize(emoji)] = { group, roleName };
  }
}


// All emojis (with proper emoji form) used by the bot
const ALL_EMOJIS = Object.values(GROUPS).flatMap((g) => Object.keys(g));

// Adds every supported emoji found in the message text, in the order they appear
async function addReactionsFor(message) {
  try {
    if (message.partial) await message.fetch();
    if (message.channelId !== process.env.ROLES_CHANNEL_ID) return;
    const text = normalize(message.content ?? '');
    const found = ALL_EMOJIS
      .map((e) => ({ e, i: text.indexOf(normalize(e)) }))
      .filter((x) => x.i !== -1)
      .sort((a, b) => a.i - b.i);
    for (const { e } of found) {
      await message.react(e).catch((err) => console.warn('React failed for', e, err.message));
    }
  } catch (err) {
    console.error('Auto-react error:', err);
  }
}

async function onAdd(reaction, user) {
  if (user.bot) return;
  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();

    const msg = reaction.message;
    if (!msg.guild || msg.channelId !== process.env.ROLES_CHANNEL_ID) return;

    const emoji = normalize(reaction.emoji.name ?? '');
    const entry = LOOKUP[emoji];
    if (!entry) return;

    const member = await msg.guild.members.fetch(user.id);
    const groupEmojis = Object.keys(GROUPS[entry.group]).map(normalize);
    const groupRoleNames = Object.values(GROUPS[entry.group]);

    // 1) Remove the other roles of the same group
    const toRemove = member.roles.cache.filter(
      (r) => groupRoleNames.includes(r.name) && r.name !== entry.roleName
    );
    if (toRemove.size) await member.roles.remove(toRemove);

    // 2) Give the new role
    const role = msg.guild.roles.cache.find((r) => r.name === entry.roleName);
    if (!role) return console.warn(`Role "${entry.roleName}" not found.`);
    await member.roles.add(role);

    // 3) Remove the user's other reactions of the same group (keeps the UI clean)
    const messages = await msg.channel.messages.fetch({ limit: 50 });
    for (const m of messages.values()) {
      for (const r of m.reactions.cache.values()) {
        const e = normalize(r.emoji.name ?? '');
        if (groupEmojis.includes(e) && e !== emoji) {
          await r.users.remove(user.id).catch(() => {});
        }
      }
    }
  } catch (err) {
    console.error('Add error:', err);
  }
}

async function onRemove(reaction, user) {
  if (user.bot) return;
  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();

    const msg = reaction.message;
    if (!msg.guild || msg.channelId !== process.env.ROLES_CHANNEL_ID) return;

    const entry = LOOKUP[normalize(reaction.emoji.name ?? '')];
    if (!entry) return;

    const member = await msg.guild.members.fetch(user.id);
    const role = msg.guild.roles.cache.find((r) => r.name === entry.roleName);
    if (role && member.roles.cache.has(role.id)) await member.roles.remove(role);
  } catch (err) {
    console.error('Remove error:', err);
  }
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  // Add missing reactions to the messages already in the roles channel
  try {
    const channel = await client.channels.fetch(process.env.ROLES_CHANNEL_ID);
    const messages = await channel.messages.fetch({ limit: 50 });
    for (const m of [...messages.values()].reverse()) await addReactionsFor(m);
  } catch (err) {
    console.error('Startup scan error:', err);
  }
});
client.on('messageCreate', (m) => { if (!m.author.bot) addReactionsFor(m); });
client.on('messageUpdate', (_old, m) => { if (!m.author?.bot) addReactionsFor(m); });
client.on('messageReactionAdd', onAdd);
client.on('messageReactionRemove', onRemove);

client.login(process.env.DISCORD_TOKEN);