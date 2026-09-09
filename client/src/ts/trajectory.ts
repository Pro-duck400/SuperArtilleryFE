import type { BattlefieldConfig } from './types/messages';
import type { Projectile } from './types/game';
import type { ShotHistoryEntry } from './game';
import { Physics } from './physics';
import { Terrain } from './terrain';

export interface TrajectoryPoint {
  x: number;
  y: number;
}

export interface HistoricalTrajectory {
  points: TrajectoryPoint[];
  opacity: number;
}

const HISTORICAL_OPACITIES = [0.4, 0.35, 0.3, 0.25] as const;

export function calculateShotTrajectory(
  battlefield: BattlefieldConfig,
  shot: ShotHistoryEntry,
  playerId: number
): TrajectoryPoint[] {
  const castle = battlefield.castles.find((item) => item.playerId === playerId);
  if (!castle) return [];

  const adjustedAngle = shot.direction
    ? shot.direction === 'Left' ? 180 - shot.angle : shot.angle
    : castle.left_x + battlefield.castleW / 2 < battlefield.width / 2
      ? shot.angle
      : 180 - shot.angle;
  const velocity = Physics.calculateVelocityComponents(adjustedAngle, shot.velocity);
  let projectile: Projectile = {
    x: castle.left_x + battlefield.castleW / 2,
    y: castle.base_y - battlefield.castleH,
    vx: velocity.vx,
    vy: velocity.vy
  };
  const points: TrajectoryPoint[] = [{ x: projectile.x, y: projectile.y }];

  for (let step = 0; step < 600; step += 1) {
    projectile = Physics.updateProjectile(
      projectile,
      1 / 60,
      battlefield.gravity,
      battlefield.wind
    );
    points.push({ x: projectile.x, y: projectile.y });

    if (
      projectile.y >= Terrain.getY(battlefield, projectile.x) ||
      projectile.x < 0 ||
      projectile.x > battlefield.width
    ) {
      break;
    }
  }

  return points;
}

export function createHistoricalTrajectories(
  battlefield: BattlefieldConfig,
  history: ShotHistoryEntry[],
  playerId: number
): HistoricalTrajectory[] {
  return history.map((shot, index) => ({
    points: calculateShotTrajectory(battlefield, shot, shot.playerId ?? playerId),
    opacity: HISTORICAL_OPACITIES[Math.min(index, HISTORICAL_OPACITIES.length - 1)]
  }));
}
