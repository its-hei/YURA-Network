# YURA Discord onboarding (Cloud)
Opt-in: existing Zira and Discord roles are untouched until setup is completed.
The existing YURA bot token is reused. The Discord application owner must set the Interactions Endpoint URL to the Worker /discord/interactions endpoint after saving configuration.
Authenticated admin API: /api/admin/discord-onboarding (existing Bearer ADMIN_KEY or validated broadcaster Twitch OAuth).
PUT JSON {guild,welcome,staff,boomer,fc} (Discord snowflake IDs); validates appropriate guild resources and fetches the application's public verification key. Do not use privileged roles. Staff channel must be private and only admins can approve FC.
POST publishes/updates the welcome panel; GET returns config and registered profiles (no verification codes). Use separate channels for rules and FC review. Keep Zira active until tested, then remove its reaction-role rule.
Members accept the rules on modal submission and receive Boomer. Nicknames are self-declared display names (1–32 characters), without Twitch verification or strict name syntax. FC is approved by an administrator (existing FC role is accepted). For both communities: matching names (ignoring case, spaces, underscores and hyphens) appear once; distinct names use FFXIV (Twitch) if <=32 characters, otherwise FFXIV. Declared names do not confer verified Twitch IDs or subscriber roles. No existing roles are removed by onboarding.

PATCH JSON {discord_id, action: "approve_fc" | "revoke_fc"} lets the authenticated operator manage FC membership. A member cannot recover a manually removed FC role through the registration status button.

Members can edit their declared nicknames whenever needed using Edytuj nicki or the existing community buttons. Community buttons update just the selected fields and add the other community without deleting prior registration or changing existing FC decisions. Pending FC review messages are edited in place. Display names follow declared Twitch/FFXIV names even before FC approval; this never grants FC or subscriber roles. Changing a previously verified Twitch identity clears the verified ID. Self-service cannot restore revoked roles.
