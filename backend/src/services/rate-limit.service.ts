import crypto from 'node:crypto';
import { Redis } from 'ioredis';
import { logger } from '../config/logger.js';
import { redisConnection } from '../db/redis.js';

const HOUR_MS = 60 * 60 * 1000;
const MIN_SEND_START_RETRY_MS = 50;

type RedisScriptClient = Pick<Redis, 'eval'>;

export interface HourlySlotReservation {
  allowed: boolean;
  count: number;
  effectiveLimit: number;
  hourStart: number;
  nextHourAt: number;
  reservationId: string;
}

export interface SendStartSlot {
  acquired: boolean;
  retryAt: number;
  sendAt: number;
  reservedUntil: number;
  previousNextSendAt: number;
  lockToken: string | null;
}

// One hash contains the current-hour counter and the campaign limits that
// have participated in that hour. Redis HSCAN is safe here because the entire
// script executes atomically; campaign count is expected to remain modest.
// The minimum registered campaign limit is the deterministic sender limit.
const reserveHourlySlotScript = `
local function nowMilliseconds()
  if ARGV[5] and ARGV[5] ~= '' then
    return tonumber(ARGV[5])
  end
  local time = redis.call('TIME')
  return (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
end

local function effectiveLimit(key, hourStart, requestedLimit, campaignId)
  local limitField = 'limit:' .. hourStart .. ':' .. campaignId
  redis.call('HSET', key, limitField, requestedLimit)

  local minimum = requestedLimit
  local cursor = '0'
  repeat
    local scan = redis.call('HSCAN', key, cursor, 'MATCH', 'limit:' .. hourStart .. ':*', 'COUNT', 100)
    cursor = scan[1]
    local entries = scan[2]
    for index = 2, #entries, 2 do
      local value = tonumber(entries[index])
      if value and value < minimum then
        minimum = value
      end
    end
  until cursor == '0'

  return minimum
end

local function releaseReservation(key, hourStart, reservationId)
  local reservationField = 'reservation:' .. hourStart .. ':' .. reservationId
  if redis.call('HDEL', key, reservationField) == 1 then
    local countField = 'count:' .. hourStart
    local current = tonumber(redis.call('HGET', key, countField) or '0')
    if current > 0 then
      local nextCount = redis.call('HINCRBY', key, countField, -1)
      if nextCount <= 0 then
        redis.call('HDEL', key, countField)
      end
    end
  end
end

local key = KEYS[1]
local requestedLimit = tonumber(ARGV[1])
local campaignId = ARGV[2]
local reservationId = ARGV[3]
local previousHourStart = tonumber(ARGV[4] or '')
local nowMs = nowMilliseconds()
local hourMs = 3600000
local hourStart = math.floor(nowMs / hourMs) * hourMs
local countField = 'count:' .. hourStart

if previousHourStart and previousHourStart ~= hourStart then
  releaseReservation(key, previousHourStart, reservationId)
end

local minimumLimit = effectiveLimit(key, hourStart, requestedLimit, campaignId)
local current = tonumber(redis.call('HGET', key, countField) or '0')
local reservationField = 'reservation:' .. hourStart .. ':' .. reservationId
local alreadyReserved = redis.call('HEXISTS', key, reservationField) == 1

if alreadyReserved then
  -- If a lower campaign limit joined after this reservation, do not allow
  -- already-over-limit reservations to send in the current hour.
  if current > minimumLimit then
    releaseReservation(key, hourStart, reservationId)
    current = tonumber(redis.call('HGET', key, countField) or '0')
    redis.call('PEXPIREAT', key, hourStart + (2 * hourMs))
    return { 0, current, minimumLimit, hourStart, hourStart + hourMs }
  end

  redis.call('PEXPIREAT', key, hourStart + (2 * hourMs))
  return { 1, current, minimumLimit, hourStart, hourStart + hourMs }
end

if current >= minimumLimit then
  redis.call('PEXPIREAT', key, hourStart + (2 * hourMs))
  return { 0, current, minimumLimit, hourStart, hourStart + hourMs }
end

redis.call('HSET', key, reservationField, '1')
local count = redis.call('HINCRBY', key, countField, 1)
redis.call('PEXPIREAT', key, hourStart + (2 * hourMs))
return { 1, count, minimumLimit, hourStart, hourStart + hourMs }
`;

const releaseHourlySlotScript = `
local reservationField = 'reservation:' .. ARGV[1] .. ':' .. ARGV[2]
if redis.call('HDEL', KEYS[1], reservationField) ~= 1 then
  return 0
end

local countField = 'count:' .. ARGV[1]
local current = tonumber(redis.call('HGET', KEYS[1], countField) or '0')
if current <= 0 then
  return 1
end

local nextCount = redis.call('HINCRBY', KEYS[1], countField, -1)
if nextCount <= 0 then
  redis.call('HDEL', KEYS[1], countField)
end
return 1
`;

// This is a short send-start gate, not a lock around SMTP. A worker owns the
// gate only until it has invoked sendMail; the lock has a TTL for crash safety.
// Workers that cannot acquire it receive a Redis-clock timestamp and retry.
const acquireSendStartSlotScript = `
local nowMs
if ARGV[4] and ARGV[4] ~= '' then
  nowMs = tonumber(ARGV[4])
else
  local time = redis.call('TIME')
  nowMs = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
end

local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local lock = redis.call('GET', KEYS[2])
if lock then
  return { 0, math.max(nowMs + ${MIN_SEND_START_RETRY_MS}, current), 0, current }
end

if current > nowMs then
  return { 0, current, 0, current }
end

redis.call('SET', KEYS[2], ARGV[2], 'PX', ARGV[3], 'NX')
local reservedUntil = nowMs + tonumber(ARGV[1])
redis.call('SET', KEYS[1], reservedUntil)
return { 1, nowMs, reservedUntil, current }
`;

const releaseSendStartSlotScript = `
if redis.call('GET', KEYS[2]) ~= ARGV[1] then
  return 0
end

if ARGV[4] == '1' and redis.call('GET', KEYS[1]) == ARGV[2] then
  local previous = tonumber(ARGV[3]) or 0
  if previous > 0 then
    redis.call('SET', KEYS[1], previous)
  else
    redis.call('DEL', KEYS[1])
  end
end

redis.call('DEL', KEYS[2])
return 1
`;

function rateLimitKey(senderId: string): string {
  return `rate:{${senderId}}`;
}

function sendSpacingKey(senderId: string): string {
  return `sender:{${senderId}}:next-send-at`;
}

function sendStartLockKey(senderId: string): string {
  return `sender:{${senderId}}:send-start-lock`;
}

export function nextUtcHourBoundary(timestamp: number): number {
  return (Math.floor(timestamp / HOUR_MS) + 1) * HOUR_MS;
}

export function utcHourWindow(timestamp: number): { hourStart: number; nextHourAt: number } {
  const hourStart = Math.floor(timestamp / HOUR_MS) * HOUR_MS;
  return { hourStart, nextHourAt: hourStart + HOUR_MS };
}

async function evaluateHourlyReservation(
  senderId: string,
  campaignId: string,
  reservationId: string,
  hourlyLimit: number,
  previousHourStart: number | undefined,
  nowMs: number | undefined,
  client: RedisScriptClient,
): Promise<HourlySlotReservation> {
  const result = (await client.eval(
    reserveHourlySlotScript,
    1,
    rateLimitKey(senderId),
    String(hourlyLimit),
    campaignId,
    reservationId,
    previousHourStart === undefined ? '' : String(previousHourStart),
    nowMs === undefined ? '' : String(nowMs),
  )) as [number, number, number, number, number];

  const [allowed, count, effectiveLimit, hourStart, nextHourAt] = result;
  return {
    allowed: allowed === 1,
    count,
    effectiveLimit,
    hourStart,
    nextHourAt,
    reservationId,
  };
}

export async function reserveHourlySlot(
  senderId: string,
  campaignId: string,
  reservationId: string,
  hourlyLimit: number,
  client: RedisScriptClient = redisConnection,
): Promise<HourlySlotReservation> {
  const reservation = await evaluateHourlyReservation(
    senderId,
    campaignId,
    reservationId,
    hourlyLimit,
    undefined,
    undefined,
    client,
  );

  logHourlyReservation(senderId, reservation, hourlyLimit);
  return reservation;
}

export async function revalidateHourlySlot(
  senderId: string,
  campaignId: string,
  reservation: HourlySlotReservation,
  hourlyLimit: number,
  client: RedisScriptClient = redisConnection,
): Promise<HourlySlotReservation> {
  const updated = await evaluateHourlyReservation(
    senderId,
    campaignId,
    reservation.reservationId,
    hourlyLimit,
    reservation.hourStart,
    undefined,
    client,
  );

  logHourlyReservation(senderId, updated, hourlyLimit);
  return updated;
}

// Used by deterministic boundary tests so they do not need to wait for a
// wall-clock hour. Production calls always use Redis TIME in the Lua script.
export async function reserveHourlySlotAt(
  senderId: string,
  campaignId: string,
  reservationId: string,
  hourlyLimit: number,
  nowMs: number,
  client: RedisScriptClient = redisConnection,
): Promise<HourlySlotReservation> {
  return evaluateHourlyReservation(
    senderId,
    campaignId,
    reservationId,
    hourlyLimit,
    undefined,
    nowMs,
    client,
  );
}

export async function revalidateHourlySlotAt(
  senderId: string,
  campaignId: string,
  reservation: HourlySlotReservation,
  hourlyLimit: number,
  nowMs: number,
  client: RedisScriptClient = redisConnection,
): Promise<HourlySlotReservation> {
  return evaluateHourlyReservation(
    senderId,
    campaignId,
    reservation.reservationId,
    hourlyLimit,
    reservation.hourStart,
    nowMs,
    client,
  );
}

function logHourlyReservation(
  senderId: string,
  reservation: HourlySlotReservation,
  requestedLimit: number,
): void {
  if (reservation.allowed) {
    logger.info(
      {
        senderId,
        count: reservation.count,
        requestedLimit,
        effectiveLimit: reservation.effectiveLimit,
        hourStart: reservation.hourStart,
      },
      'Hourly rate-limit slot reserved',
    );
  } else {
    logger.warn(
      {
        senderId,
        count: reservation.count,
        requestedLimit,
        effectiveLimit: reservation.effectiveLimit,
        nextHourAt: reservation.nextHourAt,
      },
      'Hourly rate limit exceeded',
    );
  }
}

export async function releaseHourlySlot(
  senderId: string,
  hourStart: number,
  reservationId: string,
  client: RedisScriptClient = redisConnection,
): Promise<boolean> {
  const result = await client.eval(
    releaseHourlySlotScript,
    1,
    rateLimitKey(senderId),
    String(hourStart),
    reservationId,
  );

  return Number(result) === 1;
}

export async function acquireSendStartSlot(
  senderId: string,
  delayMs: number,
  lockTtlMs: number,
  client: RedisScriptClient = redisConnection,
): Promise<SendStartSlot> {
  const lockToken = crypto.randomUUID();
  const result = (await client.eval(
    acquireSendStartSlotScript,
    2,
    sendSpacingKey(senderId),
    sendStartLockKey(senderId),
    String(delayMs),
    lockToken,
    String(lockTtlMs),
    '',
  )) as [number, number, number, number];

  const [acquired, sendAtOrRetryAt, reservedUntil, previousNextSendAt] = result;
  const slot = {
    acquired: acquired === 1,
    retryAt: sendAtOrRetryAt,
    sendAt: acquired === 1 ? sendAtOrRetryAt : 0,
    reservedUntil,
    previousNextSendAt,
    lockToken: acquired === 1 ? lockToken : null,
  };

  logger.info(
    { senderId, delayMs, ...slot },
    slot.acquired ? 'Distributed send-start slot acquired' : 'Distributed send-start slot unavailable',
  );

  return slot;
}

export async function releaseSendStartSlot(
  senderId: string,
  slot: SendStartSlot,
  restoreReservation: boolean,
  client: RedisScriptClient = redisConnection,
): Promise<boolean> {
  if (!slot.lockToken) return false;

  const result = await client.eval(
    releaseSendStartSlotScript,
    2,
    sendSpacingKey(senderId),
    sendStartLockKey(senderId),
    slot.lockToken,
    String(slot.reservedUntil),
    String(slot.previousNextSendAt),
    restoreReservation ? '1' : '0',
  );

  return Number(result) === 1;
}

export const rateLimitKeys = {
  rateLimitKey,
  sendSpacingKey,
  sendStartLockKey,
};
