import { NextRequest, NextResponse } from "next/server";
import * as Ably from "ably";

export async function GET(request: NextRequest) {
  const apiKey = process.env.ABLY_API_KEY;

  console.log("ABLY_API_KEY exists:", !!apiKey);
  console.log("Environment variables:", Object.keys(process.env).filter(k => k.includes('ABLY')));

  if (!apiKey) {
    console.error("Ably API key not configured in environment");
    return NextResponse.json(
      { error: "Ably API key not configured. Please set ABLY_API_KEY in .env.local" },
      { status: 500 }
    );
  }

  try {
    const client = new Ably.Rest(apiKey);

    // Create token request with explicit timestamp
    const tokenRequest = await client.auth.createTokenRequest({
      clientId: `user-${Math.random().toString(36).substring(7)}`,
      capability: {
        "quizzos-game": ["publish", "subscribe", "presence"],
      },
      timestamp: Date.now(),
    });

    console.log("Token request created successfully");
    return NextResponse.json(tokenRequest);
  } catch (error: any) {
    console.error("Error creating Ably token:", error);
    console.error("Error details:", error.message, error.code, error.statusCode);
    return NextResponse.json(
      { error: "Failed to create token", details: error.message },
      { status: 500 }
    );
  }
}
