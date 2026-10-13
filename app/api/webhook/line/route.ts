import { validateSignature, type webhook } from "@line/bot-sdk";
import { NextResponse } from "next/server";
import { handleLineEvents } from "@/lib/line/handler";

export async function POST(request: Request) {
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  if (!channelSecret) {
    return NextResponse.json({ error: "LINE_CHANNEL_SECRET is not set" }, { status: 500 });
  }

  // Signature is computed over the raw body, so read it as text before parsing.
  const rawBody = await request.text();
  const signature = request.headers.get("x-line-signature");
  if (!signature || !validateSignature(rawBody, channelSecret, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: webhook.CallbackRequest;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  await handleLineEvents(body.events ?? []);
  return NextResponse.json({ ok: true });
}
