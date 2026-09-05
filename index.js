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
        const data = req.body || {};
        const keyStr = data.key || data.Key || data.code || data.Code;
        
        if (!keyStr) {
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
            assetIds: Array.isArray(data.assetIds) ? data.assetIds.map(Number) : [],
            groupIds: Array.isArray(data.groupIds) ? data.groupIds.map(Number) : [],
            requirementsMet: Boolean(data.requirementsMet),
            rewardFileName: data.fileName || null,
            productId: data.productId ? Number(data.productId) : null,
            category: data.category || 'code'
        };

        await redis.set(`key:${cleanKey}`, JSON.stringify(keyData), { ex: 259200 });
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

app.post('/check-key', async (req, res) => {
    try {
        const data = req.body || {};
        // Handle both direct JSON and Roblox RemoteFunction argument arrays/tables sent through the bridge
        const bodyData = data.data || data; 
        const keyStr = bodyData.key || bodyData.Key || bodyData.code || bodyData.Code || (Array.isArray(bodyData) ? bodyData[0] : null);

        if (!keyStr) {
            return res.status(200).json({ success: false, valid: false, error: 'Missing key field' });
        }

        const cleanKey = String(keyStr).trim().toUpperCase();
        const rawData = await redis.get(`key:${cleanKey}`);

        if (!rawData) {
            return res.status(200).json({ success: false, valid: false, error: 'Key not found' });
        }

        const keyData = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
        
        if (Date.now() > keyData.expiresAt) {
            return res.status(200).json({ success: false, valid: false, error: 'Key has expired' });
        }

        if (keyData.used || keyData.usesLeft <= 0) {
            return res.status(200).json({ success: true, valid: false, used: true, error: 'Key already used' });
        }

        return res.status(200).json({ success: true, valid: true, used: false, data: keyData });
    } catch (err) {
        console.error('❌ [ERROR] Server error on /check-key:', err);
        return res.status(500).json({ success: false, valid: false, error: 'Internal Server Error' });
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
        } catch (dmErr) {}

        return res.status(200).json({ success: true, reward: codeContent || fileItem?.name });
    } catch (err) {
        console.error('❌ [ERROR] Server error on /redeem-key:', err);
        return res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

app.post('/check-requirements', async (req, res) => {
    try {
        const data = req.body || {};
        const productId = Number(data.productId || data.ProductId);

        if (!productId) {
            return res.status(200).json({ success: false, error: 'Missing productId field' });
        }

        const stockDB = await loadStockDB();
        const matchedItem = [...stockDB.code, ...stockDB.file].find(item => Number(item.productId) === productId);

        if (!matchedItem) {
            return res.status(200).json({ success: false, error: 'Product not found in stock' });
        }

        const assetIds = matchedItem.assetIds || (matchedItem.assetId ? [matchedItem.assetId] : []);
        const groupIds = matchedItem.groupIds || (matchedItem.groupId ? [matchedItem.groupId] : []);

        return res.status(200).json({
            success: true,
            assetIds: assetIds.map(Number),
            groupIds: groupIds.map(Number),
        });
    } catch (err) {
        console.error('❌ [ERROR] Server error on /check-requirements:', err);
        return res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

app.post('/add-stock', async (req, res) => {
    try {
        const data = req.body || {};
        const productId = Number(data.productId);
        const uses = Number(data.uses || 1);
        
        const assetIds = data.assetIds ? (Array.isArray(data.assetIds) ? data.assetIds.map(Number) : String(data.assetIds).split(',').map(Number)) : [];
        const groupIds = data.groupIds ? (Array.isArray(data.groupIds) ? data.groupIds.map(Number) : String(data.groupIds).split(',').map(Number)) : [];

        if (!productId) {
            return res.status(400).json({ success: false, error: 'Missing productId' });
        }

        const stockDB = await loadStockDB();
        let nextId = 1;
        if (stockDB.file.length > 0 || stockDB.code.length > 0) {
            const allIds = [...stockDB.file, ...stockDB.code].map(i => i.id || 0);
            nextId = Math.max(...allIds, 0) + 1;
        }

        stockDB.code.push({
            id: nextId,
            content: `AUTO-GEN-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
            used: false,
            usesLeft: uses,
            maxUses: uses,
            productId: productId,
            assetIds: assetIds,
            groupIds: groupIds
        });

        await saveStockDB(stockDB);
        return res.status(200).json({ success: true, message: 'Stock added successfully' });
    } catch (err) {
        console.error('❌ [ERROR] Server error on /add-stock:', err);
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
            .setDescription('Configure Roblox integration, stock items, and requirements (Admin Only)')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('stock')
            .setDescription('Check how many rewards are left in stock'),
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
            .setDescription('Get the GitHub source code link'),
        new SlashCommandBuilder()
            .setName('activate')
            .setDescription('Activate a generated key and receive your reward in DMs')
            .addStringOption(option =>
                option.setName('key')
                    .setDescription('Enter your working key here')
                    .setRequired(true)
            )
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
        // Handle Modal Submissions
        if (interaction.isModalSubmit() && interaction.customId === 'setup_config_modal') {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

            const robloxId = interaction.fields.getTextInputValue('roblox_id');
            const rewardType = interaction.fields.getTextInputValue('reward_type').trim().toLowerCase();
            const rawInput = interaction.fields.getTextInputValue('raw_codes');
            
            const rawAssetInput = interaction.fields.getTextInputValue('asset_id') || '';
            const assetIds = rawAssetInput.split(/[,,\s]+/).map(i => Number(i.trim())).filter(n => !isNaN(n) && n > 0);

            const rawGroupInput = interaction.fields.getTextInputValue('group_id') || '';
            const groupIds = rawGroupInput.split(/[,,\s]+/).map(i => Number(i.trim())).filter(n => !isNaN(n) && n > 0);

            const stockDB = await loadStockDB();
            let addedCount = 0;

            let nextId = 1;
            if (stockDB.file.length > 0 || stockDB.code.length > 0) {
                const allIds = [...stockDB.file, ...stockDB.code].map(i => i.id || 0);
                nextId = Math.max(...allIds, 0) + 1;
            }

            const productId = Math.floor(100000 + Math.random() * 900000);
            const uniqueId = `PROD-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;

            if (rewardType.includes('file') || (rawInput && rawInput.startsWith('http'))) {
                stockDB.file.push({ 
                    id: nextId,
                    url: rawInput, 
                    name: rawInput.split('/').pop() || 'game-file.rar', 
                    used: false,
                    usesLeft: 1,
                    maxUses: 1,
                    productId,
                    uniqueId,
                    assetIds: assetIds,
                    groupIds: groupIds
                });
                addedCount++;
            } else if (rawInput) {
                const itemsList = rawInput.split(/[\n,]+/).map(i => i.trim()).filter(i => i.length > 0);
                for (const item of itemsList) {
                    stockDB.code.push({ 
                        id: nextId++, 
                        content: item, 
                        used: false, 
                        usesLeft: 1, 
                        maxUses: 1,
                        productId,
                        uniqueId,
                        assetIds: assetIds,
                        groupIds: groupIds
                    });
                    addedCount++;
                }
            }

            await saveStockDB(stockDB);
            await redis.set('setup:config', JSON.stringify({ robloxId, rewardType }));

            return await interaction.editReply({
                content: `✅ **Setup Completed Successfully!**\n- **Roblox ID:** \`${robloxId || 'None'}\`\n- **Stock Items Added:** \`${addedCount}\`\n- **Product ID:** \`${productId}\`\n- **Required Asset IDs:** \`${assetIds.length > 0 ? assetIds.join(', ') : 'None'}\`\n- **Required Group IDs:** \`${groupIds.length > 0 ? groupIds.join(', ') : 'None'}\``
            });
        }

        // Handle Slash Commands
        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === 'setup') {
                const modal = new ModalBuilder()
                    .setCustomId('setup_config_modal')
                    .setTitle('Setup Configuration & Requirements');

                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('roblox_id').setLabel('Your Roblox User / Seller ID').setPlaceholder('123456789').setStyle(TextInputStyle.Short).setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('reward_type').setLabel('Reward Type ("code" or "file")').setPlaceholder('code').setStyle(TextInputStyle.Short).setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('raw_codes').setLabel('Codes (One per line) or File URL').setPlaceholder('CODE1\nCODE2').setStyle(TextInputStyle.Paragraph).setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('asset_id').setLabel('Required Asset / Gamepass IDs').setPlaceholder('123, 456 (Optional)').setStyle(TextInputStyle.Short).setRequired(false)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('group_id').setLabel('Required Group IDs').setPlaceholder('987, 654 (Optional)').setStyle(TextInputStyle.Short).setRequired(false)
                    )
                );

                return await interaction.showModal(modal);
            }

            // For all other commands, defer reply normally
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

            if (interaction.commandName === 'activate') {
                const keyInput = interaction.options.getString('key').trim().toUpperCase();
                const rawData = await redis.get(`key:${keyInput}`);

                if (!rawData) {
                    return interaction.editReply({ content: '❌ **Error:** Invalid, non-existent, or expired key.' });
                }

                const keyData = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
                
                if (Date.now() > keyData.expiresAt) {
                    return interaction.editReply({ content: '❌ **Error:** This key has expired.' });
                }

                if (keyData.used || keyData.usesLeft <= 0) {
                    return interaction.editReply({ content: '⚠️ **Error:** This key has already been used.' });
                }

                const stockDB = await loadStockDB();
                const requestedCategory = keyData.category || 'code';

                let fileItem = null;
                let codeContent = null;
                let assignedId = 1;

                if (requestedCategory === 'file') {
                    const fileIndex = stockDB.file.findIndex(item => !item.used || (item.usesLeft && item.usesLeft > 0));
                    if (fileIndex === -1) return interaction.editReply({ content: '❌ **Error:** Stock is empty.' });
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
                    if (codeIndex === -1) return interaction.editReply({ content: '❌ **Error:** Stock is empty.' });
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

                await redis.set(`key:${keyInput}`, JSON.stringify(keyData));
                await saveStockDB(stockDB);

                try {
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

                    await interaction.user.send({
                        content: dmText,
                        files: attachment ? [attachment] : []
                    });

                    return interaction.editReply({ content: '✅ **Success!** Check your Direct Messages for your reward.' });
                } catch (dmErr) {
                    return interaction.editReply({ content: '⚠️ Key is valid, but **failed to send you a DM**. Please open your DMs to receive rewards.' });
                }
            }

            if (interaction.commandName === 'stock') {
                const stockDB = await loadStockDB();
                const codeAvailable = stockDB.code.filter(i => !i.used).length;
                const fileAvailable = stockDB.file.filter(i => !i.used).length;

                return interaction.editReply({
                    content: `📦 **Stock Status Overview:**\n• **Codes:** ${codeAvailable} available\n• **Game Files:** ${fileAvailable} available`
                });
            }

            if (interaction.commandName === 'help') {
                const helpEmbed = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle('🤖 Bot Instructions & Help')
                    .addFields(
                        { name: '🛒 For Buyers', value: `1. Generate your key in-game.\n2. Use the \`/activate\` command with your working key to receive your reward directly into your Discord DMs.` },
                        { name: '🛠️ For Admins/Sellers', value: '• Use `/setup` to configure product requirements like Asset IDs or Group IDs alongside your stock codes.' }
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

                return interaction.editReply({ content: `🗑️ **All database keys, config, and stock files wiped completely!**` });
            }

            if (interaction.commandName === 'sourcecode') {
                return interaction.editReply({ content: `📂 **Source Code:**\nhttps://github.com/deleppp/RoPurchase` });
            }
        }
    } catch (err) {
        console.error('❌ Error handling command interaction:', err);
        try {
            if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '❌ An error occurred while processing this command.', flags: [MessageFlags.Ephemeral] }).catch(() => {});
            } else if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: '❌ An error occurred while processing this command.' }).catch(() => {});
            }
        } catch (_) {}
    }
});

client.login(process.env.DISCORD_TOKEN);