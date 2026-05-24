import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { handleIdempotency } from '@/lib/idempotency';
import { cleanupExpiredReservations } from '@/lib/cleanup';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const idempotencyKey = request.headers.get('idempotency-key');

    const result = await handleIdempotency(idempotencyKey, async () => {
      return await prisma.$transaction(async (tx) => {
        // 1. Run lazy cleanup of expired holds
        await cleanupExpiredReservations(tx);

        // 2. Fetch the reservation
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

        // If already confirmed, return success (making the endpoint idempotent)
        if (reservation.status === 'CONFIRMED') {
          return {
            status: 200,
            body: reservation,
          };
        }

        // Check if reservation is expired
        const isExpired = reservation.expiresAt < new Date();

        if (reservation.status === 'RELEASED' || isExpired) {
          // If it is pending but expired, release the stock now
          if (reservation.status === 'PENDING' && isExpired) {
            await tx.inventory.update({
              where: { id: reservation.inventoryId },
              data: {
                reserved: { decrement: reservation.quantity },
              },
            });
            await tx.reservation.update({
              where: { id },
              data: { status: 'RELEASED' },
            });
          }
          
          return {
            status: 410,
            body: { error: "Reservation has expired and cannot be confirmed." },
          };
        }

        // 3. Atomically confirm purchase
        // Decrement physical total stock AND release the reserved hold count
        await tx.inventory.update({
          where: { id: reservation.inventoryId },
          data: {
            total: { decrement: reservation.quantity },
            reserved: { decrement: reservation.quantity },
          },
        });

        // 4. Update reservation status to CONFIRMED
        const updatedReservation = await tx.reservation.update({
          where: { id },
          data: { status: 'CONFIRMED' },
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
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (error: any) {
    console.error("POST /api/reservations/[id]/confirm error:", error);
    return NextResponse.json({ error: error.message || "Failed to confirm reservation" }, { status: 500 });
  }
}
