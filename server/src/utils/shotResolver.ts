import type { Battlefield } from '../types/messages';
import { getTerrainY } from './battlefield';
import { calculateVelocityComponents, checkCastleCollision, checkTerrainCollision } from './physics';

export function calculateCastleHitTime(
  battlefield: Battlefield,
  playerId: number,
  angle: number,
  velocity: number,
  direction?: 'Left' | 'Right'
): number | null {
  const hit = calculateCastleHit(battlefield, playerId, angle, velocity, direction);
  return hit?.hitTime ?? null;
}

export function calculateCastleHit(
  battlefield: Battlefield,
  playerId: number,
  angle: number,
  velocity: number,
  direction?: 'Left' | 'Right'
): { playerId: number; hitTime: number } | null {
  return calculateCastleHits(battlefield, playerId, angle, velocity, direction)[0] ?? null;
}

/**
 * Resolve every castle pierced by a shot's trajectory before it is stopped by the
 * terrain or leaves the battlefield, so a shot can eliminate more than one player.
 */
export function calculateCastleHits(
  battlefield: Battlefield,
  playerId: number,
  angle: number,
  velocity: number,
  direction?: 'Left' | 'Right'
): Array<{ playerId: number; hitTime: number }> {
  const firingCastle = battlefield.castles.find(castle => castle.playerId === playerId);
  if (!firingCastle) return [];
  const resolvedDirection = direction ?? getDefaultShotDirection(battlefield, playerId);
  const isLeft = resolvedDirection === 'Left';
  const adjustedAngle = isLeft ? 180 - angle : angle;
  const { vx, vy } = calculateVelocityComponents(adjustedAngle, velocity);
  const x0 = firingCastle.left_x + battlefield.castleW / 2;
  const y0 = firingCastle.base_y - battlefield.castleH;
  const terrainHitTime = checkTerrainCollision(
    x0,
    y0,
    vx,
    vy,
    battlefield.gravity,
    battlefield.wind,
    (x) => getTerrainY(battlefield, x),
    battlefield.width
  );

  const hits = battlefield.castles
    .filter(castle => castle.playerId !== playerId)
    .map(castle => ({
      playerId: castle.playerId,
      hitTime: checkCastleCollision(
        x0,
        y0,
        vx,
        vy,
        battlefield.gravity,
        battlefield.wind,
        castle.left_x + battlefield.castleW / 2,
        battlefield.castleW,
        battlefield.castleH,
        castle.base_y
      )
    }))
    .filter((hit): hit is { playerId: number; hitTime: number } => hit.hitTime !== null)
    // The projectile is stopped by the terrain, so only castles reached beforehand are pierced.
    .filter((hit) => terrainHitTime === null || hit.hitTime <= terrainHitTime)
    .sort((left, right) => left.hitTime - right.hitTime || left.playerId - right.playerId);

  return hits;
}

export function getDefaultShotDirection(battlefield: Battlefield, playerId: number): 'Left' | 'Right' {
  const castle = battlefield.castles.find(item => item.playerId === playerId);
  return castle && castle.left_x + battlefield.castleW / 2 < battlefield.width / 2
    ? 'Right'
    : 'Left';
}
