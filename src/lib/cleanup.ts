import { prisma } from './prisma';

export async function cleanupExpiredReservations(tx?: any): Promise<number> {
  const client = tx || prisma;
  try {
    const result = await client.$executeRawUnsafe(`
      WITH expired AS (
        UPDATE "Reservation"
        SET "status" = 'RELEASED', "updatedAt" = NOW()
        WHERE "status" = 'PENDING' AND "expiresAt" < NOW()
        RETURNING "inventoryId", "quantity"
      ),
      aggregated AS (
        SELECT "inventoryId", SUM("quantity") as total_qty
        FROM expired
        GROUP BY "inventoryId"
      )
      UPDATE "Inventory" i
      SET "reserved" = i."reserved" - a.total_qty
      FROM aggregated a
      WHERE i.id = a."inventoryId";
    `);
    
    return result;
  } catch (error) {
    console.error("Error running expired reservations cleanup:", error);
    throw error;
  }
}
