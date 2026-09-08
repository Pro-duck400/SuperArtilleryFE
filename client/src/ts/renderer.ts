// Canvas rendering
import type { Projectile } from './types/game';
import type { BattlefieldConfig } from './types/messages';
import { Terrain } from './terrain';
import type { HistoricalTrajectory, TrajectoryPoint } from './trajectory';

export interface RenderState {
  projectile: Projectile | null;
  activeTrajectory: TrajectoryPoint[];
  historicalTrajectories: HistoricalTrajectory[];
}

const ACTIVE_TRAJECTORY_COLOR = '#555555';
const CASTLE_EMOJIS = [
  '🏰', '🏯', '🏟️', '🏛️', '🛖', '🏚️', '🏠', '🏡', '🏦', '🏫', '💒', '🗼', '⛪', '🗽', '🕌', '🛕', '🕍', '🎪', '🏭'
] as const;

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private groundY = 140;
  private castleWidth = 10;
  private castleHeight = 10;
  private battlefield: BattlefieldConfig | null = null;
  private castleLeftByPlayerId: Record<number, number> = { 0: 20, 1: 260 };
  private castleGlyphs: Record<number, string> = { 0: '🏰', 1: '🏯' };
  private activeCastlePlayerId: number | null = null;
  private defeatedCastlePlayerIds = new Set<number>();
  private ripCastlePlayerIds = new Set<number>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Could not get 2D context from canvas');
    }
    this.ctx = context;
  }

  public clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  public drawGround(): void {
    if (!this.battlefield) return;

    this.ctx.fillStyle = '#4CAF50';
    this.ctx.strokeStyle = '#4CAF50';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(0, Terrain.getY(this.battlefield, 0));
    for (let x = this.battlefield.terrain.sampleWidth; x <= this.canvas.width; x += this.battlefield.terrain.sampleWidth) {
      this.ctx.lineTo(x, Terrain.getY(this.battlefield, x));
    }
    this.ctx.lineTo(this.canvas.width, this.canvas.height);
    this.ctx.lineTo(0, this.canvas.height);
    this.ctx.closePath();
    this.ctx.fill();

    this.ctx.beginPath();
    this.ctx.moveTo(0, Terrain.getY(this.battlefield, 0));
    for (let x = this.battlefield.terrain.sampleWidth; x <= this.canvas.width; x += this.battlefield.terrain.sampleWidth) {
      this.ctx.lineTo(x, Terrain.getY(this.battlefield, x));
    }
    this.ctx.stroke();
  }

  public drawWind(): void {
    if (!this.battlefield || this.battlefield.wind === 0) return;

    const centerX = this.canvas.width / 2;
    const y = 14;
    const direction = Math.sign(this.battlefield.wind);
    const length = Math.min(45, Math.abs(this.battlefield.wind));
    const endX = centerX + direction * length;

    this.ctx.save();
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.fillStyle = '#ffffff';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(centerX - direction * length, y);
    this.ctx.lineTo(endX, y);
    this.ctx.stroke();
    this.ctx.beginPath();
    this.ctx.moveTo(endX, y);
    this.ctx.lineTo(endX - direction * 6, y - 4);
    this.ctx.lineTo(endX - direction * 6, y + 4);
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.restore();
  }

  private randomizeCastleGlyphs(): void {
    const pool = [...CASTLE_EMOJIS];
    const leftIndex = Math.floor(Math.random() * pool.length);
    let rightIndex = Math.floor(Math.random() * pool.length);

    while (rightIndex === leftIndex) {
      rightIndex = Math.floor(Math.random() * pool.length);
    }

    this.castleGlyphs = {
      0: pool[leftIndex],
      1: pool[rightIndex]
    };
  }

  public drawCastle(playerId: number, leftX: number, isActive: boolean = false): void {
    const baseY = this.getCastleBaseY(leftX);
    const glyph = this.ripCastlePlayerIds.has(playerId)
      ? '🪦'
      : this.defeatedCastlePlayerIds.has(playerId)
        ? '💥'
      : (this.castleGlyphs[playerId] ?? (playerId === 0 ? '🏰' : '🏯'));
    const fontSize = Math.max(10, Math.round(this.castleHeight * 1.7));

    this.ctx.save();
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'bottom';
    this.ctx.font = `${fontSize}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    this.ctx.fillStyle = isActive ? '#ffd700' : '#ffffff';
    this.ctx.fillText(glyph, leftX - 6, baseY + 2);

    // DEBUG: Uncomment to show the calculated castle box against the emoji.
    // const topY = baseY - this.castleHeight;
    // this.ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
    // this.ctx.strokeStyle = 'rgba(255, 0, 0, 0.9)';
    // this.ctx.lineWidth = 1;
    // this.ctx.fillRect(leftX - 1, topY - 1, this.castleWidth + 2, this.castleHeight + 2);
    // this.ctx.strokeRect(leftX - 1, topY - 1, this.castleWidth + 2, this.castleHeight + 2);
    this.ctx.restore();
  }

  public applyBattlefield(battlefield: BattlefieldConfig): void {
    this.battlefield = battlefield;
    this.canvas.width = battlefield.width;
    this.canvas.height = battlefield.height;
    this.groundY = battlefield.groundY;
    this.castleWidth = battlefield.castleW;
    this.castleHeight = battlefield.castleH;
    this.defeatedCastlePlayerIds.clear();
    this.ripCastlePlayerIds.clear();
    this.randomizeCastleGlyphs();

    battlefield.castles.forEach((castle) => {
      this.castleLeftByPlayerId[castle.playerId] = castle.left_x;
    });

    this.render({ projectile: null, activeTrajectory: [], historicalTrajectories: [] });
  }

  public getGroundY(): number {
    return this.groundY;
  }

  public getTerrainY(x: number): number {
    return this.battlefield ? Terrain.getY(this.battlefield, x) : this.groundY;
  }

  private getCastleBaseY(leftX: number): number {
    const castle = this.battlefield?.castles.find((item) => item.left_x === leftX);
    return castle?.base_y ?? this.groundY;
  }

  public getCastleTopY(playerId?: number): number {
    if (playerId !== undefined) {
      const castle = this.battlefield?.castles.find((item) => item.playerId === playerId);
      if (castle) return castle.base_y - this.castleHeight;
    }
    return this.groundY - this.castleHeight;
  }

  public getCanvasWidth(): number {
    return this.canvas.width;
  }

  public getCastleMuzzleX(playerId: number): number {
    return this.castleLeftByPlayerId[playerId] + this.castleWidth / 2;
  }

  public getCastleLabelPosition(playerId: number): { x: number; y: number } {
    const castle = this.battlefield?.castles.find((item) => item.playerId === playerId);
    const bufferX = castle ? castle.left_x + this.castleWidth / 2 : this.getCastleMuzzleX(playerId);
    const bufferY = castle ? castle.base_y + 4 : this.groundY;

    // The canvas is drawn at a fixed buffer size but can be scaled down by CSS
    // (max-width: 100%; height: auto), so labels must convert to displayed CSS pixels.
    const scaleX = this.canvas.width ? this.canvas.clientWidth / this.canvas.width : 1;
    const scaleY = this.canvas.height ? this.canvas.clientHeight / this.canvas.height : 1;

    return {
      x: bufferX * (scaleX || 1),
      y: bufferY * (scaleY || 1)
    };
  }

  /**
   * Highlight the castle of the player whose turn it is (null clears the highlight)
   */
  public setActiveTurn(playerId: number | null): void {
    this.activeCastlePlayerId = playerId;
  }

  public setDefeatedPlayer(playerId: 0 | 1 | null): void {
    this.defeatedCastlePlayerIds.clear();
    if (playerId !== null) this.defeatedCastlePlayerIds.add(playerId);
  }

  public setDefeatedPlayers(playerIds: number[]): void {
    for (const playerId of playerIds) {
      this.defeatedCastlePlayerIds.add(playerId);
    }
  }

  public setRIPPlayers(playerIds: number[]): void {
    for (const playerId of playerIds) this.ripCastlePlayerIds.add(playerId);
  }

  public drawProjectile(projectile: Projectile): void {
    this.ctx.fillStyle = '#FF0000';
    this.ctx.beginPath();
    this.ctx.arc(projectile.x, projectile.y, 2, 0, Math.PI * 2);
    this.ctx.fill();
  }

  public drawActiveTrajectory(trajectory: TrajectoryPoint[]): void {
    if (trajectory.length < 2) return;

    this.ctx.save();
    this.ctx.strokeStyle = ACTIVE_TRAJECTORY_COLOR;
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([2, 2]); // Dashed line
    this.ctx.beginPath();
    this.ctx.moveTo(trajectory[0].x, trajectory[0].y);

    for (let i = 1; i < trajectory.length; i++) {
      this.ctx.lineTo(trajectory[i].x, trajectory[i].y);
    }

    this.ctx.stroke();
    this.ctx.restore();
  }

  private drawHistoricalTrajectories(trajectories: HistoricalTrajectory[]): void {
    for (const trajectory of trajectories) {
      if (trajectory.points.length < 2) continue;

      this.ctx.save();
      this.ctx.strokeStyle = `rgba(85, 85, 85, ${trajectory.opacity})`;
      this.ctx.lineWidth = 2;
      this.ctx.setLineDash([2, 3]);
      this.ctx.beginPath();
      this.ctx.moveTo(trajectory.points[0].x, trajectory.points[0].y);
      for (let index = 1; index < trajectory.points.length; index += 1) {
        this.ctx.lineTo(trajectory.points[index].x, trajectory.points[index].y);
      }
      this.ctx.stroke();
      this.ctx.restore();
    }
  }

  public render(state: RenderState): void {
    this.clear();
    this.drawWind();
    this.drawGround();
    for (const castle of this.battlefield?.castles ?? []) {
      this.drawCastle(castle.playerId, castle.left_x, this.activeCastlePlayerId === castle.playerId);
    }
    this.drawHistoricalTrajectories(state.historicalTrajectories);

    // Draw trajectory first (so it appears behind the projectile)
    if (state.activeTrajectory.length > 0) {
      this.drawActiveTrajectory(state.activeTrajectory);
    }

    if (state.projectile) {
      this.drawProjectile(state.projectile);
    }
  }
}
