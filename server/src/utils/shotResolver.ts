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
  const firingCastle = battlefield.castles.find(castle => castle.playerId === playerId);
  if (!firingCastle) return null;
  const resolvedDirection = direction ?? getDefaultShotDirection(battlefield, playerId);
  const isLeft = resolvedDirection === 'Left';
  const adjustedAngle = isLeft ? 180 - angle : angle;
  const { vx, vy } = calculateVelocityComponents(adjustedAngle, velocity);
  const x0 = firingCastle.left_x + battlefield.castleWidth / 2;
  const y0 = firingCastle.base_y - battlefield.castleHeight;
  const terrainHitTime = checkTerrainCollision(
    x0,
    y0,
    vx,
    vy,
    battlefield.gravity,
    battlefield.wind,
    (x) => getTerrainY(battlefield, x),
    battlefield.canvasWidth
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
        castle.left_x + battlefield.castleWidth / 2,
        battlefield.castleWidth,
        battlefield.castleHeight,
        castle.base_y
      )
    }))
    .filter((hit): hit is { playerId: number; hitTime: number } => hit.hitTime !== null)
    .sort((left, right) => left.hitTime - right.hitTime || left.playerId - right.playerId);

  const firstHit = hits[0];
  if (!firstHit) return null;
  if (terrainHitTime !== null && terrainHitTime < firstHit.hitTime) return null;
  return firstHit;
}

export function getDefaultShotDirection(battlefield: Battlefield, playerId: number): 'Left' | 'Right' {
  const castle = battlefield.castles.find(item => item.playerId === playerId);
  return castle && castle.left_x + battlefield.castleWidth / 2 < battlefield.canvasWidth / 2
    ? 'Right'
    : 'Left';
}
