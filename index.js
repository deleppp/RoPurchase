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
        
        // Strict mapping: Do NOT fake requirements if they weren't explicitly passed
        const keyData = {
            used: false,
            usesLeft: Number(data.uses || 1),
            maxUses: Number(data.uses || 1),
            expiresAt: Date.now() + 72 * 3600 * 1000,
            player: data.player || 'Unknown',
            userId: Number(data.userId || 0),
            hasGamepass: Boolean(data.hasGamepass), // Will be false if not owned
            hasAsset: Boolean(data.hasAsset),
            inGroup: Boolean(data.inGroup),
            requirementsMet: Boolean(data.requirementsMet), 
            rewardFileName: data.fileName || null,
            // Only assign a productId if explicitly provided; otherwise leave null/undefined
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
                    .setDescription('Your activation key')
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
                    .addStringOption(option =>
                        option.setName('items')
                            .setDescription('Text items or codes')
                            .setRequired(false)
                    )
                    .addAttachmentOption(option =>
                        option.setName('file')
                            .setDescription('Upload file directly')
                            .setRequired(false)
                    )
                    .addIntegerOption(option =>
                        option.setName('uses')
                            .setDescription('Number of allowed redemptions per key/item')
                            .setRequired(false)
                    )
                    .addStringOption(option =>
                        option.setName('gamepass_id')
                            .setDescription('Required Gamepass ID')
                            .setRequired(false)
                    )
                    .addStringOption(option =>
                        option.setName('asset_id')
                            .setDescription('Required Asset ID (shirt, pants, etc.)')
                            .setRequired(false)
                    )
                    .addStringOption(option =>
                        option.setName('group_id')
                            .setDescription('Required Group ID')
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
    
    // Try looking up both with and without the prefix to catch any mismatch
    const possibleKeys = [`key:${cleanInput}`, cleanInput];

    for (const redisKey of possibleKeys) {
        try {
            const rawData = await redis.get(redisKey);
            if (rawData) {
                const parsedData = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
                return { targetKey: cleanInput, keyData: parsedData };
            }
        } catch (err) {
            console.error(`❌ Error fetching ${redisKey} from Redis:`, err);
        }
    }
    
    return { targetKey: null, keyData: null };
}

function buildReceiptData(keyData, targetKey) {
    return {
        receiptId: `#${String(keyData.itemId || 1).padStart(5, '0')}`,
        productId: keyData.productId || 'N/A',
        uniqueId: keyData.uniqueId || 'N/A',
        key: targetKey,
        player: keyData.player,
        userId: keyData.userId,
        category: keyData.category || 'unknown',
        rewardName: keyData.rewardFileName || keyData.rewardCode || 'N/A',
        redeemedAt: new Date().toISOString()
    };
}

async function processRedemption(interaction, inputKey) {
    const { targetKey, keyData } = await fetchKeyData(inputKey);

    if (!keyData) {
        return interaction.editReply(`❌ **Error:** Invalid activation key (\`${inputKey}\`). Not found in database.`);
    }

    if (Date.now() > keyData.expiresAt) {
        return interaction.editReply('❌ **Error:** This key has expired (over 72 hours old).');
    }

    // Check requirements (Gamepass, Asset, Group)
    if (keyData.requirementsMet === false || (!keyData.hasGamepass && keyData.gamepassId) || (!keyData.hasAsset && keyData.assetId) || (!keyData.inGroup && keyData.groupId)) {
        return interaction.editReply(
            `⚠️ **Requirements Not Met!**\n` +
            `To redeem this key, you must fulfill the in-game requirements:\n` +
            (keyData.gamepassId ? `• **Gamepass ID:** \`${keyData.gamepassId}\` (Prompted in-game)\n` : '') +
            (keyData.assetId ? `• **Asset ID:** \`${keyData.assetId}\`\n` : '') +
            (keyData.groupId ? `• **Group ID:** \`${keyData.groupId}\`\n` : '') +
            `\nPlease open the game, complete the missing requirement prompts, and try again!`
        );
    }

    // Multi-use support check
    const discordId = interaction.user.id;
    if (keyData.redeemedByDiscordIds && keyData.redeemedByDiscordIds.includes(discordId)) {
        return interaction.editReply('❌ **Error:** You have already redeemed this key with your Discord account.');
    }

    if (keyData.used && (keyData.usesLeft <= 0 || !keyData.usesLeft)) {
        return interaction.editReply('❌ **Error:** This key has completely run out of uses and cannot be redeemed again.');
    }

    const stockDB = await loadStockDB();
    const requestedCategory = keyData.category || 'code';

    let fileItem = null;
    let codeContent = null;
    let assignedId = 1;
    let itemCategory = requestedCategory;

    if (requestedCategory === 'file') {
        const fileIndex = stockDB.file.findIndex(item => !item.used || (item.usesLeft && item.usesLeft > 0));
        if (fileIndex === -1) {
            return interaction.editReply('⚠️ **Stock Error:** Game File stock is completely empty! Please contact the administrator.');
        }
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
        if (codeIndex === -1) {
            return interaction.editReply('⚠️ **Stock Error:** Code stock is completely empty! Please contact the administrator.');
        }
        codeContent = stockDB.code[codeIndex].content;
        
        if (stockDB.code[codeIndex].usesLeft && stockDB.code[codeIndex].usesLeft > 1) {
            stockDB.code[codeIndex].usesLeft -= 1;
        } else {
            stockDB.code[codeIndex].used = true;
            stockDB.code[codeIndex].usesLeft = 0;
        }
        assignedId = stockDB.code[codeIndex].id || (stockDB.file.length + codeIndex + 1);
    }

    // Handle multi-use tracking on the key itself
    if (!keyData.redeemedByDiscordIds) keyData.redeemedByDiscordIds = [];
    keyData.redeemedByDiscordIds.push(discordId);
    
    if (keyData.usesLeft > 1) {
        keyData.usesLeft -= 1;
    } else {
        keyData.used = true;
        keyData.usesLeft = 0;
    }

    keyData.rewardCode = codeContent;
    keyData.rewardFileUrl = fileItem ? fileItem.url : null;
    keyData.rewardFileName = fileItem ? fileItem.name : (keyData.rewardFileName || null);
    keyData.itemId = assignedId;
    keyData.category = itemCategory;
    
    await redis.set(`key:${targetKey}`, JSON.stringify(keyData));
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

    const formattedId = `#${String(assignedId).padStart(5, '0')}`;
    const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`print_txt_${targetKey}`)
            .setLabel('Print as .txt')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`print_json_${targetKey}`)
            .setLabel('Print as .json')
            .setStyle(ButtonStyle.Secondary)
    );

    try {
        const dmChannel = await interaction.user.createDM();
        let dmText = `🎁 **Your Redeemed Rewards (${formattedId}) [Product ID: ${keyData.productId}]:**\n`;
        if (codeContent) {
            dmText += `\n📌 **Code:**\n\`\`\`${codeContent}\`\`\``;
        }
        if (fileItem) {
            dmText += `\n📁 **Game File:** \`${fileItem.name}\``;
        } else if (keyData.rewardFileName) {
            dmText += `\n📁 **Game File:** \`${keyData.rewardFileName}\``;
        }
        await dmChannel.send({
            content: dmText,
            files: attachment ? [attachment] : [],
            components: [actionRow]
        });
        dmSuccessful = true;
    } catch (dmErr) {
        console.error(`⚠️ Could not send DM to user ${interaction.user.id}:`, dmErr.message);
    }

    let responseText = codeContent ? `📌 **Code:**\n\`\`\`${codeContent}\`\`\`` : '';
    if (fileItem) {
        responseText += `\n📁 **Game File:** \`${fileItem.name}\``;
    } else if (keyData.rewardFileName) {
        responseText += `\n📁 **Game File:** \`${keyData.rewardFileName}\``;
    }

    if (dmSuccessful) {
        return interaction.editReply({
            content: `✅ **Success!** Your reward items (${formattedId}, Product ID: \`${keyData.productId}\`) have been sent directly to your **DMs**! 📩`,
            components: [actionRow]
        });
    } else {
        return interaction.editReply({
            content: `✅ **Success! (${formattedId})** (⚠️ *DMs are closed, so your items are displayed below*)\n\n${responseText}`,
            files: attachment ? [attachment] : [],
            components: [actionRow]
        });
    }
}

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
                    .setLabel('Enter your activation key')
                    .setPlaceholder('e.g., ABC12XYZ7890DEF')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                modal.addComponents(new ActionRowBuilder().addComponents(keyInput));
                return await interaction.showModal(modal);
            }

            if (interaction.customId.startsWith('print_txt_') || interaction.customId.startsWith('print_json_')) {
                const targetKey = interaction.customId.replace(/print_(txt|json)_/, '');
                const { keyData } = await fetchKeyData(targetKey);

                if (!keyData) {
                    return interaction.reply({ content: '❌ Error: Receipt data not found.', flags: [MessageFlags.Ephemeral] });
                }

                const receipt = buildReceiptData(keyData, targetKey);
                const isJson = interaction.customId.startsWith('print_json_');
                const fileContent = isJson ? JSON.stringify(receipt, null, 4) : 
                    `========================================\n` +
                    `                     RECEIPT                    \n` +
                    `========================================\n` +
                    `Receipt ID : ${receipt.receiptId}\n` +
                    `Product ID : ${receipt.productId}\n` +
                    `Unique ID  : ${receipt.uniqueId}\n` +
                    `Key        : ${receipt.key}\n` +
                    `Player     : ${receipt.player} (${receipt.userId})\n` +
                    `Category   : ${receipt.category.toUpperCase()}\n` +
                    `Reward     : ${receipt.rewardName}\n` +
                    `Redeemed At: ${receipt.redeemedAt}\n` +
                    `========================================\n`;

                const attachment = new AttachmentBuilder(Buffer.from(fileContent, 'utf-8'), {
                    name: `receipt_${receipt.receiptId.replace('#', '')}.${isJson ? 'json' : 'txt'}`
                });

                return interaction.reply({
                    content: `📄 Here is your receipt (${receipt.receiptId}):`,
                    files: [attachment],
                    flags: [MessageFlags.Ephemeral]
                });
            }
        }

        if (!interaction.isChatInputCommand()) return;

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

        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        if (interaction.commandName === 'stock') {
            const subcommand = interaction.options.getSubcommand();
            const stockDB = await loadStockDB();
            
            if (subcommand === 'add') {
                const category = interaction.options.getString('category');
                const rawItems = interaction.options.getString('items');
                const uploadedFile = interaction.options.getAttachment('file');
                const customUses = interaction.options.getInteger('uses') || 1;
                const gamepassId = interaction.options.getString('gamepass_id');
                const assetId = interaction.options.getString('asset_id');
                const groupId = interaction.options.getString('group_id');

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
                            uniqueId,
                            gamepassId,
                            assetId,
                            groupId
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
                        uniqueId,
                        gamepassId,
                        assetId,
                        groupId
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

            const formattedId = keyData.itemId ? `#${String(keyData.itemId).padStart(5, '0')}` : 'N/A';
            const itemTypeLabel = keyData.category ? keyData.category.toUpperCase() : 'UNKNOWN';

            return interaction.editReply(
                `🔍 **Key Info:**\n` +
                `- **Key:** \`${targetKey}\`\n` +
                `- **Product ID:** \`${keyData.productId || 'N/A'}\`\n` +
                `- **Unique ID:** \`${keyData.uniqueId || 'N/A'}\`\n` +
                `- **Item Type:** \`${itemTypeLabel}\`\n` +
                `- **Item ID:** \`${formattedId}\`\n` +
                `- **Player:** \`${keyData.player}\` (ID: \`${keyData.userId}\`)\n` +
                `- **Uses Left:** \`${keyData.usesLeft ?? 1}\` / \`${keyData.maxUses ?? 1}\`\n` +
                `- **Status:** ${keyData.used ? '🔴 **Redeemed**' : '🟢 **Active**'}\n` +
                `- **Requirements Met:** ${keyData.requirementsMet !== false ? '✅ Yes' : '❌ No'}` +
                (keyData.rewardFileName ? `\n- **File Sent:** \`${keyData.rewardFileName}\`` : '')
            );
        }

        if (interaction.commandName === 'help') {
            const helpEmbed = new EmbedBuilder()
                .setColor(0x0099FF)
                .setTitle('🤖 Bot Instructions & Help')
                .addFields(
                    { name: '🛒 For Buyers', value: `1. Ensure you meet game requirements (Gamepass, Asset, Group) in-game.\n2. Get your key and use \`/redeemkey\` to claim rewards.` },
                    { name: '🛠️ For Admins', value: '• Use `/stock add` to assign unique Product IDs, multi-use permissions, and asset/group/gamepass requirements.' }
                );

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('open_redeem_modal')
                    .setLabel('🎁 Redeem Key')
                    .setStyle(ButtonStyle.Primary)
            );

            return await interaction.editReply({ 
                embeds: [helpEmbed], 
                components: [row] 
            });
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