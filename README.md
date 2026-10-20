# Krispies HR Bot

Node.js Discord bot with MongoDB records. Run one persistent bot process; it uses the Discord Gateway rather than an HTTP server.

## Setup

1. Install Node.js 22.12+ and provide a MongoDB instance.
2. Copy `.env.example` to `.env` and fill in your bot token, application/server IDs, channel IDs, Roblox group ID, and explicit Discord HR and Co-Head+ role IDs. Keep `.env` private.
3. Run `npm install`, then `npm run register`, then `npm start`.
4. Invite the bot with the `bot` and `applications.commands` scopes. Grant View Channel, Send Messages, Embed Links, Attach Files, and Read Message History in its configured channels. No Message Content intent or Administrator permission is needed.
5. In Server Settings → Integrations, allow your HR roles to use the commands; Discord's default command visibility requires Manage Server. Runtime checks still require an explicitly configured HR/Co-Head role, even for server administrators.
6. Run `/verificationpanel` as Co-Head+. This posts or updates the saved panel. Members can use the button without HR permissions.

## Commands

| Command | Access | Behavior |
| --- | --- | --- |
| `/robloxlookup account` | HR | Finds an account by ID or exact username; shows username, display name, ID and profile link. Prefix `@` to force a numeric username lookup. |
| `/verificationpanel` | Co-Head+ | Posts Verify button; opens Username, Rank, Timezone, Invited by and optional screenshot form |
| `/issuecon username reason [evidence]` | HR | Private confirmation; issues one strike; queues audit log |
| `/checkreqs username start end` | HR | Reads Series metrics for the supplied ISO date range; offers a quota consequence for an ended, failed period |
| `/adjustreqs rank department metric target` | Co-Head+ | Sets a requirement for an exact rank/department; zero disables a metric |
| `/staffprofile username department` | Co-Head+ | Sets department; Roblox rank is fetched from the configured group |
| `/reslog username reason` | HR | Confirms and logs resignation, including current Roblox group rank |
| `/staffhistory username` | HR | Paginated audit history, strikes, approved LOA and termination status |
| `/syncloas` | Co-Head+ | Fetches Series LOA requests and refreshes Discord review panels |
| `/terminate username` | Co-Head+ | Confirms five-strike termination via the configured Bloxrank adapter |

Each consequence adds one strike. At five, further consequences are blocked. Confirmations expire after ten minutes and can only be used once by their creator. Approval buttons recheck the reviewer's roles. Concurrent strike changes use version checks so two confirmations cannot take a staff member past five strikes.

Quota checks use exact Roblox rank names and HR-assigned departments. An approved LOA overlapping any part of the period exempts the whole period (conservative default). Unavailable Series data never counts as a quota failure. Progress, rank, department, strike count and LOA eligibility are rechecked at confirmation. One quota consequence is allowed per exact date range. Configure consistent quota periods operationally; arbitrary overlapping ranges are not deduplicated. There is no automatic scheduled scan yet.

Set `MR_RANK_NAMES` to the comma-separated exact Roblox group rank names eligible for resignation logging. Resignations record the current authoritative group rank and reject ranks outside that list. Resignation does not change their rank. Termination does not erase history or strikes, and terminated records remain blocked. Rehiring and strike appeals need a separate policy before adding commands.

## Verification

The verification panel uses the bundled images in `assets/`: the #Verification banner appears first, followed by the instructions and the Krispies footer banner. Run `/verificationpanel` again after restarting the bot to update the existing panel.

The form accepts one optional image up to 10 MB. Submissions are stored in MongoDB and posted to the private review channel with an attached copy of the screenshot. HR can mark reviewed or enable resubmission. The form collects self-reported details; it is not Roblox ownership verification and does not grant roles. Submitted rank never controls bot permissions or quota rules.

Discord attachment URLs can expire. Verification screenshots and manual consequence evidence (up to 10 MB) are copied to their log-channel posts; keep those messages. A long Discord outage before delivery may require resubmission. Stored links can expire even while the underlying attachment remains accessible through the Discord log message.

## Series LOAs

Set `SERIES_API_KEY` in `.env` to your workspace API key, keep `SERIES_ADAPTER` empty to use the built-in LOA integration, and configure `LOA_LOG_CHANNEL_ID`. The bot reads every page of Series time-off requests on startup and every 60 seconds (`SERIES_LOA_POLL_SECONDS`, minimum 30). Run `/syncloas` for an immediate refresh. Re-run `npm run register` to replace the retired `/loarequest` command, then restart the bot.

Each pending request gets a Discord panel with Roblox username/ID, dates, request reason, and **Approve / Deny** buttons. Co-Head+ reviewers must enter a reason in a modal. The bot writes `accepted` or `denied` plus `ManagerNote` back to Series, confirms the result, updates the panel, and mirrors the result into staff history. The log includes the decision reason and reviewer. A Discord reviewer ID and reference are included in the Series manager note for audit/recovery.

Series remains authoritative: `accepted`, `ongoing`, and `completed` map to approved historical LOA periods; denied/cancelled/deleted requests grant no exemption. Reviews performed directly in Series are synchronized too. Old locally created LOAs stay in history but no longer grant exemptions. If Series cannot be refreshed, quota consequences are blocked until the exemption check succeeds.

Decisions are saved before sending to Series, with a processing lease to prevent concurrent Discord reviews. If the API times out, the worker reconciles the saved decision before retrying; the reference in `ManagerNote` identifies an already completed write. Series does not document conditional PATCH updates, so another manager acting directly in Series between the final GET and PATCH can still race the Discord decision. Run one bot instance.

The same panel is edited into the final log; retain those messages. Discord log delivery is retryable. A crash after posting a panel but before saving its message ID can duplicate the panel; request IDs identify duplicates. Request details and reasons are stored in MongoDB; restrict access to the LOA channel and database.

Implemented against [List Requests](https://docs.series.hr/api/endpoint/time-off/list-requests), [Get Request](https://docs.series.hr/api/endpoint/time-off/get-request), and [Update Request](https://docs.series.hr/api/endpoint/time-off/update-request). A live key and Discord/MongoDB configuration are still required for an end-to-end test.

## Series quotas and Bloxrank — integration details required

Quota metric mappings and Bloxrank ranking rules still need a real adapter. The built-in Series integration currently covers LOAs. No invented provider endpoints or fake progress data are used. Roblox username/ID and current group-rank lookups use Roblox public APIs.

Set `SERIES_ADAPTER=./integrations/series.js` to your own ES module exporting:

```js
export async function getProgress({ robloxId, start, end }) {
  // Query Series using its documented API and credentials from your environment.
  // Filter by immutable Roblox ID and the exact [start, end) period.
  // Reject partial, stale, incomplete or failed responses.
  // Return real metric totals, including explicit zeroes.
  return { robloxId, start, end, metrics: { sessions: 3 } };
}
```

The example return shape is a contract, not a working quota implementation. Metric keys must match `/adjustreqs`. Put provider credentials in `.env` and read them in your adapter. A custom `SERIES_ADAPTER` must also export `listLoaRequests`, `getLoaRequest` and `reviewLoaRequest`; you can re-export the built-in implementations from `src/series-api.js`.

Set `BLOXRANK_ADAPTER=./integrations/bloxrank.js` to a module exporting:

```js
export async function terminate({ robloxId, actorId, operationId }) {
  // Apply your approved termination rank through Bloxrank's documented API.
  // Enforce idempotency with operationId and verify the final rank.
  // Return only after the provider confirms success.
  return { success: true, reference: 'provider-audit-reference' };
}
```

Use the same operation ID to reconcile/retry uncertain outcomes after a timeout. The bot holds a two-minute processing lease; the adapter must time out sooner and make repeated calls safe. Failed/unconfirmed ranking leaves the record at five strikes, blocked from further consequences.

## Reliability and checks

Run `npm test` and `npm run check`. Tests cover LOA exemptions, invalid provider data, dates, and strike blocking; they do not replace a live Discord/MongoDB integration test.

Staff changes and their audit entries commit atomically in one MongoDB document. A worker retries pending Discord logs every 15 seconds. Delivery is at least once: a crash after sending but before acknowledging may duplicate a post; the record ID identifies duplicates. Run only one instance. Records are embedded per staff member; archive older events before approaching MongoDB's 16 MB document limit.

Before live use, test in a private server: form submission with/without screenshot, unauthorized command/button use, LOA approval and historical exemption, strikes four → five, blocked sixth strike, provider failure, resignation logging, and restart recovery. Tokens, channels, MongoDB and provider adapters must be configured before these live checks can run.

References: [Discord modal components](https://github.com/discord/discord-api-docs/blob/main/developers/components/using-modal-components.mdx), [Discord component reference](https://github.com/discord/discord-api-docs/blob/main/developers/components/reference.mdx), [Roblox user API](https://create.roblox.com/docs/cloud/reference/domains/users).
