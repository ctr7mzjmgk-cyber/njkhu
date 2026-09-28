import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Forward the user's Authorization header if present (for authenticated actions),
    // otherwise fall back to the anon key.
    const userAuth = req.headers.get("Authorization");
    const authHeader = userAuth ?? `Bearer ${SUPABASE_ANON_KEY}`;

    const response = await fetch(`${SUPABASE_URL}/functions/v1/attendance-clock`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
    });

    const data = await response.text();
    return new NextResponse(data, {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur interne" },
      { status: 500 }
    );
  }
}
