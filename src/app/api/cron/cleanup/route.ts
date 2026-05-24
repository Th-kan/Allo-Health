import { NextRequest, NextResponse } from 'next/server';
import { cleanupExpiredReservations } from '@/lib/cleanup';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // Check Authorization header against CRON_SECRET if it's set in the environment variables
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const releasedCount = await cleanupExpiredReservations();

    return NextResponse.json({
      success: true,
      message: "Expired reservations cleaned up successfully.",
      releasedCount
    });
  } catch (error: any) {
    console.error("POST /api/cron/cleanup error:", error);
    return NextResponse.json({ error: error.message || "Failed to run cleanup" }, { status: 500 });
  }
}

// Support GET request for easy manual triggering and dashboard validation
export async function GET(request: NextRequest) {
  return POST(request);
}
