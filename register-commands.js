import "dotenv/config";
import { REST, Routes, SlashCommandBuilder } from "discord.js";

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

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
);

console.log("Registered slash commands.");