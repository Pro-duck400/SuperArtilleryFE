import type { Battlefield } from '../types/messages';

export const TERRAIN_VERSION = 3;

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function randomBetween(random: () => number, min: number, max: number): number {
  return min + random() * (max - min);
}

function hillContribution(x: number, hillCenter: number, hillWidth: number, hillHeight: number): number {
  const distance = (x - hillCenter) / hillWidth;
  return Math.abs(distance) <= 1
    ? hillHeight * (1 + Math.cos(distance * Math.PI)) / 2
    : 0;
}

export function getTerrainY(battlefield: Battlefield, x: number): number {
  const { minY, maxY, hillCenter, hillWidth, hillHeight, extraHills } = battlefield.terrain;
  const leftY = battlefield.terrain.leftY ?? maxY;
  const rightY = battlefield.terrain.rightY ?? maxY;
  const distance = (x - hillCenter) / hillWidth;
  const baselineY = x < hillCenter - hillWidth
    ? leftY
    : x > hillCenter + hillWidth
      ? rightY
      : leftY + (rightY - leftY) * ((distance + 1) / 2);
  const hill = hillContribution(x, hillCenter, hillWidth, hillHeight) +
    (extraHills ?? []).reduce(
      (total, extraHill) => total + hillContribution(x, extraHill.hillCenter, extraHill.hillWidth, extraHill.hillHeight),
      0
    );
  return Math.min(maxY, Math.max(minY, baselineY - hill));
}

export function createBattlefield(
  seed: number = Math.floor(Math.random() * 0x100000000),
  playerCount: number = 2
): Battlefield {
  const count = Math.max(2, Math.min(9, Math.floor(playerCount)));
  const width = count === 2 ? 420 : 260 + count * 160;
  const height = 240 + (count - 2) * 20;
  const random = createRandom(seed);
  const terrainVariationRoll = random();
  const hillHeight = terrainVariationRoll < 1 / 2
    ? randomBetween(random, 15, 65)
    : randomBetween(random, -65, -15);
  const extraHillCount = Math.max(0, count - 3);
  const battlefield: Battlefield = {
    width,
    height,
    gravity: 100,
    wind: randomBetween(random, -50, 50),
    groundY: height - 20,
    castleW: 10,
    castleH: 10,
    castles: Array.from({ length: count }, (_, playerId) => ({
      playerId,
      left_x: 15 + playerId * ((width - 30 - 10) / (count - 1)),
      base_y: 0
    })),
    terrain: {
      version: TERRAIN_VERSION,
      seed: seed >>> 0,
      sampleWidth: 2,
      minY: 0,
      maxY: height - 20,
      hillCenter: width / 2,
      hillWidth: width / (count + 1),
      hillHeight,
      leftY: 0,
      rightY: 0,
      extraHills: Array.from({ length: extraHillCount }, () => {
        const extraHillHeight = random() < 1 / 2
          ? randomBetween(random, 15, 55)
          : randomBetween(random, -55, -15);
        return {
          hillCenter: randomBetween(random, width * 0.15, width * 0.85),
          hillWidth: randomBetween(random, width * 0.06, width * 0.12),
          hillHeight: extraHillHeight
        };
      })
    }
  };

  battlefield.terrain.leftY = randomBetween(random, 110, battlefield.terrain.maxY);
  battlefield.terrain.rightY = randomBetween(random, 110, battlefield.terrain.maxY);

  for (const castle of battlefield.castles) {
    castle.base_y = getTerrainY(battlefield, castle.left_x + battlefield.castleW / 2);
  }

  return battlefield;
}
