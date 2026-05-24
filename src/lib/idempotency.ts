import { prisma } from './prisma';

interface IdempotencyResult {
  status: number;
  body: any;
}

export async function handleIdempotency(
  key: string | null | undefined,
  handler: () => Promise<IdempotencyResult>
): Promise<IdempotencyResult> {
  if (!key) {
    return await handler();
  }

  // 1. Check if the key already exists
  const existing = await prisma.idempotentRequest.findUnique({
    where: { key }
  });

  if (existing) {
    // If it's still processing (status 102), we poll for a bit
    if (existing.responseStatus === 102) {
      let attempts = 0;
      while (attempts < 10) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const record = await prisma.idempotentRequest.findUnique({
          where: { key }
        });
        if (record && record.responseStatus !== 102) {
          return {
            status: record.responseStatus,
            body: JSON.parse(record.responseBody)
          };
        }
        attempts++;
      }
      return {
        status: 409,
        body: { error: "Conflict: Another identical request is currently processing." }
      };
    }

    return {
      status: existing.responseStatus,
      body: JSON.parse(existing.responseBody)
    };
  }

  // 2. Create a pending record
  try {
    await prisma.idempotentRequest.create({
      data: {
        key,
        responseStatus: 102, // Processing
        responseBody: "{}"
      }
    });
  } catch (err: any) {
    // If it fails with a unique constraint, another request created it in the split second
    const record = await prisma.idempotentRequest.findUnique({
      where: { key }
    });
    if (record && record.responseStatus !== 102) {
      return {
        status: record.responseStatus,
        body: JSON.parse(record.responseBody)
      };
    }
    return {
      status: 409,
      body: { error: "Conflict: Another identical request is currently processing." }
    };
  }

  // 3. Run the handler
  try {
    const result = await handler();
    
    // 4. Update the record with result
    await prisma.idempotentRequest.update({
      where: { key },
      data: {
        responseStatus: result.status,
        responseBody: JSON.stringify(result.body)
      }
    });

    return result;
  } catch (err: any) {
    // 5. On error, delete the idempotency key so the client can retry
    await prisma.idempotentRequest.delete({
      where: { key }
    }).catch(() => {});
    throw err;
  }
}
