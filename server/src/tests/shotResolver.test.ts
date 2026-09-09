import { describe, expect, it } from 'vitest';
import type { Battlefield } from '../types/messages';
import { createBattlefield } from '../utils/battlefield';
import { checkCastleCollision } from '../utils/physics';
import { calculateCastleHitTime, calculateCastleHits } from '../utils/shotResolver';

function createFlatBattlefield() {
  const battlefield = createBattlefield(1);
  battlefield.terrain.hillHeight = 0;
  battlefield.terrain.leftY = battlefield.groundY;
  battlefield.terrain.rightY = battlefield.groundY;
  battlefield.castles[0].base_y = battlefield.groundY;
  battlefield.castles[1].base_y = battlefield.groundY;
  return battlefield;
}

describe('calculateCastleHitTime', () => {
  it('resolves a hit using the canonical battlefield', () => {
    const battlefield = createFlatBattlefield();

    const hitTime = calculateCastleHitTime(battlefield, 0, 0, 900);

    expect(hitTime).not.toBeNull();
    expect(hitTime).toBeGreaterThan(0);
  });

  it('keeps player one firing toward the left castle', () => {
    const battlefield = createFlatBattlefield();

    const hitTime = calculateCastleHitTime(battlefield, 1, 0, 900);

    expect(hitTime).not.toBeNull();
    expect(hitTime).toBeGreaterThan(0);
  });

  it('returns no collision for a projectile that falls short', () => {
    const battlefield = createFlatBattlefield();

    const hitTime = calculateCastleHitTime(battlefield, 0, 45, 10);

    expect(hitTime).toBeNull();
  });

  it('requires the projectile to enter the central 80 percent of the castle', () => {
    const centerHit = checkCastleCollision(
      0, 95, 100, 0, 0, 0, 100, 10, 10, 100
    );
    const borderMiss = checkCastleCollision(
      0, 90, 100, 0, 0, 0, 100, 10, 10, 100
    );

    expect(centerHit).not.toBeNull();
    expect(borderMiss).toBeNull();
  });

  it('does not count a corner touch as a castle hit', () => {
    const cornerTouch = checkCastleCollision(
      0, 90, 100, 0, 0, 0, 100, 10, 10, 100
    );

    expect(cornerTouch).toBeNull();
  });
});

describe('calculateCastleHits', () => {
  it('pierces every castle in the flat trajectory before the ground stops it', () => {
    const battlefield: Battlefield = {
      width: 500,
      height: 200,
      gravity: 0,
      wind: 0,
      groundY: 180,
      castleW: 10,
      castleH: 10,
      castles: [
        { playerId: 0, left_x: 95, base_y: 105 },
        { playerId: 1, left_x: 135, base_y: 100 },
        { playerId: 2, left_x: 175, base_y: 100 },
        { playerId: 3, left_x: 215, base_y: 100 }
      ],
      terrain: {
        version: 3,
        seed: 1,
        sampleWidth: 2,
        minY: 0,
        maxY: 180,
        hillCenter: 250,
        hillWidth: 50,
        hillHeight: 0,
        leftY: 100,
        rightY: 100
      }
    };

    const hits = calculateCastleHits(battlefield, 0, 0, 40, 'Right');

    expect(hits.map(hit => hit.playerId)).toEqual([1, 2, 3]);
    expect(hits[0].hitTime).toBeLessThan(hits[1].hitTime);
    expect(hits[1].hitTime).toBeLessThan(hits[2].hitTime);
  });
});
