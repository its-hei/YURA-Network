# YURA Discord onboarding (Cloud)
Opt-in: existing Zira and Discord roles are untouched until setup is completed.
The existing YURA bot token is reused. The Discord application owner must set the Interactions Endpoint URL to the Worker /discord/interactions endpoint after saving configuration.
Authenticated admin API: /api/admin/discord-onboarding (existing Bearer ADMIN_KEY or validated broadcaster Twitch OAuth).
PUT JSON {guild,welcome,staff,boomer,fc} (Discord snowflake IDs); validates appropriate guild resources and fetches the application's public verification key. Do not use privileged roles. Staff channel must be private and only admins can approve FC.
POST publishes/updates the welcome panel; GET returns config and registered profiles (no verification codes). Use separate channels for rules and FC review. Keep Zira active until tested, then remove its reaction-role rule.
Members accept the rules on modal submission and receive Boomer. Nicknames are self-declared display names (1–32 characters), without Twitch verification or strict name syntax. FC is approved by an administrator (existing FC role is accepted). For both communities: matching names (ignoring case, spaces, underscores and hyphens) appear once; distinct names use Twitch (FFXIV) if <=32 characters, otherwise Twitch. Declared names do not confer verified Twitch IDs or subscriber roles. No existing roles are removed by onboarding.

PATCH JSON {discord_id, action: "approve_fc" | "revoke_fc"} lets the authenticated operator manage FC membership. A member cannot recover a manually removed FC role through the registration status button.

Members can edit their declared nicknames whenever needed using Edytuj nicki or the existing community buttons. Community buttons update just the selected fields and add the other community without deleting prior registration or changing existing FC decisions. Pending FC review messages are edited in place. Display names follow declared Twitch/FFXIV names even before FC approval; this never grants FC or subscriber roles. Changing a previously verified Twitch identity clears the verified ID. Self-service cannot restore revoked roles.

## Temporary automatic FC access
For registrations selecting FC or both, the Worker grants FC independently of Boomer; an old pending registration is processed on its next interaction. No review message is sent. Previously approved or revoked members do not regain a manually removed FC role. The explicit admin approve/revoke API remains available. The existing review-channel configuration is retained for later verification but is not used during automatic registration.

## Boomer role retry and nickname priority
Boomer is a self-service rules-acceptance role: a registered member's next status check or form submission retries granting it when the Discord member does not currently have it, even if the database recorded a successful grant earlier. Removing Boomer alone in Discord is therefore not a persistent moderation block. Explicit FC rejections/revocations remain protected; previously approved FC roles removed manually are not restored automatically. Nicknames use Twitch (FFXIV), or Twitch alone if the combined nickname exceeds Discord's length limit; matching names appear once.

## Separate community registration and reset
The public panel now has separate Twitch and Free Company buttons; choosing both sequentially merges the profile. Existing both-community users can still edit both fields. Resetuj rejestrację requires explicit confirmation and clears declared names, verified binding and registration state, removes Boomer and FC only, and restores the default server nickname if the existing nickname matches YURA's generated one. An empty profile is retained to preserve moderation blocks and subscriber synchronization protection. Other roles are not directly modified. Previously revoked FC cannot be recovered through reset.

## Community-specific editing
The public panel contains Twitch, Ordo Noctis and Resetuj rejestrację. Each community opens a private three-button menu (Dodaj or Edytuj, Anuluj, Usuń). Delete clears only the selected name and its verified identity if relevant, then uses the existing role/nickname reconciliation; the other community remains unchanged. Empty optional fields can also remove a name. Discord's native modal footer buttons are not customizable. Existing custom rules text is preserved. The separate public edit button is removed.

## Direct community forms
Twitch and Ordo Noctis now open their modal directly. Existing registrations expose an unchecked single checkbox (Discord component type 23) labelled Usuń zapisany nick. Checking it and submitting clears only that community, using the same role and nickname reconciliation as before. The native Anuluj/Wyślij footer is unchanged. Older private menu buttons remain compatible; no new menu messages are generated.

## Silent community updates
The public panel now contains only Twitch and Ordo Noctis. Both forms have independent editing/removal; updating one name preserves the other at SQL write time. Old Reset buttons no longer clear profiles. Successful form submissions delete their deferred ephemeral acknowledgement; errors and moderation warnings remain visible. Custom rules text is not changed.

## Independent community role policy (2026-11-21)
- Boomer is granted **only** while a Twitch nickname is saved; removing the Twitch nickname removes Boomer while preserving FC.
- FC is granted **only** for a saved Ordo Noctis / FFXIV character name and does not require Boomer; removing the FFXIV name removes FC while preserving Boomer.
- Administrative FC revocation stays persistent. The next registration/status action reconciles the roles from the saved profile. The old rules-text sentence about Boomer requiring either nickname is rewritten in rendered panels.
