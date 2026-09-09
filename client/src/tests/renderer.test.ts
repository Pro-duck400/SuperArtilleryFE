import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Renderer } from '../ts/renderer';
import type { BattlefieldConfig } from '../ts/types/messages';
import { createHistoricalTrajectories } from '../ts/trajectory';

function createContext(): CanvasRenderingContext2D & { strokeStyles: string[] } {
  const context = {
    strokeStyles: [] as string[],
    fillStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    setLineDash: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    fillText: vi.fn(),
    save: vi.fn(),
    restore: vi.fn()
  } as unknown as CanvasRenderingContext2D & { strokeStyles: string[] };

  Object.defineProperty(context, 'strokeStyle', {
    get: () => context.strokeStyles.at(-1) ?? '',
    set: (value: string) => context.strokeStyles.push(value)
  });
  return context;
}

const battlefield = {
  width: 420,
  height: 240,
  gravity: 100,
  wind: 0,
  groundY: 140,
  castleW: 10,
  castleH: 10,
  castles: [
    { playerId: 0, left_x: 20, base_y: 140 },
    { playerId: 1, left_x: 250, base_y: 140 }
  ],
  terrain: {
    version: 2,
    seed: 1,
    sampleWidth: 2,
    minY: 0,
    maxY: 140,
    leftY: 140,
    rightY: 140,
    hillCenter: 140,
    hillWidth: 50,
    hillHeight: 0
  }
} as BattlefieldConfig;

describe('Renderer trajectory styles', () => {
  let context: CanvasRenderingContext2D & { strokeStyles: string[] };

  beforeEach(() => {
    context = createContext();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
  });

  it('draws historical and active trajectories with dark gray styles', () => {
    const canvas = document.createElement('canvas');
    const renderer = new Renderer(canvas);
    renderer.applyBattlefield(battlefield);
    context.strokeStyles.length = 0;

    renderer.render({
      projectile: null,
      historicalTrajectories: [{
        points: [{ x: 25, y: 130 }, { x: 30, y: 120 }],
        opacity: 1
      }],
      activeTrajectory: [{ x: 25, y: 130 }, { x: 35, y: 115 }]
    });

    expect(context.strokeStyles).toContain('rgba(85, 85, 85, 1)');
    expect(context.strokeStyles).toContain('#555555');
  });

  it('draws an active trajectory with the same dark gray color', () => {
    const canvas = document.createElement('canvas');
    const renderer = new Renderer(canvas);
    renderer.applyBattlefield(battlefield);
    context.strokeStyles.length = 0;

    renderer.render({
      projectile: null,
      historicalTrajectories: [],
      activeTrajectory: [{ x: 25, y: 130 }, { x: 35, y: 115 }]
    });

    expect(context.strokeStyles).toContain('#555555');
  });

  it('uses the requested historical dark gray fade steps', () => {
    const history = createHistoricalTrajectories(
      battlefield,
      [
        { angle: 20, velocity: 100 },
        { angle: 30, velocity: 110 },
        { angle: 40, velocity: 120 },
        { angle: 50, velocity: 130 }
      ],
      0
    );

    expect(history.map((trajectory) => trajectory.opacity)).toEqual([0.4, 0.35, 0.3, 0.25]);
  });

  it('applies historical opacity directly to the dark gray stroke', () => {
    const canvas = document.createElement('canvas');
    const renderer = new Renderer(canvas);
    renderer.applyBattlefield(battlefield);
    context.strokeStyles.length = 0;

    renderer.render({
      projectile: null,
      historicalTrajectories: [{
        points: [{ x: 25, y: 130 }, { x: 30, y: 120 }],
        opacity: 0.8
      }],
      activeTrajectory: []
    });

    expect(context.strokeStyles).toContain('rgba(85, 85, 85, 0.8)');
  });

  it('draws castle emojis 2px further left and on the ground line', () => {
    const canvas = document.createElement('canvas');
    const renderer = new Renderer(canvas);
    renderer.applyBattlefield(battlefield);
    const fillTextSpy = vi.spyOn(context, 'fillText');

    renderer.render({
      projectile: null,
      historicalTrajectories: [],
      activeTrajectory: []
    });

    const glyphs = renderer['castleGlyphs'];
    expect(fillTextSpy).toHaveBeenCalledWith(glyphs[0], 14, 142);
    expect(fillTextSpy).toHaveBeenCalledWith(glyphs[1], 244, 142);
    expect(context.font).toMatch(/\d+px/);
  });

  it('replaces the defeated castle emoji with an explosion', () => {
    const canvas = document.createElement('canvas');
    const renderer = new Renderer(canvas);
    renderer.applyBattlefield(battlefield);
    renderer.setDefeatedPlayer(1);
    const fillTextSpy = vi.spyOn(context, 'fillText');

    renderer.render({ projectile: null, historicalTrajectories: [], activeTrajectory: [] });

    expect(fillTextSpy).toHaveBeenCalledWith('💥', 244, 142);
  });

  it('keeps earlier RIP castles when a later player is defeated', () => {
    const canvas = document.createElement('canvas');
    const renderer = new Renderer(canvas);
    renderer.applyBattlefield(battlefield);
    renderer.setDefeatedPlayers([0]);
    renderer.setRIPPlayers([0]);
    renderer.setDefeatedPlayers([1]);
    const fillTextSpy = vi.spyOn(context, 'fillText');

    renderer.render({ projectile: null, historicalTrajectories: [], activeTrajectory: [] });

    expect(fillTextSpy).toHaveBeenCalledWith('🪦', 14, 142);
    expect(fillTextSpy).toHaveBeenCalledWith('💥', 244, 142);
  });

  it('chooses two different random castle emoji for each player from the approved set', () => {
    const canvas = document.createElement('canvas');
    const renderer = new Renderer(canvas);
    const randomSpy = vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.5)
      .mockReturnValueOnce(0.7)
      .mockReturnValueOnce(0.2);

    renderer.applyBattlefield(battlefield);

    const glyphs = renderer['castleGlyphs'];
    expect(Object.values(glyphs)).toHaveLength(2);
    expect(new Set(Object.values(glyphs)).size).toBe(2);
    expect(['🏰', '🏯', '🏟️', '🏛️', '🛖', '🏚️', '🏠', '🏡', '🏢', '🏣', '🏤', '🏥', '🏦', '🏨', '🏩', '🏪', '🏫', '🏬', '🏭', '💒', '🗼', '⛪', '🗽', '🕌', '🛕', '🕍', '⛩️', '🕋', '⛺', '🎪']).toContain(glyphs[0]);
    expect(['🏰', '🏯', '🏟️', '🏛️', '🛖', '🏚️', '🏠', '🏡', '🏢', '🏣', '🏤', '🏥', '🏦', '🏨', '🏩', '🏪', '🏫', '🏬', '🏭', '💒', '🗼', '⛪', '🗽', '🕌', '🛕', '🕍', '⛩️', '🕋', '⛺', '🎪']).toContain(glyphs[1]);

    randomSpy.mockRestore();
  });
});
