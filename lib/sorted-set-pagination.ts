import { redisCommand } from "./redis";

type CursorPayload = {
  version: 1;
  purpose: string;
  member: string;
};

const CURSOR_PATTERN = /^[A-Za-z0-9_-]{1,1024}$/;
const LEGACY_CURSOR_PATTERN = /^\d+$/;
const PURPOSE_PATTERN = /^[a-z][a-z0-9_.-]{0,79}$/;

function encodeCursor(purpose: string, member: string) {
  const payload: CursorPayload = { version: 1, purpose, member };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(value: string, purpose: string) {
  if (!CURSOR_PATTERN.test(value) || !PURPOSE_PATTERN.test(purpose)) return null;

  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) return null;
    const payload = JSON.parse(bytes.toString("utf8")) as Partial<CursorPayload>;
    if (
      Object.keys(payload).length !== 3 ||
      payload.version !== 1 ||
      payload.purpose !== purpose ||
      typeof payload.member !== "string" ||
      !payload.member ||
      payload.member.length > 512 ||
      /[\u0000-\u001f\u007f]/.test(payload.member)
    ) {
      return null;
    }
    return payload.member;
  } catch {
    return null;
  }
}

function decodeLegacyOffset(value: string) {
  if (!CURSOR_PATTERN.test(value) || !LEGACY_CURSOR_PATTERN.test(value)) {
    return null;
  }
  const offset = Number(value);
  return Number.isSafeInteger(offset) ? offset : null;
}

export function isSortedSetCursor(value: string, purpose: string) {
  return decodeLegacyOffset(value) !== null || decodeCursor(value, purpose) !== null;
}

export function looksLikeSortedSetCursor(value: string) {
  return LEGACY_CURSOR_PATTERN.test(value)
    ? decodeLegacyOffset(value) !== null
    : CURSOR_PATTERN.test(value);
}

export async function listSortedSetPage(input: {
  indexKey: string;
  purpose: string;
  cursor?: string | null;
  limit: number;
  pruneBeforeScore?: number;
  expireSeconds?: number;
}) {
  if (
    !PURPOSE_PATTERN.test(input.purpose) ||
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 50 ||
    (input.pruneBeforeScore !== undefined &&
      !Number.isFinite(input.pruneBeforeScore)) ||
    (input.expireSeconds !== undefined &&
      (!Number.isInteger(input.expireSeconds) || input.expireSeconds < 1))
  ) {
    return null;
  }

  const legacyOffset = input.cursor ? decodeLegacyOffset(input.cursor) : null;
  const cursorMember = input.cursor && legacyOffset === null
    ? decodeCursor(input.cursor, input.purpose)
    : "";
  if (input.cursor && legacyOffset === null && cursorMember === null) return null;

  // Ranking and reading happen in one Redis command, so inserts before the
  // cursor cannot shift an offset between two round-trips.
  const script = `
if ARGV[3] ~= "" then
  redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", ARGV[3])
end
if tonumber(ARGV[4]) and tonumber(ARGV[4]) > 0 then
  redis.call("EXPIRE", KEYS[1], ARGV[4])
end

local start = tonumber(ARGV[5]) or 0
if ARGV[1] ~= "" then
  local rank = redis.call("ZREVRANK", KEYS[1], ARGV[1])
  if not rank then return {0} end
  start = rank + 1
end

local members = redis.call("ZREVRANGE", KEYS[1], start, start + tonumber(ARGV[2]))
local result = {1}
for _, member in ipairs(members) do
  table.insert(result, member)
end
return result
`;
  const result = await redisCommand<Array<number | string>>([
    "EVAL",
    script,
    1,
    input.indexKey,
    cursorMember ?? "",
    input.limit,
    input.pruneBeforeScore ?? "",
    input.expireSeconds ?? 0,
    legacyOffset ?? 0,
  ]);
  if (!Array.isArray(result) || result[0] !== 1) return null;

  const rawMembers = result.slice(1);
  if (rawMembers.some((member) => typeof member !== "string")) return null;
  const members = (rawMembers as string[]).slice(0, input.limit);
  const hasMore = rawMembers.length > input.limit;

  return {
    members,
    nextCursor:
      hasMore && members.length > 0
        ? encodeCursor(input.purpose, members[members.length - 1])
        : null,
  };
}
