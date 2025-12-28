import "dotenv/config";
import { REST, Routes, SlashCommandBuilder } from "discord.js";

const TARGET_CHOICES = [
    { name: "emulator-5556", value: "emulator-5556" },
    { name: "emulator-5560", value: "emulator-5560" },
];

const commands = [
    new SlashCommandBuilder()
        .setName("roblox-open")
        .setDescription("Open Roblox and join Bee Swarm Simulator")
        .addStringOption(o =>
            o.setName("target")
                .setDescription("Which emulator?")
                .setRequired(true)
                .addChoices(...TARGET_CHOICES)
        ),

    new SlashCommandBuilder()
        .setName("roblox-close")
        .setDescription("Close Roblox on the selected emulator")
        .addStringOption(o =>
            o.setName("target")
                .setDescription("Which emulator?")
                .setRequired(true)
                .addChoices(...TARGET_CHOICES)
        ),

    new SlashCommandBuilder()
        .setName("receive-key")
        .setDescription("Tap Receive Key then go back to Roblox (you copy the link manually)")
        .addStringOption(o =>
            o.setName("target")
                .setDescription("Which emulator?")
                .setRequired(true)
                .addChoices(...TARGET_CHOICES)
        ),

    new SlashCommandBuilder()
        .setName("enter-key")
        .setDescription("Enter the key in the box and press Continue")
        .addStringOption(o =>
            o.setName("target")
                .setDescription("Which emulator?")
                .setRequired(true)
                .addChoices(...TARGET_CHOICES)
        )
        .addStringOption(o =>
            o.setName("key")
                .setDescription("Paste the key you received")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("minimize-instances")
        .setDescription("Minimize all emulator instances on this PC (Windows)")
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
);

console.log("✅ Registered slash commands.");
