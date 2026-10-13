import { messagingApi } from "@line/bot-sdk";

let client: messagingApi.MessagingApiClient | undefined;

export function getLineClient(): messagingApi.MessagingApiClient {
  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!channelAccessToken) throw new Error("LINE_CHANNEL_ACCESS_TOKEN is not set");
  return (client ??= new messagingApi.MessagingApiClient({ channelAccessToken }));
}
