import { describe, expect, it } from 'vitest';
import { createBattlefield, getTerrainY } from '../utils/battlefield';

describe('battlefield generation', () => {
  it('reproduces the same battlefield for the same seed', () => {
    expect(createBattlefield(12345)).toEqual(createBattlefield(12345));
  });

  it('places castles on opposite sides and on the terrain surface', () => {
    const battlefield = createBattlefield(12345);

    expect(battlefield.castles[0].left_x).toBeGreaterThanOrEqual(15);
    expect(battlefield.castles[0].left_x).toBeLessThanOrEqual(80);
    expect(battlefield.castles[1].left_x).toBeGreaterThanOrEqual(340);
    expect(battlefield.castles[1].left_x).toBeLessThanOrEqual(405);

    for (const castle of battlefield.castles) {
      expect(castle.base_y).toBe(
        getTerrainY(battlefield, castle.left_x + battlefield.castleWidth / 2)
      );
    }
  });

  it('generates bounded terrain between the castles', () => {
    const battlefield = createBattlefield(12345);
    const terrainY = getTerrainY(battlefield, battlefield.terrain.hillCenter);

    expect(terrainY).toBeLessThanOrEqual(battlefield.terrain.maxY);
    expect(terrainY).toBeGreaterThanOrEqual(battlefield.terrain.minY);
  });

  it('generates deterministic wind within the supported range', () => {
    const first = createBattlefield(12345);
    const second = createBattlefield(12345);

    expect(first.wind).toBe(second.wind);
    expect(first.wind).toBeGreaterThanOrEqual(-50);
    expect(first.wind).toBeLessThanOrEqual(50);
  });

  it('generates independent side elevations and bounded middle terrain', () => {
    const first = createBattlefield(12345);
    const second = createBattlefield(54321);
    const leftEdge = first.terrain.hillCenter - first.terrain.hillWidth;
    const rightEdge = first.terrain.hillCenter + first.terrain.hillWidth;

    expect(first.terrain.leftY).not.toBe(first.terrain.rightY);
    expect(first.terrain.leftY).not.toBe(second.terrain.leftY);
    expect(getTerrainY(first, 0)).toBe(first.terrain.leftY);
    expect(getTerrainY(first, leftEdge)).toBe(first.terrain.leftY);
    expect(getTerrainY(first, rightEdge)).toBe(first.terrain.rightY);
    expect(getTerrainY(first, first.canvasWidth)).toBe(first.terrain.rightY);
    expect(first.terrain.hillHeight).toBeGreaterThanOrEqual(-65);
    expect(first.terrain.hillHeight).toBeLessThanOrEqual(65);
    expect(getTerrainY(first, first.canvasWidth)).toBeGreaterThanOrEqual(first.terrain.minY);
    expect(getTerrainY(first, first.canvasWidth)).toBeLessThanOrEqual(first.terrain.maxY);
  });

  it('can generate both a crest and a depression from different seeds', () => {
    const samples = Array.from(
      { length: 300 },
      (_, index) => createBattlefield((index * 1_000_003 + 1) >>> 0)
    );

    expect(samples.some(({ terrain }) => terrain.hillHeight > 0)).toBe(true);
    expect(samples.some(({ terrain }) => terrain.hillHeight < 0)).toBe(true);
    expect(samples.every(({ terrain }) => terrain.hillHeight !== 0)).toBe(true);
  });
});
