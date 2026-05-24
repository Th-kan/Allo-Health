import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const result = await prisma.$transaction(async (tx) => {
      // Fetch the reservation record
      const reservation = await tx.reservation.findUnique({
        where: { id },
        include: { inventory: true },
      });

      if (!reservation) {
        return {
          status: 404,
          body: { error: "Reservation not found." },
        };
      }

      // If already released, return success (no-op)
      if (reservation.status === 'RELEASED') {
        return {
          status: 200,
          body: reservation,
        };
      }

      // If already confirmed, it cannot be released
      if (reservation.status === 'CONFIRMED') {
        return {
          status: 400,
          body: { error: "Cannot release a confirmed reservation." },
        };
      }

      // Release stock: decrement reserved count in Inventory
      await tx.inventory.update({
        where: { id: reservation.inventoryId },
        data: {
          reserved: {
            decrement: reservation.quantity,
          },
        },
      });

      // Update reservation status to RELEASED
      const updatedReservation = await tx.reservation.update({
        where: { id },
        data: { status: 'RELEASED' },
        include: {
          inventory: {
            include: {
              product: true,
              warehouse: true,
            },
          },
        },
      });

      return {
        status: 200,
        body: updatedReservation,
      };
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (error: any) {
    console.error("POST /api/reservations/[id]/release error:", error);
    return NextResponse.json({ error: error.message || "Failed to release reservation" }, { status: 500 });
  }
}
