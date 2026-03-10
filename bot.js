require("dotenv").config();
const fs = require("fs");
const {
  Client,
  GatewayIntentBits,
  Partials,
  ActivityType,
  EmbedBuilder,
  WebhookClient,
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  InteractionType,
  PermissionsBitField
} = require("discord.js");

// =====================================================
// CLIENT SETUP
// =====================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// =====================================================
// WEBHOOKS
// =====================================================
const defaultModWebhook = new WebhookClient({ url: process.env.WEBHOOK_URL });
const defaultWelcomeWebhook = new WebhookClient({ url: process.env.WELCOMER_URL });

// =====================================================
// STORAGE
// =====================================================
const warningsFile = "./warnings.json";
const blacklistFile = "./blacklist.json";
const guildConfigFile = "./guildConfigs.json";

let warningsData = fs.existsSync(warningsFile)
  ? JSON.parse(fs.readFileSync(warningsFile))
  : {};

let blacklist = new Set(
  fs.existsSync(blacklistFile)
    ? JSON.parse(fs.readFileSync(blacklistFile))
    : []
);

let guildConfigs = fs.existsSync(guildConfigFile)
  ? JSON.parse(fs.readFileSync(guildConfigFile))
  : {};

// =====================================================
// CONFIG
// =====================================================
const CONFIG = {
  spamThreshold: 5,
  spamInterval: 5000,
  muteDuration: 10 * 60 * 1000
};

// =====================================================
// DEFAULT SWEARS
// =====================================================
const blockedWords = [
  "fuck","shit","bitch","cunt","dick","pussy",
  "nigg","fagg","kys","slut","whore","retard"
];

// =====================================================
// GUILD CONFIG FUNCTIONS
// =====================================================
function saveConfigs() {
  fs.writeFileSync(guildConfigFile, JSON.stringify(guildConfigs, null, 2));
}

function getGuildConfig(guildId) {
  if (!guildConfigs[guildId]) {
    guildConfigs[guildId] = { bypassRole: "", customSwears: {}, modWebhook: "", welcomeWebhook: "" };
    saveConfigs();
  }
  return guildConfigs[guildId];
}

// =====================================================
// SWEAR DETECTION
// =====================================================
function detectSwear(content, guildId) {
  const lower = content.toLowerCase();

  for (const word of blockedWords) {
    if (lower.includes(word)) return word;
  }

  const config = getGuildConfig(guildId);
  for (const word in config.customSwears) {
    if (lower.includes(word)) return word;
  }

  return null;
}

// =====================================================
// WARNING SYSTEM
// =====================================================
async function handleWarning(member, reason) {
  const id = member.id;

  if (!warningsData[id])
    warningsData[id] = { warnings: 0, mutes: 0, kicks: 0, risk: 0 };

  warningsData[id].warnings++;
  warningsData[id].risk += 5;

  let punishment = "Warning";

  const muteRole = member.guild.roles.cache.find(r => r.name.toLowerCase() === "muted");
  const config = getGuildConfig(member.guild.id);

  if (warningsData[id].warnings >= 3) {
    punishment = "Muted";
    warningsData[id].warnings = 0;
    warningsData[id].mutes++;

    if (muteRole && member.manageable) {
      await member.roles.add(muteRole).catch(() => {});
      setTimeout(async () => {
        if (member.roles.cache.has(muteRole.id))
          await member.roles.remove(muteRole).catch(() => {});
      }, CONFIG.muteDuration);
    }
  }

  if (warningsData[id].mutes >= 3) {
    punishment = "Kicked";
    warningsData[id].mutes = 0;
    warningsData[id].kicks++;
    if (member.kickable) await member.kick("Too many mutes").catch(() => {});
  }

  if (warningsData[id].kicks >= 2) {
    punishment = "Blacklisted";
    blacklist.add(id);
    fs.writeFileSync(blacklistFile, JSON.stringify([...blacklist], null, 2));
    if (member.kickable) await member.kick("Blacklisted").catch(() => {});
  }

  fs.writeFileSync(warningsFile, JSON.stringify(warningsData, null, 2));

  const embed = new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle(`Moderation Action in ${member.guild.name}`)
    .addFields(
      { name: "User", value: member.user.tag },
      { name: "Reason", value: reason },
      { name: "Punishment", value: punishment }
    )
    .setTimestamp();

  try {
    if (config.modWebhook) {
      // Send only to the server's mod webhook
      const webhook = new WebhookClient({ url: config.modWebhook });
      await webhook.send({ embeds: [embed] });
    } else {
      // If no webhook is set, optionally send in a default channel in that guild
      const defaultChannel = member.guild.systemChannel || member.guild.channels.cache.find(ch => ch.isTextBased() && ch.permissionsFor(member.guild.members.me).has("SendMessages"));
      if (defaultChannel) {
        await defaultChannel.send({ embeds: [embed] }).catch(() => {});
      }
    }
  } catch (err) {
    console.error(`Failed to send warning in guild ${member.guild.name}:`, err);
  }
}


// =====================================================
// READY
// =====================================================
client.once("ready", async () => {
  console.log(`Bot Online: ${client.user.tag}`);
  client.user.setActivity("over Members", { type: ActivityType.Watching });

  const testEmbed = new EmbedBuilder()
    .setColor(0x00ff00)
    .setTitle("SYSTEM ARMED")
    .setDescription(
      "All systems operational.\nSwear Detection: Good ✅\nSpam Detection: Good ✅\nStorage System: Good ✅"
    )
    .setTimestamp();

  try {
    await defaultModWebhook.send({ embeds: [testEmbed] });
    console.log("System check embed sent successfully.");
  } catch (err) {
    console.error("Failed to send system check embed:", err);
  }
});

// =====================================================
// MEMBER JOIN
// =====================================================
client.on("guildMemberAdd", async member => {
  const config = getGuildConfig(member.guild.id);

  if (blacklist.has(member.id)) {
    if (member.kickable) await member.kick("Blacklisted").catch(() => {});
    return;
  }

  warningsData[member.id] = { warnings: 0, mutes: 0, kicks: 0, risk: 0 };
  fs.writeFileSync(warningsFile, JSON.stringify(warningsData, null, 2));

  const welcomeEmbed = new EmbedBuilder()
    .setColor(0x8A2BE2)
    .setTitle(`Welcome to ${member.guild.name}!`)
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 512 }))
    .setDescription(`Hey! ${member}\n\nWelcome to **${member.guild.name}**.`)
    .setFooter({ text: `Member #${member.guild.memberCount}`, iconURL: member.guild.iconURL({ dynamic: true }) })
    .setTimestamp();

  try {
    if (config.welcomeWebhook) {
      const webhook = new WebhookClient({ url: config.welcomeWebhook });
      await webhook.send({ embeds: [welcomeEmbed] });
    } else {
      await defaultWelcomeWebhook.send({ embeds: [welcomeEmbed] });
    }
  } catch (err) {
    console.error("Failed to send welcome embed:", err);
  }
});

// =====================================================
// MESSAGE MONITOR
// =====================================================
const spamTracker = new Map();

client.on("messageCreate", async message => {
  if (!message.guild || message.author.bot) return;

  const member = message.member;
  const config = getGuildConfig(message.guild.id);
  const now = Date.now();

  // Bypass role check
  if (config.bypassRole && member.roles.cache.has(config.bypassRole)) return;

  // Spam detection
  if (!spamTracker.has(member.id)) spamTracker.set(member.id, []);
  const timestamps = spamTracker.get(member.id);
  timestamps.push(now);
  while (timestamps[0] < now - CONFIG.spamInterval) timestamps.shift();
  if (timestamps.length >= CONFIG.spamThreshold)
    await handleWarning(member, "Spamming messages");

  // Link detection
  const linkRegex = /(https?:\/\/|www\.|discord\.gg\/)/i;
  if (linkRegex.test(message.content))
    await handleWarning(member, "Unauthorized Link");

  // Swear detection
  const swear = detectSwear(message.content, message.guild.id);
  if (swear) {
    const punish = config.customSwears[swear] || "Warning";
    await handleWarning(member, `Used banned word: ${swear} (Punishment: ${punish})`);
  }
});

// =====================================================
// RISK DECAY
// =====================================================
setInterval(() => {
  Object.keys(warningsData).forEach(id => {
    if (warningsData[id].risk > 0) warningsData[id].risk -= 1;
  });
  fs.writeFileSync(warningsFile, JSON.stringify(warningsData, null, 2));
}, 60 * 60 * 1000);

// =====================================================
// SETTINGS COMMAND
// =====================================================
client.on("interactionCreate", async interaction => {
  if (!interaction.guild) return;

  const config = getGuildConfig(interaction.guild.id);

  // ---------- Slash Command ----------
  if (interaction.isChatInputCommand() && interaction.commandName === "settings") {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: "You need Administrator permissions to use this command.", ephemeral: true });
    }

    // Embed for settings
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle("Server Settings Panel")
      .setDescription("Select a category from the dropdown menu to configure server settings.");

    // Dropdown menu with categories
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`settings_menu_${interaction.user.id}`)
      .setPlaceholder("Choose a category")
      .addOptions([
        { label: "Swear List", value: "swears", description: "Manage custom banned words" },
        { label: "Webhooks", value: "webhooks", description: "Configure moderation & welcome webhooks" },
        { label: "Bypass Role", value: "bypass", description: "Set a role that bypasses punishments" }
      ]);

    const row = new ActionRowBuilder().addComponents(menu);

    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  }

  // ---------- Dropdown Interaction ----------
  if (interaction.isStringSelectMenu() && interaction.customId === `settings_menu_${interaction.user.id}`) {
    const choice = interaction.values[0];

    if (choice === "swears") {
      const options = Object.keys(config.customSwears).map(w => `${w} → ${config.customSwears[w]}`).join("\n") || "No custom swears yet.";
      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle("Swear List Settings")
        .setDescription(`Current custom swears:\n${options}`);

      const addButton = new ButtonBuilder()
        .setCustomId("add_swear")
        .setLabel("Add Swear")
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder().addComponents(addButton);
      await interaction.update({ embeds: [embed], components: [row] });
    }

    if (choice === "webhooks") {
      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle("Webhook Settings")
        .setDescription(
          `Moderation Webhook: ${config.modWebhook || "Not set"}\n` +
          `Welcome Webhook: ${config.welcomeWebhook || "Not set"}`
        );

      const modButton = new ButtonBuilder()
        .setCustomId("set_mod_webhook")
        .setLabel("Set Moderation Webhook")
        .setStyle(ButtonStyle.Primary);

      const welcomeButton = new ButtonBuilder()
        .setCustomId("set_welcome_webhook")
        .setLabel("Set Welcome Webhook")
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder().addComponents(modButton, welcomeButton);
      await interaction.update({ embeds: [embed], components: [row] });
    }

    if (choice === "bypass") {
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle("Bypass Role Settings")
        .setDescription(`Current bypass role: <@&${config.bypassRole}>`);

      const button = new ButtonBuilder()
        .setCustomId("set_bypass_role")
        .setLabel("Set Bypass Role")
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder().addComponents(button);
      await interaction.update({ embeds: [embed], components: [row] });
    }
  }

  // ---------- Button Interactions ----------
  if (interaction.isButton() && interaction.user.id === interaction.user.id) {
    if (interaction.customId === "add_swear") {
      const modal = new ModalBuilder()
        .setCustomId("add_swear_modal")
        .setTitle("Add Custom Swear");

      const wordInput = new TextInputBuilder()
        .setCustomId("swear_word")
        .setLabel("Swear Word")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const punishmentInput = new TextInputBuilder()
        .setCustomId("swear_punishment")
        .setLabel("Punishment (Warning/Muted/Kicked)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const row1 = new ActionRowBuilder().addComponents(wordInput);
      const row2 = new ActionRowBuilder().addComponents(punishmentInput);
      modal.addComponents(row1, row2);

      await interaction.showModal(modal);
    }

    if (interaction.customId === "set_mod_webhook") {
      const modal = new ModalBuilder()
        .setCustomId("set_mod_webhook_modal")
        .setTitle("Set Moderation Webhook");

      const webhookInput = new TextInputBuilder()
        .setCustomId("mod_webhook_url")
        .setLabel("Webhook URL")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(webhookInput));
      await interaction.showModal(modal);
    }

    if (interaction.customId === "set_welcome_webhook") {
      const modal = new ModalBuilder()
        .setCustomId("set_welcome_webhook_modal")
        .setTitle("Set Welcome Webhook");

      const webhookInput = new TextInputBuilder()
        .setCustomId("welcome_webhook_url")
        .setLabel("Webhook URL")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(webhookInput));
      await interaction.showModal(modal);
    }

    if (interaction.customId === "set_bypass_role") {
      const modal = new ModalBuilder()
        .setCustomId("set_bypass_role_modal")
        .setTitle("Set Bypass Role");

      const roleInput = new TextInputBuilder()
        .setCustomId("bypass_role_id")
        .setLabel("Role ID")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(roleInput));
      await interaction.showModal(modal);
    }
  }

  // ---------- Modal Submits ----------
  if (interaction.type === InteractionType.ModalSubmit) {
    if (interaction.customId === "add_swear_modal") {
      const word = interaction.fields.getTextInputValue("swear_word").toLowerCase();
      const punishment = interaction.fields.getTextInputValue("swear_punishment");
      config.customSwears[word] = punishment;
      saveConfigs();
      await interaction.reply({ content: `Added custom swear: ${word} → ${punishment}`, ephemeral: true });
    }

    if (interaction.customId === "set_mod_webhook_modal") {
      const url = interaction.fields.getTextInputValue("mod_webhook_url");
      config.modWebhook = url;
      saveConfigs();
      await interaction.reply({ content: `Moderation webhook updated.`, ephemeral: true });
    }

    if (interaction.customId === "set_welcome_webhook_modal") {
      const url = interaction.fields.getTextInputValue("welcome_webhook_url");
      config.welcomeWebhook = url;
      saveConfigs();
      await interaction.reply({ content: `Welcome webhook updated.`, ephemeral: true });
    }

    if (interaction.customId === "set_bypass_role_modal") {
      const roleId = interaction.fields.getTextInputValue("bypass_role_id");
      config.bypassRole = roleId;
      saveConfigs();
      await interaction.reply({ content: `Bypass role updated.`, ephemeral: true });
    }
  }
});

// =====================================================
client.login(process.env.DISCORD_TOKEN);
