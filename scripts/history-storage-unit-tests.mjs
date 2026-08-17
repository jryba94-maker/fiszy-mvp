import assert from "node:assert/strict";
import test from "node:test";

import {
  attachAuctionWinnerCheckout,
  createAuctionWithRun,
  grantAuctionEntryIfCurrent,
  listAuctionRunIds,
  listRunParticipants,
  readAuctionRunConfig,
  readAuctionRunHistoryDetails,
} from "../lib/auction-storage.ts";
import {
  DEFAULT_AUCTION_RUN_ID,
  LEGACY_AUCTION_ID,
} from "../lib/auction.ts";

const REDIS_URL = "https://redis.history-unit.invalid";
const AUCTION_ID = "history-unit-auction";
const DEFINITION = {
  productName: "History unit product",
  productImageUrl: null,
  regularPrice: 120,
  startPrice: 100,
  floorPrice: 90,
  durationMinutes: 10,
};

function auctionConfig(runId, score) {
  return {
    schemaVersion: 2,
    runId,
    startsAt: new Date(score).toISOString(),
    ...DEFINITION,
  };
}

function participantRecord(participantId, runId, score) {
  return {
    schemaVersion: 1,
    participantId,
    auctionId: AUCTION_ID,
    runId,
    entryStatus: "granted",
    entryFee: 5,
    entryPaymentSessionId: `cs_test_${participantId}`,
    grantedAt: new Date(score).toISOString(),
  };
}

function installRedisMock(handler) {
  const previousFetch = globalThis.fetch;
  const previousSettings = {
    KV_REST_API_URL: process.env.KV_REST_API_URL,
    KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
    VERCEL_ENV: process.env.VERCEL_ENV,
  };
  process.env.KV_REST_API_URL = REDIS_URL;
  process.env.KV_REST_API_TOKEN = "history-unit-token";
  process.env.VERCEL_ENV = "development";
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(String(url), REDIS_URL);
    return Response.json({ result: await handler(JSON.parse(init.body)) });
  };

  return () => {
    globalThis.fetch = previousFetch;
    for (const [name, value] of Object.entries(previousSettings)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}

test("run history batches reads, filters orphaned members and keeps a stable cursor", async () => {
  let indexedRuns = [
    ["run-c", 3_000],
    ["orphan-run", 2_500],
    ["run-b", 2_000],
    ["run-a", 1_000],
  ];
  const configs = new Map(
    indexedRuns
      .filter(([runId]) => runId !== "orphan-run")
      .map(([runId, score]) => [runId, JSON.stringify(auctionConfig(runId, score))]),
  );
  const commands = [];
  const restore = installRedisMock((command) => {
    commands.push(command);
    if (command[0] === "EVAL" && command[1].includes("local cursorMember")) {
      assert.equal(command[7], 8, "Run page scan was not bounded.");
      const cursorMember = command[4];
      const cursorScore = Number(command[5]);
      const start = cursorMember
        ? indexedRuns.findIndex(
            ([member, score]) => member === cursorMember && score === cursorScore,
          ) + 1
        : Number(command[6]);
      return [
        1,
        ...indexedRuns
          .slice(Math.max(start, 0), Math.max(start, 0) + command[7] + 1)
          .flatMap(([runId, score]) => [runId, String(score)]),
      ];
    }
    if (command[0] === "MGET") {
      assert.ok(command.length - 1 <= 8, "Run page read exceeded its bounded window.");
      return command.slice(1).map((key) => {
        const match = key.match(/:run:([^:]+):config$/);
        return match ? configs.get(match[1]) ?? null : null;
      });
    }
    if (command[0] === "EVAL" && command[1].includes('ARGV[1] .. "|"')) {
      const invalidMembers = command.slice(6);
      indexedRuns = indexedRuns.filter(
        ([runId]) => !invalidMembers.includes(runId),
      );
      return invalidMembers.length;
    }
    throw new Error(`Unexpected Redis command: ${command[0]}`);
  });

  try {
    const first = await listAuctionRunIds({
      auctionId: AUCTION_ID,
      limit: 2,
    });
    assert.deepEqual(first?.runIds, ["run-c", "run-b"]);
    assert.match(first?.nextCursor ?? "", /^h1\./);
    assert.equal(commands.length, 3);

    indexedRuns = [["run-d", 4_000], ...indexedRuns];
    configs.set("run-d", JSON.stringify(auctionConfig("run-d", 4_000)));
    const second = await listAuctionRunIds({
      auctionId: AUCTION_ID,
      cursor: first?.nextCursor,
      limit: 2,
    });
    assert.deepEqual(second?.runIds, ["run-a"]);
    assert.equal(second?.nextCursor, null);
    assert.equal(commands.length, 5);
    assert.equal(
      commands.some(
        (command) => command[0] === "ZREVRANGE" && command.includes(-1),
      ),
      false,
    );

    assert.equal(
      await listAuctionRunIds({
        auctionId: AUCTION_ID,
        cursor: "invalid.cursor",
        limit: 2,
      }),
      null,
    );
    assert.equal(commands.length, 5, "Invalid cursor unexpectedly touched Redis.");

    const invalidMemberCursor = `h1.${Buffer.from(JSON.stringify({
      purpose: `auction-runs:${AUCTION_ID}`,
      score: 2_000,
      member: " run-b ",
    })).toString("base64url")}`;
    assert.equal(
      await listAuctionRunIds({
        auctionId: AUCTION_ID,
        cursor: invalidMemberCursor,
        limit: 2,
      }),
      null,
    );
    assert.equal(commands.length, 5, "Invalid cursor member unexpectedly touched Redis.");
  } finally {
    restore();
  }
});

test("participant history uses one canonical backfill, then bounded stable pages", async () => {
  const runId = "participant-run";
  let indexedParticipants = [
    ["participant-c", 3_000],
    ["orphan-participant", 2_500],
    ["invalid-date-participant", 2_250],
    ["participant-b", 2_000],
    ["participant-a", 1_000],
  ];
  const participants = new Map(
    indexedParticipants
      .filter(([participantId]) => participantId !== "orphan-participant")
      .map(([participantId, score]) => [
        participantId,
        JSON.stringify(participantRecord(participantId, runId, score)),
      ]),
  );
  participants.set(
    "invalid-date-participant",
    JSON.stringify({
      ...participantRecord("invalid-date-participant", runId, 2_250),
      grantedAt: "2026-99-99T99:99:99.000Z",
    }),
  );
  let cachedCount = null;
  let version = 0;
  const commands = [];
  const restore = installRedisMock((command) => {
    commands.push(command);
    if (command[0] === "MGET" && command.slice(1).every(
      (key) => key.includes("participants:v1:count") || key.includes("participants:v1:version"),
    )) {
      return command.slice(1).map((key) =>
        key.includes("participants:v1:count")
          ? cachedCount === null ? null : String(cachedCount)
          : String(version),
      );
    }
    if (command[0] === "ZRANGE") {
      return indexedParticipants.map(([participantId]) => participantId);
    }
    if (command[0] === "MGET") {
      return command.slice(1).map((key) => {
        const match = key.match(/:participant:([^:]+):run:/);
        return match ? participants.get(decodeURIComponent(match[1])) ?? null : null;
      });
    }
    if (command[0] === "EVAL" && command[1].includes("validCount")) {
      assert.equal(command[6], version);
      cachedCount = Number(command[7]);
      const invalidMembers = command.slice(8);
      indexedParticipants = indexedParticipants.filter(
        ([participantId]) => !invalidMembers.includes(participantId),
      );
      version += invalidMembers.length;
      return [1, cachedCount];
    }
    if (command[0] === "EVAL" && command[1].includes("local cursorMember")) {
      assert.equal(command[7], 8, "Participant page scan was not bounded.");
      const cursorMember = command[4];
      const cursorScore = Number(command[5]);
      const start = cursorMember
        ? indexedParticipants.findIndex(
            ([member, score]) => member === cursorMember && score === cursorScore,
          ) + 1
        : Number(command[6]);
      return [
        1,
        ...indexedParticipants
          .slice(Math.max(start, 0), Math.max(start, 0) + command[7] + 1)
          .flatMap(([participantId, score]) => [participantId, String(score)]),
      ];
    }
    throw new Error(`Unexpected Redis command: ${command[0]}`);
  });

  try {
    const first = await listRunParticipants({
      auctionId: AUCTION_ID,
      runId,
      limit: 2,
    });
    assert.deepEqual(first?.participantIds, ["participant-c", "participant-b"]);
    assert.equal(first?.participants.length, 2);
    assert.equal(first?.total, 3);
    assert.match(first?.nextCursor ?? "", /^h1\./);
    assert.equal(
      commands.filter((command) => command[0] === "ZRANGE").length,
      1,
      "Legacy count was not backfilled exactly once.",
    );

    indexedParticipants = [["participant-d", 4_000], ...indexedParticipants];
    participants.set(
      "participant-d",
      JSON.stringify(participantRecord("participant-d", runId, 4_000)),
    );
    cachedCount += 1;
    version += 1;
    const second = await listRunParticipants({
      auctionId: AUCTION_ID,
      runId,
      cursor: first?.nextCursor,
      limit: 2,
    });
    assert.deepEqual(second?.participantIds, ["participant-a"]);
    assert.equal(second?.total, 4);
    assert.equal(
      commands.filter((command) => command[0] === "ZRANGE").length,
      1,
      "Participant pagination repeated the full legacy scan.",
    );
    const pageReads = commands.filter(
      (command) => command[0] === "EVAL" && command[1].includes("local cursorMember"),
    );
    assert.equal(pageReads.length, 2);
  } finally {
    restore();
  }
});

test("legacy run lookup only falls back to the real active run", async () => {
  const commands = [];
  const restore = installRedisMock((command) => {
    commands.push(command);
    assert.equal(command[0], "GET");
    return null;
  });

  try {
    assert.equal(
      await readAuctionRunConfig("made-up-legacy-run", LEGACY_AUCTION_ID),
      null,
    );
    assert.equal(commands.length, 2);

    const active = await readAuctionRunConfig(
      DEFAULT_AUCTION_RUN_ID,
      LEGACY_AUCTION_ID,
    );
    assert.equal(active?.runId, DEFAULT_AUCTION_RUN_ID);
    assert.equal(commands.length, 4);
  } finally {
    restore();
  }
});

test("run outcomes use cached participant counts without scanning participant indexes", async () => {
  const runIds = ["run-a", "run-b"];
  const winner = {
    bidderId: "participant-a",
    price: 95,
    claimedAt: "2026-08-10T08:10:00.000Z",
    paymentStatus: "paid",
  };
  const order = {
    orderId: "order-a",
    auctionId: AUCTION_ID,
    runId: "run-a",
    bidderId: "participant-a",
    amount: 95,
    currency: "pln",
    paidAt: "2026-08-10T08:11:00.000Z",
  };
  const commands = [];
  const restore = installRedisMock((received) => {
    commands.push(received);
    assert.equal(received[0], "MGET");
    if (received.slice(1).some((key) => key.endsWith(":winner"))) {
      return [JSON.stringify(winner), JSON.stringify(order), null, null];
    }
    return ["2", "0", "0", "0"];
  });

  try {
    const details = await readAuctionRunHistoryDetails(runIds, AUCTION_ID);
    assert.equal(commands.length, 2);
    assert.equal(commands.every((command) => command[0] === "MGET"), true);
    assert.equal(commands.some((command) => command[0] === "ZRANGE"), false);
    assert.deepEqual(details, [
      { runId: "run-a", winner, order, participantCount: 2 },
      { runId: "run-b", winner: null, order: null, participantCount: 0 },
    ]);
  } finally {
    restore();
  }
});

test("new runs initialize exact participant counters atomically", async () => {
  let command = null;
  const restore = installRedisMock((received) => {
    command = received;
    return 1;
  });

  try {
    const runId = "counter-run";
    const timestamp = "2026-08-10T08:10:00.000Z";
    const result = await createAuctionWithRun(
      {
        schemaVersion: 1,
        auctionId: AUCTION_ID,
        state: "published",
        currentRunId: runId,
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        ...DEFINITION,
      },
      auctionConfig(runId, Date.parse(timestamp)),
    );
    assert.equal(result, 1);
    assert.equal(command?.[0], "EVAL");
    assert.equal(command?.[2], 9);
    assert.match(command?.[1] ?? "", /SET", KEYS\[8\], 0/);
    assert.match(command?.[1] ?? "", /SET", KEYS\[9\], 0/);
    assert.match(command?.[10] ?? "", /participants:v1:count$/);
    assert.match(command?.[11] ?? "", /participants:v1:version$/);
  } finally {
    restore();
  }
});

test("duplicate entry grant atomically repairs participant history", async () => {
  let command = null;
  const restore = installRedisMock((received) => {
    command = received;
    return 2;
  });

  try {
    const result = await grantAuctionEntryIfCurrent(
      "duplicate-run",
      Date.parse("2026-08-10T09:00:00.000Z"),
      Date.parse("2026-08-10T08:30:00.000Z"),
      {
        bidderId: "duplicate-participant",
        fee: 5,
        grantedAt: "2026-08-10T08:20:00.000Z",
        provider: "stripe",
        paymentSessionId: "cs_test_duplicate",
      },
      AUCTION_ID,
    );
    assert.equal(result, 2);
    assert.equal(command?.[0], "EVAL");
    const script = command?.[1] ?? "";
    const repairAt = script.indexOf(
      'redis.call("SET", KEYS[4], cjson.encode(repaired), "NX")',
    );
    const participantIndexAt = script.indexOf(
      'redis.call("ZADD", KEYS[6], "NX", ARGV[7], ARGV[9])',
    );
    const participantCountAt = script.indexOf('redis.call("INCR", KEYS[7])');
    const duplicateReturnAt = script.indexOf("return 2");
    assert.ok(repairAt >= 0 && participantIndexAt > repairAt);
    assert.ok(participantCountAt >= 0 && duplicateReturnAt > participantIndexAt);
    assert.equal(command?.[2], 8);
    const participant = JSON.parse(command?.[16] ?? "{}");
    assert.equal(participant.entryPaymentProvider, "stripe");
    assert.equal(participant.entryPaymentReference, "cs_test_duplicate");
    assert.equal(command?.[20], AUCTION_ID, "Lua repair did not receive auction id.");
  } finally {
    restore();
  }
});

test("winner attachment stores a provider-owned payment reference", async () => {
  let command = null;
  const restore = installRedisMock((received) => {
    command = received;
    return 1;
  });

  try {
    const result = await attachAuctionWinnerCheckout(
      "provider-run",
      "provider-participant",
      "cs_test_provider_reference",
      "https://checkout.example.invalid/session",
      "2026-08-10T09:00:00.000Z",
      AUCTION_ID,
      "2026-08-10T08:20:00.000Z",
      "stripe",
    );
    assert.equal(result, 1);
    assert.match(command?.[1] ?? "", /data\.paymentProvider = ARGV\[6\]/);
    assert.match(command?.[1] ?? "", /data\.paymentReference = ARGV\[2\]/);
    assert.equal(command?.at(-1), "stripe");
  } finally {
    restore();
  }
});
