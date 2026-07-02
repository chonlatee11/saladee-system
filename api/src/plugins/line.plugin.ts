// LINE Messaging API client + webhook secret, from validated env (D-06).
// Builds a REAL @line/bot-sdk v11 MessagingApiClient (no stub). The reply client
// and the channel secret are decorated onto Elysia context so the /webhook route
// can validate x-line-signature and echo replies. Both the access token and the
// channel secret come ONLY from `env` (never a literal, never logged — T-00-15).
import { messagingApi } from "@line/bot-sdk";
import { Elysia } from "elysia";
import { env } from "../env";

// Constructed once at module load. Construction is offline (no network); only
// reply/push calls hit the LINE API.
const client = new messagingApi.MessagingApiClient({
  channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN,
});

// Keep the plugin name "line" (composition in index.ts is fixed by 00-01).
export const linePlugin = new Elysia({ name: "line" }).decorate("line", {
  client,
  channelSecret: env.LINE_CHANNEL_SECRET,
});
