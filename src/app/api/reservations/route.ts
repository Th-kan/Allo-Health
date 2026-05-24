import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { handleIdempotency } from '@/lib/idempotency';
import { cleanupExpiredReservations } from '@/lib/cleanup';

export async function POST(request: NextRequest) {
  try {
    const idempotencyKey = request.headers.get('idempotency-key');
    const body = await request.json();
    const { productId, warehouseId, quantity } = body;

    if (!productId || !warehouseId || typeof quantity !== 'number' || quantity <= 0) {
      return NextResponse.json({ error: "Invalid request body parameters" }, { status: 400 });
    }

    const result = await handleIdempotency(idempotencyKey, async () => {
      // Execute reservation creation inside an ACID transaction
      return await prisma.$transaction(async (tx) => {
        // 1. Run lazy cleanup of expired reservations to reclaim stock first
        await cleanupExpiredReservations(tx);

        // 2. Apply pessimistic row lock to the inventory record
        const inventories = await tx.$queryRaw<any[]>`
          SELECT id, total, reserved 
          FROM "Inventory" 
          WHERE "productId" = ${productId} AND "warehouseId" = ${warehouseId} 
          FOR UPDATE
        `;

        if (inventories.length === 0) {
          return {
            status: 404,
            body: { error: "Inventory record not found for this product and warehouse." }
          };
        }

        const inventory = inventories[0];
        const available = inventory.total - inventory.reserved;

        if (available < quantity) {
          return {
            status: 409,
            body: { 
              error: "Insufficient stock available", 
              available, 
              requested: quantity 
            }
          };
        }

        // 3. Increment the reserved stock count
        await tx.inventory.update({
          where: { id: inventory.id },
          data: {
            reserved: {
              increment: quantity
            }
          }
        });

        // 4. Create the PENDING reservation record
        const reservation = await tx.reservation.create({
          data: {
            inventoryId: inventory.id,
            quantity,
            status: "PENDING",
            expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes hold
            idempotencyKey: idempotencyKey || null
          },
          include: {
            inventory: {
              include: {
                product: true,
                warehouse: true
              }
            }
          }
        });

        return {
          status: 201,
          body: reservation
        };
      });
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (error: any) {
    console.error("POST /api/reservations error:", error);
    return NextResponse.json({ error: error.message || "Failed to create reservation" }, { status: 500 });
  }
}
