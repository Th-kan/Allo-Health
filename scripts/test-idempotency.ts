import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function runIdempotencyTest() {
  console.log("=== IDEMPOTENCY TEST START ===");

  // 1. Find Tee and Singapore warehouse
  const product = await prisma.product.findUnique({
    where: { sku: "ALLO-TEE-001" }
  });
  const warehouse = await prisma.warehouse.findUnique({
    where: { code: "SG-MAIN" }
  });

  if (!product || !warehouse) {
    throw new Error("Tee or Singapore warehouse not found in DB. Make sure you seeded first!");
  }

  // 2. Reset stock levels
  const inventory = await prisma.inventory.findUnique({
    where: {
      productId_warehouseId: {
        productId: product.id,
        warehouseId: warehouse.id
      }
    }
  });

  if (!inventory) {
    throw new Error("Inventory record not found.");
  }

  await prisma.inventory.update({
    where: { id: inventory.id },
    data: { total: 10, reserved: 0 }
  });

  // Clean up reservations for this inventory
  await prisma.reservation.deleteMany({
    where: { inventoryId: inventory.id }
  });

  console.log(`Reset inventory to: Total = 10, Reserved = 0.`);

  const idempotencyKey = crypto.randomUUID();
  const url = "http://localhost:3000/api/reservations";
  const payload = {
    productId: product.id,
    warehouseId: warehouse.id,
    quantity: 2
  };

  // 3. Send first reservation request
  console.log("Sending first reservation request with key:", idempotencyKey);
  const res1 = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey
    },
    body: JSON.stringify(payload)
  });
  const body1 = await res1.json();
  console.log(`Response 1: Status = ${res1.status}, ID = ${body1.id}`);

  // Check inventory after first request
  let invState1 = await prisma.inventory.findUnique({ where: { id: inventory.id } });
  console.log(`Inventory after Request 1: Total = ${invState1?.total}, Reserved = ${invState1?.reserved}`);

  // 4. Send duplicate reservation request
  console.log("Sending duplicate reservation request with same key...");
  const res2 = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey
    },
    body: JSON.stringify(payload)
  });
  const body2 = await res2.json();
  console.log(`Response 2: Status = ${res2.status}, ID = ${body2.id}`);

  // Check inventory after second request
  let invState2 = await prisma.inventory.findUnique({ where: { id: inventory.id } });
  console.log(`Inventory after Request 2: Total = ${invState2?.total}, Reserved = ${invState2?.reserved}`);

  // Verify reservations in DB
  const reservationCount = await prisma.reservation.count({
    where: { inventoryId: inventory.id }
  });
  console.log(`Total reservation records in DB: ${reservationCount}`);

  let reserveSuccess = false;
  if (
    res1.status === 201 && 
    res2.status === 201 && 
    body1.id === body2.id && 
    invState2?.reserved === 2 && 
    reservationCount === 1
  ) {
    console.log("✅ Reservation Idempotency succeeded: Second request returned identical response, and stock wasn't double-reserved!");
    reserveSuccess = true;
  } else {
    console.log("❌ Reservation Idempotency failed!");
  }

  // 5. Test Confirmation Idempotency
  console.log("\nTesting Confirmation Idempotency...");
  const confirmUrl = `http://localhost:3000/api/reservations/${body1.id}/confirm`;
  const confirmKey = crypto.randomUUID();

  // Send first confirmation
  console.log("Sending first confirmation request with key:", confirmKey);
  const conf1 = await fetch(confirmUrl, {
    method: "POST",
    headers: {
      "Idempotency-Key": confirmKey
    }
  });
  const confBody1 = await conf1.json();
  console.log(`Confirm Response 1: Status = ${conf1.status}, StatusText = ${confBody1.status}`);

  // Check inventory
  let invStateConf1 = await prisma.inventory.findUnique({ where: { id: inventory.id } });
  console.log(`Inventory after Confirm 1: Total = ${invStateConf1?.total}, Reserved = ${invStateConf1?.reserved}`);

  // Send duplicate confirmation
  console.log("Sending duplicate confirmation request...");
  const conf2 = await fetch(confirmUrl, {
    method: "POST",
    headers: {
      "Idempotency-Key": confirmKey
    }
  });
  const confBody2 = await conf2.json();
  console.log(`Confirm Response 2: Status = ${conf2.status}, Status = ${confBody2.status}`);

  // Check inventory again
  let invStateConf2 = await prisma.inventory.findUnique({ where: { id: inventory.id } });
  console.log(`Inventory after Confirm 2: Total = ${invStateConf2?.total}, Reserved = ${invStateConf2?.reserved}`);

  let confirmSuccess = false;
  if (
    conf1.status === 200 && 
    conf2.status === 200 && 
    confBody1.status === 'CONFIRMED' && 
    confBody2.status === 'CONFIRMED' &&
    invStateConf2?.total === 8 && 
    invStateConf2?.reserved === 0
  ) {
    console.log("✅ Confirmation Idempotency succeeded: Second request returned success, and stock wasn't double-decremented!");
    confirmSuccess = true;
  } else {
    console.log("❌ Confirmation Idempotency failed!");
  }

  if (reserveSuccess && confirmSuccess) {
    console.log("\n🎉 ALL IDEMPOTENCY TESTS PASSED!");
  } else {
    console.log("\n❌ SOME IDEMPOTENCY TESTS FAILED.");
  }

  console.log("=== IDEMPOTENCY TEST END ===");
}

runIdempotencyTest()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
