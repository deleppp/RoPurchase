require('dotenv').config();
const http = require('http');
const fs = require('fs');
const { Redis } = require('@upstash/redis');
const { 
    Client, 
    GatewayIntentBits, 
    SlashCommandBuilder, 
    REST, 
    Routes, 
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags,
    PermissionFlagsBits,
    EmbedBuilder,
    AttachmentBuilder
} = require('discord.js');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages] });

const redis = new Redis({
    url: String(process.env.UPSTASH_REDIS_REST_URL || '').replace(/[\[\]()]/g, '').trim(),
    token: String(process.env.UPSTASH_REDIS_REST_TOKEN || '').replace(/[\[\]()]/g, '').trim(),
});

const STOCK_FILE = './stockDatabase.json';

async function loadStockDB() {
    try {
        const raw = await redis.get('stock:database');
        if (raw) {
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return {
                file: Array.isArray(parsed.file) ? parsed.file : [],
                code: Array.isArray(parsed.code) ? parsed.code : []
            };
        }
    } catch (err) {
        console.error('❌ [ERROR] Failed to load stock from Redis:', err);
    }
    return { file: [], code: [] };
}

async function saveStockDB(db) {
    try {
        await redis.set('stock:database', JSON.stringify(db));
    } catch (err) {
        console.error('❌ [ERROR] Failed to save stock to Redis:', err);
    }
}

// HTTP Bridge Server for Roblox using Express
const express = require('express');
const app = express();
app.use(express.json());

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// Root route added here to prevent 404 on UptimeRobot pings and browser visits
app.get('/', (req, res) => {
    res.status(200).send('Bot and Bridge Server are online!');
});

app.post('/add-key', async (req, res) => {
    try {
        console.log(`📥 [BRIDGE] Received body from Roblox:`, req.body);
        const data = req.body || {};
        const keyStr = data.key || data.Key || data.code || data.Code;
        
        if (keyStr) {
            const cleanKey = String(keyStr).trim().toUpperCase();
        
            const keyData = {
                used: false,
                expiresAt: Date.now() + 72 * 3600 * 1000,
                player: data.player || data.Player || data.username || 'Unknown',
                userId: Number(data.userId || data.UserId || data.userid || 0),
                hasGamepass: Boolean(data.hasGamepass ?? data.HasGamepass ?? false),
                redeemedByDiscordId: null,
                rewardCode: null,
                rewardFileUrl: null,
                rewardFileName: null
            };

            await redis.set(`key:${cleanKey}`, JSON.stringify(keyData), { ex: 259200 });

            console.log(`✅ [SUCCESS] Key registered dynamically in Redis: "${cleanKey}" for player ${keyData.player} (${keyData.userId})`);
            return res.status(200).json({ success: true });
        } else {
            console.warn('⚠️ [WARNING] Key creation failed. Missing key field in body:', req.body);
            return res.status(400).json({ success: false, error: 'Invalid key data: Missing key field' });
        }
    } catch (err) {
        console.error('❌ [ERROR] Bad JSON received from Roblox bridge:', err);
        return res.status(400).json({ success: false, error: 'Bad JSON' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`HTTP Bridge Server listening on port ${PORT}`);
});

client.once('ready', async () => {
    console.log(`Bot logged in as ${client.user.tag}`);

    const commands = [
        new SlashCommandBuilder()
            .setName('redeemkey')
            .setDescription('Redeem your activation key from the game')
            .addStringOption(option =>
                option.setName('key')
                    .setDescription('Your 15-character activation key')
                    .setRequired(true)
        ),
        new SlashCommandBuilder()
            .setName('checkkey')
            .setDescription('Check the status and data of an activation key (Admin Only)')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addStringOption(option =>
                option.setName('key')
                    .setDescription('The activation key to look up')
                    .setRequired(true)
        ),
        new SlashCommandBuilder()
            .setName('setup')
            .setDescription('Configure Roblox Gamepass integration and rewards (Admin Only)')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('stock')
            .setDescription('Manage the reward stock (Admin Only)')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addSubcommand(subcommand =>
                subcommand
                    .setName('add')
                    .setDescription('Add rewards to the stock (Upload a file for file stock, or text for codes)')
                    .addStringOption(option =>
                        option.setName('category')
                            .setDescription('Reward category')
                            .setRequired(true)
                            .addChoices(
                                { name: 'Code', value: 'code' },
                                { name: 'Game File', value: 'file' }
                            )
                    )
                    .addStringOption(option =>
                        option.setName('items')
                            .setDescription('Text items (Required if category is Code)')
                            .setRequired(false)
                    )
                    .addAttachmentOption(option =>
                        option.setName('file')
                            .setDescription('Upload file directly (Required if category is Game File)')
                            .setRequired(false)
                    )
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('list')
                    .setDescription('Check how many rewards are left in stock')
            ),
        new SlashCommandBuilder()
            .setName('help')
            .setDescription('Show instructions for buyers and developers'),
        new SlashCommandBuilder()
            .setName('credits')
            .setDescription('Show creator information'),
        new SlashCommandBuilder()
            .setName('removeall')
            .setDescription('Reset all bot data and setup configuration (Admin Only)')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('sourcecode')
            .setDescription('Get the GitHub source code link')
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands.map(c => c.toJSON()) },
        );
        console.log('Slash commands registered successfully.');
    } catch (error) {
        console.error(error);
    }
});

async function fetchKeyData(rawKey) {
    if (!rawKey) return { targetKey: null, keyData: null };
    const cleanInput = String(rawKey).trim().toUpperCase();
    
    try {
        const rawData = await redis.get(`key:${cleanInput}`);
        if (rawData) {
            const parsedData = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
            return { targetKey: cleanInput, keyData: parsedData };
        }
    } catch (err) {
        console.error('❌ Error fetching key data from Redis:', err);
    }
    return { targetKey: null, keyData: null };
}

async function processRedemption(interaction, inputKey) {
    const { targetKey, keyData } = await fetchKeyData(inputKey);

    if (!keyData) {
        return interaction.editReply(`❌ **Error:** Invalid activation key (\`${inputKey}\`). Not found in database.`);
    }

    if (keyData.used) {
        return interaction.editReply('❌ **Error:** This key has already been redeemed and cannot be used again.');
    }

    if (Date.now() > keyData.expiresAt) {
        return interaction.editReply('❌ **Error:** This key has expired (over 72 hours old).');
    }

    const isAdmin = interaction.memberPermissions ? interaction.memberPermissions.has(PermissionFlagsBits.Administrator) : false;
    if (!isAdmin) {
        const cooldownKey = `cooldown:${interaction.user.id}`;
        const rawHistory = await redis.get(cooldownKey);
        let userRedemptions = rawHistory ? (typeof rawHistory === 'string' ? JSON.parse(rawHistory) : rawHistory) : [];

        const now = Date.now();
        const twentyFourHours = 24 * 3600 * 1000;

        userRedemptions = userRedemptions.filter(timestamp => now - timestamp < twentyFourHours);
        const maxAllowed = keyData.hasGamepass ? 3 : 1;

        if (userRedemptions.length >= maxAllowed) {
            const oldestRedeem = Math.min(...userRedemptions);
            const resetTimeHours = ((twentyFourHours - (now - oldestRedeem)) / (1000 * 3600)).toFixed(1);
            const tierDesc = keyData.hasGamepass ? "Gamepass Holder (Limit: 3 keys / 24h)" : "Standard User (Limit: 1 key / 24h)";
            
            return interaction.editReply(
                `⏳ **Cooldown Active!**\n` +
                `• Tier: \`${tierDesc}\`\n` +
                `• Max redemptions reached within the last 24 hours. Try again in **${resetTimeHours} hours**.`
            );
        }

        userRedemptions.push(now);
        await redis.set(cooldownKey, JSON.stringify(userRedemptions), { ex: 86400 });
    }

    const stockDB = await loadStockDB();

    const fileIndex = stockDB.file.findIndex(item => !item.used);
    const codeIndex = stockDB.code.findIndex(item => !item.used);

    if (fileIndex === -1 && codeIndex === -1) {
        return interaction.editReply('⚠️ **Stock is completely empty!** Your key is valid, but rewards have run out. Please contact the administrator.');
    }

    let fileItem = fileIndex !== -1 ? stockDB.file[fileIndex] : null;
    let codeContent = codeIndex !== -1 ? stockDB.code[codeIndex].content : null;

    keyData.used = true;
    keyData.redeemedByDiscordId = interaction.user.id;
    keyData.rewardCode = codeContent;
    keyData.rewardFileUrl = fileItem ? fileItem.url : null;
    keyData.rewardFileName = fileItem ? fileItem.name : null;
    
    await redis.set(`key:${targetKey}`, JSON.stringify(keyData));

    if (fileIndex !== -1) {
        stockDB.file[fileIndex].used = true;
    }
    if (codeIndex !== -1) {
        stockDB.code[codeIndex].used = true;
    }
    await saveStockDB(stockDB);

    let dmSuccessful = false;
    let attachment = null;

    if (fileItem && fileItem.url) {
        try {
            attachment = new AttachmentBuilder(fileItem.url, { name: fileItem.name || 'game-file.rar' });
        } catch (e) {
            console.error('❌ Failed to build attachment from URL:', e);
        }
    }

    try {
        const dmChannel = await interaction.user.createDM();
        let dmText = `🎁 **Your Redeemed Rewards:**\n`;
        if (codeContent) {
            dmText += `\n📌 **Code:**\n\`\`\`${codeContent}\`\`\``;
        }
        if (fileItem) {
            dmText += `\n📁 **Game File:** \`${fileItem.name}\``;
        }
        await dmChannel.send({
            content: dmText,
            files: attachment ? [attachment] : []
        });
        dmSuccessful = true;
    } catch (dmErr) {
        console.error(`⚠️ Could not send DM to user ${interaction.user.id}:`, dmErr.message);
    }

    let responseText = codeContent ? `📌 **Code:**\n\`\`\`${codeContent}\`\`\`` : '';
    if (fileItem) {
        responseText += `\n📁 **Game File:** \`${fileItem.name}\``;
    }

    if (dmSuccessful) {
        return interaction.editReply('✅ **Success!** Your reward items have been sent directly to your **DMs**! 📩');
    } else {
        return interaction.editReply({
            content: `✅ **Success!** (⚠️ *DMs are closed, so your items are displayed below*)\n\n${responseText}`,
            files: attachment ? [attachment] : []
        });
    }
}

client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'setup_gamepass_modal') {
                const gamepassId = interaction.fields.getTextInputValue('gamepass_id');
                const verificationType = interaction.fields.getTextInputValue('verification_type');

                await redis.set('setup:config', JSON.stringify({ gamepassId, verificationType }));

                return await interaction.reply({
                    content: `✅ **Setup Completed Successfully!**\n- **Gamepass ID:** \`${gamepassId}\``,
                    flags: [MessageFlags.Ephemeral]
                });
            }

            if (interaction.customId === 'redeem_modal') {
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                const keyInput = interaction.fields.getTextInputValue('activation_key');
                return await processRedemption(interaction, keyInput);
            }
        }

        if (interaction.isButton()) {
            if (interaction.customId === 'open_redeem_modal') {
                const modal = new ModalBuilder()
                    .setCustomId('redeem_modal')
                    .setTitle('Redeem Activation Key');

                const keyInput = new TextInputBuilder()
                    .setCustomId('activation_key')
                    .setLabel('Enter your 15-character key')
                    .setPlaceholder('e.g., ABC12XYZ7890DEF')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                modal.addComponents(new ActionRowBuilder().addComponents(keyInput));
                return await interaction.showModal(modal);
            }
        }

        if (!interaction.isChatInputCommand()) return;

        if (interaction.commandName === 'setup') {
            const modal = new ModalBuilder()
                .setCustomId('setup_gamepass_modal')
                .setTitle('Setup: Gamepass Configuration');

            const gamepassInput = new TextInputBuilder()
                .setCustomId('gamepass_id')
                .setLabel('Roblox Gamepass ID')
                .setPlaceholder('Enter Gamepass ID (e.g., 12345678)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const verificationInput = new TextInputBuilder()
                .setCustomId('verification_type')
                .setLabel('Roblox Game Verification')
                .setPlaceholder('Type "Kick" or "Prompt"')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            modal.addComponents(
                new ActionRowBuilder().addComponents(gamepassInput),
                new ActionRowBuilder().addComponents(verificationInput)
            );

            return await interaction.showModal(modal);
        }

        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        if (interaction.commandName === 'stock') {
            const subcommand = interaction.options.getSubcommand();
            const stockDB = await loadStockDB();
            
            if (subcommand === 'add') {
                const category = interaction.options.getString('category');
                const rawItems = interaction.options.getString('items');
                const uploadedFile = interaction.options.getAttachment('file');

                if (category === 'code') {
                    if (!rawItems) {
                        return interaction.editReply('❌ **Error:** You must provide items text when adding codes.');
                    }
                    const itemsList = rawItems.split(/[\n,]+/).map(i => i.trim()).filter(i => i.length > 0);
                    for (const item of itemsList) {
                        stockDB.code.push({ content: item, used: false });
                    }
                    await saveStockDB(stockDB);
                    const totalAvailable = stockDB.code.filter(i => !i.used).length;
                    return interaction.editReply(`✅ Successfully added **${itemsList.length}** items to **CODE** stock!\n📦 Available: **${totalAvailable}**`);
                } 
              
                if (category === 'file') {
                    if (!uploadedFile) {
                        return interaction.editReply('❌ **Error:** You must attach a file using the file upload option when adding game files.');
                    }
                    stockDB.file.push({ 
                        url: uploadedFile.url, 
                        name: uploadedFile.name, 
                        used: false 
                    });
                    await saveStockDB(stockDB);
                    const totalAvailable = stockDB.file.filter(i => !i.used).length;
                    return interaction.editReply(`✅ Successfully added file **\`${uploadedFile.name}\`** to **FILE** stock!\n📦 Available: **${totalAvailable}**`);
                }
            }

            if (subcommand === 'list') {
                const codeAvailable = stockDB.code.filter(i => !i.used).length;
                const fileAvailable = stockDB.file.filter(i => !i.used).length;

                return interaction.editReply({
                    content: `📦 **Stock Status Overview:**\n` +
                             `• **Codes:** ${codeAvailable} available\n` +
                             `• **Game Files:** ${fileAvailable} available`
                });
            }
        }

        if (interaction.commandName === 'redeemkey') {
            const inputKey = interaction.options.getString('key');
            return await processRedemption(interaction, inputKey);
        }

        if (interaction.commandName === 'checkkey') {
            const inputKey = interaction.options.getString('key');
            const { targetKey, keyData } = await fetchKeyData(inputKey);

            if (!keyData) {
                return interaction.editReply(`❌ **Error:** Key \`${inputKey}\` does not exist.`);
            }

            return interaction.editReply(
                `🔍 **Key Info:**\n` +
                `- **Key:** \`${targetKey}\`\n` +
                `- **Player:** \`${keyData.player}\` (ID: \`${keyData.userId}\`)\n` +
                `- **Status:** ${keyData.used ? '🔴 **Redeemed**' : '🟢 **Active**'}\n` +
                `- **Redeemed By:** ${keyData.redeemedByDiscordId ? `<@${keyData.redeemedByDiscordId}>` : 'None'}` +
                (keyData.rewardFileName ? `\n- **File Sent:** \`${keyData.rewardFileName}\`` : '')
            );
        }

        if (interaction.commandName === 'help') {
            const helpEmbed = new EmbedBuilder()
                .setColor(0x0099FF)
                .setTitle('🤖 Bot Instructions & Help')
                .addFields(
                    { name: '🛒 For Buyers', value: `1. Get 15-character key from Roblox.\n2. Click **Redeem Key** or use \`/redeemkey\` to get your file instantly sent to your DMs.` },
                    { name: '🛠️ For Admins', value: '• Use `/stock add category:file` and click the upload window to add real files.' }
                );

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('open_redeem_modal').setLabel('🎁 Redeem Key').setStyle(ButtonStyle.Primary)
            );

            return interaction.editReply({ embeds: [helpEmbed], components: [row] });
        }

        if (interaction.commandName === 'credits') {
            return interaction.editReply({ content: `✨ **Credits:** Made by **DELEP**` });
        }

        if (interaction.commandName === 'removeall') {
            let cursor = '0';
            do {
                const reply = await redis.scan(cursor, { match: '*', count: 100 });
                cursor = String(reply[0]);
                const keys = reply[1];
                if (keys && keys.length > 0) {
                    await redis.del(...keys);
                }
            } while (cursor !== '0');

            if (fs.existsSync(STOCK_FILE)) {
                fs.unlinkSync(STOCK_FILE);
            }

            return interaction.editReply({ content: `🗑️ **All database keys, cooldowns, config, and stock files wiped completely!**` });
        }

        if (interaction.commandName === 'sourcecode') {
            return interaction.editReply({ content: `📂 **Source Code:**\nhttps://github.com/deleppp/RoPurchase` });
        }
    } catch (err) {
        console.error('❌ Error handling command interaction:', err);
        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: '❌ An error occurred while processing this command.' }).catch(() => {});
            }
        } catch (_) {}
    }
});

client.login(process.env.DISCORD_TOKEN);