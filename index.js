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

app.get('/', (req, res) => {
    res.status(200).send('Bot and Bridge Server are online!');
});

app.post('/add-key', async (req, res) => {
    try {
        console.log(`📥 [BRIDGE] Received body from Roblox:`, req.body);
        const data = req.body || {};
        const keyStr = data.key || data.Key || data.code || data.Code;
        
        if (!keyStr) {
            console.warn('⚠️ [WARNING] Key creation failed. Missing key field.');
            return res.status(400).json({ success: false, error: 'Missing key field' });
        }

        const cleanKey = String(keyStr).trim().toUpperCase();
        
        const keyData = {
            used: false,
            usesLeft: Number(data.uses || 1),
            maxUses: Number(data.uses || 1),
            expiresAt: Date.now() + 72 * 3600 * 1000,
            player: data.player || 'Unknown',
            userId: Number(data.userId || 0),
            hasGamepass: Boolean(data.hasGamepass),
            hasAsset: Boolean(data.hasAsset),
            inGroup: Boolean(data.inGroup),
            requirementsMet: Boolean(data.requirementsMet),
            rewardFileName: data.fileName || null,
            productId: data.productId ? Number(data.productId) : null,
            gamepassId: data.gamepassId ? Number(data.gamepassId) : null,
            assetId: data.assetId ? Number(data.assetId) : null,
            groupId: data.groupId ? Number(data.groupId) : null,
            category: data.category || 'code'
        };

        await redis.set(`key:${cleanKey}`, JSON.stringify(keyData), { ex: 259200 });

        console.log(`✅ [SUCCESS] Stored key "key:${cleanKey}" in Redis.`);
        return res.status(200).json({ success: true, key: cleanKey });
    } catch (err) {
        console.error('❌ [ERROR] Server error on /add-key:', err);
        return res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

app.post('/verify-key', async (req, res) => {
    try {
        const data = req.body || {};
        const keyStr = data.key || data.Key || data.code || data.Code;

        if (!keyStr) {
            return res.status(400).json({ success: false, error: 'Missing key field' });
        }

        const cleanKey = String(keyStr).trim().toUpperCase();
        const rawData = await redis.get(`key:${cleanKey}`);

        if (!rawData) {
            return res.status(404).json({ success: false, error: 'Key not found or expired' });
        }

        const keyData = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;

        if (Date.now() > keyData.expiresAt) {
            return res.status(400).json({ success: false, error: 'Key has expired' });
        }

        return res.status(200).json({ success: true, data: keyData });
    } catch (err) {
        console.error('❌ [ERROR] Server error on /verify-key:', err);
        return res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

app.post('/redeem-key', async (req, res) => {
    try {
        const data = req.body || {};
        const keyStr = data.key || data.Key || data.code || data.Code;
        const discordId = data.discordId;

        if (!keyStr || !discordId) {
            return res.status(400).json({ success: false, error: 'Missing key or discordId field' });
        }

        const cleanKey = String(keyStr).trim().toUpperCase();
        const rawData = await redis.get(`key:${cleanKey}`);

        if (!rawData) {
            return res.status(404).json({ success: false, error: 'Key not found' });
        }

        const keyData = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;

        if (keyData.used || (keyData.usesLeft <= 0)) {
            return res.status(400).json({ success: false, error: 'Key already used or out of uses' });
        }

        const stockDB = await loadStockDB();
        const requestedCategory = keyData.category || 'code';

        let fileItem = null;
        let codeContent = null;
        let assignedId = 1;

        if (requestedCategory === 'file') {
            const fileIndex = stockDB.file.findIndex(item => !item.used || (item.usesLeft && item.usesLeft > 0));
            if (fileIndex === -1) return res.status(400).json({ success: false, error: 'Stock empty' });
            fileItem = stockDB.file[fileIndex];
            
            if (fileItem.usesLeft && fileItem.usesLeft > 1) {
                fileItem.usesLeft -= 1;
            } else {
                stockDB.file[fileIndex].used = true;
                stockDB.file[fileIndex].usesLeft = 0;
            }
            assignedId = fileItem.id || (fileIndex + 1);
        } else {
            const codeIndex = stockDB.code.findIndex(item => !item.used || (item.usesLeft && item.usesLeft > 0));
            if (codeIndex === -1) return res.status(400).json({ success: false, error: 'Stock empty' });
            codeContent = stockDB.code[codeIndex].content;
            
            if (stockDB.code[codeIndex].usesLeft && stockDB.code[codeIndex].usesLeft > 1) {
                stockDB.code[codeIndex].usesLeft -= 1;
            } else {
                stockDB.code[codeIndex].used = true;
                stockDB.code[codeIndex].usesLeft = 0;
            }
            assignedId = stockDB.code[codeIndex].id || (codeIndex + 1);
        }

        keyData.used = true;
        keyData.usesLeft = 0;
        keyData.rewardCode = codeContent;
        keyData.rewardFileUrl = fileItem ? fileItem.url : null;
        keyData.rewardFileName = fileItem ? fileItem.name : (keyData.rewardFileName || null);
        keyData.itemId = assignedId;

        await redis.set(`key:${cleanKey}`, JSON.stringify(keyData));
        await saveStockDB(stockDB);

        try {
            const discordUser = await client.users.fetch(discordId);
            if (discordUser) {
                const formattedId = `#${String(assignedId).padStart(5, '0')}`;
                let dmText = `🎁 **Your Redeemed Rewards (${formattedId}) [Product ID: ${keyData.productId}]:**\n`;
                if (codeContent) dmText += `\n📌 **Code:**\n\`\`\`${codeContent}\`\`\``;
                if (fileItem) dmText += `\n📁 **Game File:** \`${fileItem.name}\``;

                let attachment = null;
                if (fileItem && fileItem.url) {
                    try {
                        attachment = new AttachmentBuilder(fileItem.url, { name: fileItem.name || 'game-file.rar' });
                    } catch (e) {}
                }

                await discordUser.send({
                    content: dmText,
                    files: attachment ? [attachment] : []
                });
            }
        } catch (dmErr) {
            console.error(`⚠️ Could not send DM to user ${discordId}:`, dmErr.message);
        }

        return res.status(200).json({ success: true, reward: codeContent || fileItem?.name });
    } catch (err) {
        console.error('❌ [ERROR] Server error on /redeem-key:', err);
        return res.status(500).json({ success: false, error: 'Internal Server Error' });
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
            .setName('setup')
            .setDescription('Configure Roblox integration requirements (Admin Only)')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('stock')
            .setDescription('Manage the reward stock (Admin Only)')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addSubcommand(subcommand =>
                subcommand
                    .setName('add')
                    .setDescription('Add rewards with custom uses, product ID, and requirements')
                    .addStringOption(option =>
                        option.setName('category')
                            .setDescription('Reward category')
                            .setRequired(true)
                            .addChoices(
                                { name: 'Code', value: 'code' },
                                { name: 'Game File', value: 'file' }
                            )
                    )
                    .addStringOption(option => option.setName('items').setDescription('Text items or codes').setRequired(false))
                    .addAttachmentOption(option => option.setName('file').setDescription('Upload file directly').setRequired(false))
                    .addIntegerOption(option => option.setName('uses').setDescription('Number of allowed redemptions per key/item').setRequired(false))
            )
            .addSubcommand(subcommand => subcommand.setName('list').setDescription('Check how many rewards are left in stock')),
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

client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'setup_gamepass_modal') {
                const gamepassId = interaction.fields.getTextInputValue('gamepass_id');
                const assetId = interaction.fields.getTextInputValue('asset_id');
                const groupId = interaction.fields.getTextInputValue('group_id');

                await redis.set('setup:config', JSON.stringify({ gamepassId, assetId, groupId }));

                return await interaction.reply({
                    content: `✅ **Setup Completed Successfully!**\n- **Gamepass ID:** \`${gamepassId || 'None'}\`\n- **Asset ID:** \`${assetId || 'None'}\`\n- **Group ID:** \`${groupId || 'None'}\``,
                    flags: [MessageFlags.Ephemeral]
                });
            }
        }

        if (!interaction.isChatInputCommand()) return;

        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        if (interaction.commandName === 'setup') {
            const modal = new ModalBuilder()
                .setCustomId('setup_gamepass_modal')
                .setTitle('Setup: Requirements Configuration');

            const gamepassInput = new TextInputBuilder()
                .setCustomId('gamepass_id')
                .setLabel('Gamepass ID (Optional)')
                .setPlaceholder('e.g., 12345678')
                .setStyle(TextInputStyle.Short)
                .setRequired(false);

            const assetInput = new TextInputBuilder()
                .setCustomId('asset_id')
                .setLabel('Asset ID (Optional Shirt/Pants/Accessory)')
                .setPlaceholder('e.g., 87654321')
                .setStyle(TextInputStyle.Short)
                .setRequired(false);

            const groupInput = new TextInputBuilder()
                .setCustomId('group_id')
                .setLabel('Group ID (Optional)')
                .setPlaceholder('e.g., 11223344')
                .setStyle(TextInputStyle.Short)
                .setRequired(false);

            modal.addComponents(
                new ActionRowBuilder().addComponents(gamepassInput),
                new ActionRowBuilder().addComponents(assetInput),
                new ActionRowBuilder().addComponents(groupInput)
            );

            return await interaction.showModal(modal);
        }

        if (interaction.commandName === 'stock') {
            const subcommand = interaction.options.getSubcommand();
            const stockDB = await loadStockDB();
            
            if (subcommand === 'add') {
                const category = interaction.options.getString('category');
                const rawItems = interaction.options.getString('items');
                const uploadedFile = interaction.options.getAttachment('file');
                const customUses = interaction.options.getInteger('uses') || 1;

                let nextId = 1;
                if (stockDB.file.length > 0 || stockDB.code.length > 0) {
                    const allIds = [...stockDB.file, ...stockDB.code].map(i => i.id || 0);
                    nextId = Math.max(...allIds, 0) + 1;
                }

                const productId = Math.floor(100000 + Math.random() * 900000);
                const uniqueId = `PROD-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;

                if (category === 'code') {
                    if (!rawItems) {
                        return interaction.editReply('❌ **Error:** You must provide items text when adding codes.');
                    }
                    const itemsList = rawItems.split(/[\n,]+/).map(i => i.trim()).filter(i => i.length > 0);
                    for (const item of itemsList) {
                        stockDB.code.push({ 
                            id: nextId++, 
                            content: item, 
                            used: false, 
                            usesLeft: customUses, 
                            maxUses: customUses,
                            productId,
                            uniqueId
                        });
                    }
                    await saveStockDB(stockDB);
                    const totalAvailable = stockDB.code.filter(i => !i.used).length;
                    return interaction.editReply(`✅ Successfully added **${itemsList.length}** items to **CODE** stock (Product ID: \`${productId}\`, Uses per item: \`${customUses}\`)!\n📦 Available: **${totalAvailable}**`);
                } 
            
                if (category === 'file') {
                    if (!uploadedFile) {
                        return interaction.editReply('❌ **Error:** You must attach a file using the file upload option when adding game files.');
                    }
                    stockDB.file.push({ 
                        id: nextId,
                        url: uploadedFile.url, 
                        name: uploadedFile.name, 
                        used: false,
                        usesLeft: customUses,
                        maxUses: customUses,
                        productId,
                        uniqueId
                    });
                    await saveStockDB(stockDB);
                    const totalAvailable = stockDB.file.filter(i => !i.used).length;
                    return interaction.editReply(`✅ Successfully added file **\`${uploadedFile.name}\`** as **#${String(nextId).padStart(5, '0')}** (Product ID: \`${productId}\`, Uses: \`${customUses}\`) to **FILE** stock!\n📦 Available: **${totalAvailable}**`);
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

        if (interaction.commandName === 'help') {
            const helpEmbed = new EmbedBuilder()
                .setColor(0x0099FF)
                .setTitle('🤖 Bot Instructions & Help')
                .addFields(
                    { name: '🛒 For Buyers', value: `1. Generate your key in-game.\n2. Open the check menu in-game to verify and redeem your key directly into your Discord DMs.` },
                    { name: '🛠️ For Admins', value: '• Use `/stock add` to manage items, and use setup commands as needed.' }
                );

            return await interaction.editReply({ embeds: [helpEmbed] });
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