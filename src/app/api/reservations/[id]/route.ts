import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { cleanupExpiredReservations } from '@/lib/cleanup';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // 1. Lazy cleanup first so that if this reservation has expired, it reads as RELEASED
    await cleanupExpiredReservations();

    // 2. Fetch reservation details along with product and warehouse data
    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: {
        inventory: {
          include: {
            product: true,
            warehouse: true,
          },
        },
      },
    });

    if (!reservation) {
      return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
    }

    return NextResponse.json(reservation);
  } catch (error: any) {
    console.error("GET /api/reservations/[id] error:", error);
    return NextResponse.json({ error: "Failed to fetch reservation details." }, { status: 500 });
  }
}
