import { NextResponse } from "next/server";
import { handleVerifiedEvent, verifyAndParse } from "@/lib/webhooks/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.GITHUB_WEBHOOK_SECRET ?? "";
  if (!secret) {
    console.warn("[webhook/github] GITHUB_WEBHOOK_SECRET is unset — rejecting");
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 503 },
    );
  }

  const rawBody = await req.text();
  const verified = verifyAndParse(
    rawBody,
    req.headers.get("x-hub-signature-256"),
    req.headers.get("x-github-event"),
    req.headers.get("x-github-delivery"),
    secret,
  );

  if (!verified) {
    console.warn(
      "[webhook/github] signature verification failed",
      req.headers.get("x-github-delivery"),
    );
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  try {
    const result = await handleVerifiedEvent(verified);
    console.log(
      "[webhook/github] processed",
      JSON.stringify({
        event: verified.event,
        deliveryId: verified.deliveryId,
        result,
      }),
    );
    return NextResponse.json({ ok: true, result }, { status: 200 });
  } catch (err) {
    console.error(
      "[webhook/github] handler failure",
      verified.deliveryId,
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json({ error: "Handler failure" }, { status: 500 });
  }
}
