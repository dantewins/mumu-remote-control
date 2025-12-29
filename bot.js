import "dotenv/config";
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from "discord.js";
import { execSync } from "child_process";
import clipboard from "clipboardy";

const client = new Client({
    intents: [GatewayIntentBits.Guilds],
});

const targetRequired = (o) =>
    o.setName("target")
        .setDescription("ADB device serial (type to autocomplete)")
        .setRequired(true)
        .setAutocomplete(true);

const commands = [
    new SlashCommandBuilder()
        .setName("roblox-open")
        .setDescription("Open Roblox and join Bee Swarm")
        .addStringOption(targetRequired)
        .addBooleanOption((o) => o.setName("vip").setDescription("Join VIP server if set (default: public)").setRequired(false)),

    new SlashCommandBuilder()
        .setName("roblox-close")
        .setDescription("Close Roblox on the selected emulator")
        .addStringOption(targetRequired),

    new SlashCommandBuilder()
        .setName("receive-key")
        .setDescription("Tap Receive Key then go back to Roblox")
        .addStringOption(targetRequired),

    new SlashCommandBuilder()
        .setName("enter-key")
        .setDescription("Enter the key in the box and press Continue")
        .addStringOption(targetRequired)
        .addStringOption((o) =>
            o.setName("key").setDescription("Paste the key you received").setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("minimize-instances")
        .setDescription("Minimize emulator instances (Windows)"),

    new SlashCommandBuilder()
        .setName("update-bot")
        .setDescription("Update bot from GitHub if new commits available"),

    new SlashCommandBuilder()
        .setName("farm")
        .setDescription("Configure and monitor Roblox farming")
        .addSubcommand((sc) =>
            sc
                .setName("add")
                .setDescription("Add a Roblox username to monitor")
                .addStringOption((o) => o.setName("username").setDescription("Roblox username").setRequired(true))
                .addStringOption((o) =>
                    o.setName("target")
                        .setDescription("ADB device serial to map this account to (autocomplete)")
                        .setRequired(false)
                        .setAutocomplete(true)
                )
        )
        .addSubcommand((sc) =>
            sc
                .setName("remove")
                .setDescription("Remove a monitored username")
                .addStringOption((o) => o.setName("username").setDescription("Roblox username").setRequired(true))
        )
        .addSubcommand((sc) => sc.setName("list").setDescription("List monitored usernames"))
        .addSubcommand((sc) =>
            sc
                .setName("set-place")
                .setDescription("Set Bee Swarm placeId considered 'farming'")
                .addIntegerOption((o) => o.setName("place_id").setDescription("Roblox placeId").setRequired(true))
        )
        .addSubcommand((sc) =>
            sc
                .setName("set-webhook")
                .setDescription("Set Discord webhook URL for alerts")
                .addStringOption((o) => o.setName("url").setDescription("Discord webhook URL").setRequired(true))
        )
        .addSubcommand((sc) => sc.setName("clear-webhook").setDescription("Clear webhook URL"))
        .addSubcommand((sc) =>
            sc
                .setName("set-poll")
                .setDescription("Set poll interval (seconds)")
                .addIntegerOption((o) => o.setName("seconds").setDescription("Seconds").setRequired(true))
        )
        .addSubcommand((sc) =>
            sc
                .setName("set-fails")
                .setDescription("Consecutive non-farming polls before alerting")
                .addIntegerOption((o) => o.setName("count").setDescription("Count").setRequired(true))
        )
        .addSubcommand((sc) =>
            sc
                .setName("set-cooldown")
                .setDescription("Minimum seconds between alerts per user")
                .addIntegerOption((o) => o.setName("seconds").setDescription("Seconds").setRequired(true))
        )
        .addSubcommand((sc) =>
            sc
                .setName("set-rejoin")
                .setDescription("Auto rejoin Bee Swarm (public) when disconnected")
                .addBooleanOption((o) => o.setName("enabled").setDescription("Enable auto rejoin").setRequired(true))
                .addIntegerOption((o) => o.setName("retries").setDescription("How many retries (optional)").setRequired(false))
                .addIntegerOption((o) => o.setName("delay_ms").setDescription("Delay between retries (ms, optional)").setRequired(false))
                .addBooleanOption((o) => o.setName("close_first").setDescription("Force close Roblox before rejoin (optional)").setRequired(false))
                .addBooleanOption((o) => o.setName("use_vip").setDescription("Use VIP server for auto-rejoin if set (optional)").setRequired(false))
        )
        .addSubcommand((sc) =>
            sc
                .setName("set-vip-link")
                .setDescription("Set VIP server link for private joins")
                .addStringOption((o) => o.setName("link").setDescription("Full VIP server link").setRequired(true))
        )
        .addSubcommand((sc) =>
            sc
                .setName("restart")
                .setDescription("Force restart/rejoin on device")
                .addStringOption(targetRequired)
                .addBooleanOption((o) => o.setName("vip").setDescription("Join VIP server if set (default: public)").setRequired(false))
        )
        .addSubcommand((sc) => sc.setName("start").setDescription("Start monitoring"))
        .addSubcommand((sc) => sc.setName("stop").setDescription("Stop monitoring"))
        .addSubcommand((sc) => sc.setName("status").setDescription("Show current monitor status")),
].map((c) => c.toJSON());

client.once("ready", async () => {
    console.log(`Logged in as ${client.user.tag}`);

    try {
        console.log("Registering slash commands...");
        const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: commands }
        );

        console.log("Slash commands registered successfully.");
    } catch (error) {
        console.error("Failed to register slash commands:", error);
    }
});

client.on("interactionCreate", async (interaction) => {
    if (interaction.isAutocomplete()) {
        if (allowedUsers.size > 0 && !allowedUsers.has(interaction.user.id)) {
            await interaction.respond([]);
            return;
        }
        const focused = interaction.options.getFocused(true);
        if (focused.name !== "target") {
            await interaction.respond([]);
            return;
        }
        const typed = String(focused.value || "").toLowerCase();
        const targets = await getAdbTargets();
        const choices = targets
            .filter((t) => t.serial.toLowerCase().includes(typed))
            .slice(0, 25)
            .map((t) => ({ name: `${t.serial} (${t.state})`, value: t.serial }));
        await interaction.respond(choices);
        return;
    }

    if (!interaction.isChatInputCommand()) return;

    if (allowedUsers.size > 0 && !allowedUsers.has(interaction.user.id)) {
        await interaction.reply({ content: "Not authorized.", ephemeral: true });
        return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
        if (commandName === 'update-bot') {
            await interaction.reply('Updating bot from GitHub...');

            try {
                const { execSync } = require('child_process');

                execSync('git fetch origin', { stdio: 'inherit', shell: true });
                const status = execSync('git status -uno').toString();

                if (!status.includes('Your branch is behind') && !status.includes('can be fast-forwarded')) {
                    await interaction.editReply('Bot is already up to date.');
                    return;
                }

                await interaction.editReply('New commits found. Pulling changes...');

                execSync('git pull', { stdio: 'inherit', shell: true });

                await interaction.editReply('Installing dependencies...');
                execSync('npm install', { stdio: 'inherit', shell: true });

                await interaction.editReply('Update complete. Restarting bot...');

                console.log('Update successful. Restarting process...');
                process.exit(0);

            } catch (error) {
                console.error(error);
                await interaction.editReply(`Update failed:\n\`\`\`\n${error.message}\n\`\`\``);
            }
        }

        if (interaction.commandName === "minimize-instances") {
            await minimizeInstancesWindows();
            await interaction.editReply("Minimized emulator instances");
            return;
        }

        if (interaction.commandName === "roblox-open") {
            const target = interaction.options.getString("target", true);
            const useVip = interaction.options.getBoolean("vip", false) ?? false;
            await openAndJoinBeeSwarm(target, useVip);
            await interaction.editReply(`Opened Roblox + joined Bee Swarm on **${target}** (VIP: ${useVip})`);
            return;
        }

        if (interaction.commandName === "roblox-close") {
            const target = interaction.options.getString("target", true);
            await closeRoblox(target);
            await interaction.editReply(`Closed Roblox on **${target}**`);
            return;
        }

        if (commandName === 'receive-key') {
            const target = interaction.options.getString('target');

            await interaction.deferReply({ ephemeral: true });

            try {
                const key = await clipboard.read();

                if (!key || key.trim() === '') {
                    await interaction.editReply('Clipboard is empty.');
                    return;
                }

                const trimmedKey = key.trim();

                await interaction.editReply({
                    content: `Key received:\n\`\`\`\n${trimmedKey}\n\`\`\``,
                });

            } catch (error) {
                await interaction.editReply('Failed to read clipboard. (Install package clipboardy)');
            }
        }

        if (interaction.commandName === "enter-key") {
            const target = interaction.options.getString("target", true);
            const key = interaction.options.getString("key", true);
            await enterKeyAndContinue(target, key);
            await interaction.editReply(`Entered key + pressed Continue on **${target}**`);
            return;
        }

        if (interaction.commandName === "farm") {
            const sub = interaction.options.getSubcommand();

            if (sub === "set-vip-link") {
                const link = interaction.options.getString("link", true).trim();
                config.farm.vipLink = link;
                await saveConfig(config);
                await interaction.editReply(`VIP link set to ${link}`);
                return;
            }

            if (sub === "set-place") {
                config.farm.placeId = interaction.options.getInteger("place_id", true);
                await saveConfig(config);
                await interaction.editReply(`placeId set to **${config.farm.placeId}**`);
                return;
            }

            if (sub === "set-webhook") {
                config.farm.webhookUrl = interaction.options.getString("url", true).trim();
                await saveConfig(config);
                await interaction.editReply("Webhook URL saved");
                return;
            }

            if (sub === "clear-webhook") {
                config.farm.webhookUrl = "";
                await saveConfig(config);
                await interaction.editReply("Webhook cleared");
                return;
            }

            if (sub === "set-poll") {
                config.farm.pollSeconds = Math.max(10, interaction.options.getInteger("seconds", true));
                await saveConfig(config);
                await interaction.editReply(`Poll interval set to **${config.farm.pollSeconds}s**`);
                return;
            }

            if (sub === "set-fails") {
                config.farm.consecutiveFails = Math.max(1, interaction.options.getInteger("count", true));
                await saveConfig(config);
                await interaction.editReply(`Fails threshold set to **${config.farm.consecutiveFails}**`);
                return;
            }

            if (sub === "set-cooldown") {
                config.farm.cooldownSeconds = Math.max(30, interaction.options.getInteger("seconds", true));
                await saveConfig(config);
                await interaction.editReply(`Cooldown set to **${config.farm.cooldownSeconds}s**`);
                return;
            }

            if (sub === "set-rejoin") {
                const enabled = interaction.options.getBoolean("enabled", true);
                const retries = interaction.options.getInteger("retries", false);
                const delayMs = interaction.options.getInteger("delay_ms", false);
                const closeFirst = interaction.options.getBoolean("close_first", false);
                const useVip = interaction.options.getBoolean("use_vip", false);

                config.farm.autoRejoin = config.farm.autoRejoin || structuredClone(DEFAULT_CONFIG.farm.autoRejoin);
                config.farm.autoRejoin.enabled = enabled;
                if (retries !== null && retries !== undefined) config.farm.autoRejoin.retries = Math.max(0, retries);
                if (delayMs !== null && delayMs !== undefined) config.farm.autoRejoin.delayMs = Math.max(500, delayMs);
                if (closeFirst !== null && closeFirst !== undefined) config.farm.autoRejoin.closeFirst = !!closeFirst;
                if (useVip !== null && useVip !== undefined) config.farm.autoRejoin.useVip = !!useVip;

                await saveConfig(config);

                await interaction.editReply(
                    `Auto rejoin updated\n` +
                    `enabled=${config.farm.autoRejoin.enabled} retries=${config.farm.autoRejoin.retries} delayMs=${config.farm.autoRejoin.delayMs} closeFirst=${config.farm.autoRejoin.closeFirst} useVip=${config.farm.autoRejoin.useVip}`
                );
                return;
            }

            if (sub === "restart") {
                const target = interaction.options.getString("target", true);
                const useVip = interaction.options.getBoolean("vip", false) ?? false;
                await restartRoblox(target, useVip);
                await interaction.editReply(`Restarted Roblox on **${target}** (VIP: ${useVip})`);
                return;
            }

            if (sub === "add") {
                const username = interaction.options.getString("username", true).trim();
                const usernameLower = username.toLowerCase();
                const targetSerial = interaction.options.getString("target", false) || null;

                const map = await robloxUsernamesToIds([username]);
                const userId = map.get(usernameLower);
                if (!userId) throw new Error(`Could not resolve Roblox username: ${username}`);

                const existing = config.farm.watch.find(w => w.userId === userId || w.usernameLower === usernameLower);
                if (existing) {
                    existing.usernameLower = usernameLower;
                    existing.userId = userId;
                    existing.targetSerial = targetSerial ?? existing.targetSerial ?? null;
                } else {
                    config.farm.watch.push({ usernameLower, userId, targetSerial });
                }

                await saveConfig(config);
                await interaction.editReply(
                    `Added **${usernameLower}** (id: ${userId})${targetSerial ? ` mapped to **${targetSerial}**` : ""}`
                );
                return;
            }

            if (sub === "remove") {
                const usernameLower = interaction.options.getString("username", true).trim().toLowerCase();
                const before = config.farm.watch.length;
                config.farm.watch = config.farm.watch.filter(w => w.usernameLower !== usernameLower);
                await saveConfig(config);
                await interaction.editReply(
                    before === config.farm.watch.length ? `Not found: **${usernameLower}**` : `Removed **${usernameLower}**`
                );
                return;
            }

            if (sub === "list") {
                if (!config.farm.watch.length) {
                    await interaction.editReply("Watch list is empty.");
                    return;
                }
                const lines = config.farm.watch.map(w =>
                    `• ${w.usernameLower}${w.targetSerial ? ` [${w.targetSerial}]` : ""} (id: ${w.userId})`
                );
                await interaction.editReply(lines.join("\n").slice(0, 1900));
                return;
            }

            if (sub === "start") {
                config.farm.enabled = true;
                await saveConfig(config);
                await interaction.editReply("Farm monitor started");
                return;
            }

            if (sub === "stop") {
                config.farm.enabled = false;
                await saveConfig(config);
                await interaction.editReply("Farm monitor stopped");
                return;
            }

            if (sub === "status") {
                const enabled = config.farm.enabled ? "enabled" : "disabled";
                const lines = [
                    `Monitor: ${enabled}`,
                    `placeId: ${config.farm.placeId}`,
                    `poll: ${config.farm.pollSeconds}s | fails: ${config.farm.consecutiveFails} | cooldown: ${config.farm.cooldownSeconds}s`,
                    `autoRejoin: ${config.farm.autoRejoin?.enabled ? `on (retries=${config.farm.autoRejoin.retries}, delayMs=${config.farm.autoRejoin.delayMs})` : "off"}`,
                    `webhook: ${config.farm.webhookUrl ? "set" : "not set"}`,
                    `vipLink: ${config.farm.vipLink ? "set" : "not set"}`,
                    `watching: ${config.farm.watch.length}`,
                    "",
                ];

                for (const w of config.farm.watch.slice(0, 15)) {
                    const st = farmState.get(w.userId);
                    const status = st
                        ? (st.lastWasFarming ? `farming` : `not farming (bad=${st.badCount})`)
                        : "(no data yet)";
                    lines.push(`• ${w.usernameLower}${w.targetSerial ? ` [${w.targetSerial}]` : ""} — ${status}`);
                }

                await interaction.editReply(lines.join("\n").slice(0, 1900));
                return;
            }

            await interaction.editReply("Unknown /farm subcommand.");
            return;
        }

        await interaction.editReply("Unknown command.");
    } catch (e) {
        await interaction.editReply(`Error: ${e.message}`);
    }
});

client.login(process.env.DISCORD_TOKEN);