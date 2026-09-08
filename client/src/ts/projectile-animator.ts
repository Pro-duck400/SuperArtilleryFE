// Handles projectile animation and trajectory tracking
import { Physics } from './physics';
import type { Renderer } from './renderer';
import type { Projectile } from './types/game';
import type { TrajectoryPoint } from './trajectory';

export interface AnimationFrame {
  projectile: Projectile | null;
  trajectory: TrajectoryPoint[];
}

export class ProjectileAnimator {
  private renderer: Renderer;
  private currentProjectile: Projectile | null = null;
  private trajectory: Array<{ x: number; y: number }> = [];
  private animationFrameId: number | null = null;
  private lastFrameTime = 0;
  private gravity = 600;
  private wind = 0;
  private canvasWidth: number;
  private onFrameCallback: ((frame: AnimationFrame) => void) | null = null;
  private onCompleteCallback: (() => void) | null = null;

  constructor(renderer: Renderer, canvasWidth: number) {
    this.renderer = renderer;
    this.canvasWidth = canvasWidth;
  }

  public configureScene(canvasWidth: number, _groundY: number, _launchY: number, gravity: number, wind: number): void {
    this.canvasWidth = canvasWidth;
    this.gravity = gravity;
    this.wind = wind;
  }

  public onFrame(callback: (frame: AnimationFrame) => void): void {
    this.onFrameCallback = callback;
  }

  public onComplete(callback: () => void): void {
    this.onCompleteCallback = callback;
  }

  /**
   * Start a new projectile animation
   */
  public fire(angle: number, velocity: number, startX: number, playerId: number, direction?: 'Left' | 'Right'): void {
    // Stop any existing animation
    this.stop();

    const labelPosition = typeof this.renderer.getCastleLabelPosition === 'function'
      ? this.renderer.getCastleLabelPosition(playerId)
      : { x: startX, y: 0 };
    const adjustedAngle = direction
      ? direction === 'Left' ? 180 - angle : angle
      : labelPosition.x < this.canvasWidth / 2 ? angle : 180 - angle;

    // Calculate initial velocity components
    const { vx, vy } = Physics.calculateVelocityComponents(adjustedAngle, velocity);

    // Initialize projectile at castle position
    this.currentProjectile = {
      x: startX,
      y: this.renderer.getCastleTopY(playerId),
      vx,
      vy
    };

    // Reset trajectory
    this.trajectory = [{ x: this.currentProjectile.x, y: this.currentProjectile.y }];
    this.lastFrameTime = 0;

    // Start animation
    this.animationFrameId = requestAnimationFrame((timestamp) => this.animate(timestamp));
  }

  /**
   * Stop the current animation
   */
  public stop(): void {
    const hadActiveState = this.currentProjectile !== null
      || this.animationFrameId !== null
      || this.trajectory.length > 0;

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.currentProjectile = null;
    this.trajectory = [];
    this.lastFrameTime = 0;
    if (hadActiveState) {
      this.onFrameCallback?.({ projectile: null, trajectory: [] });
    }
  }

  /**
   * Clear trajectory and render empty scene
   */
  public clear(): void {
    this.stop();
    this.trajectory = [];
    this.onFrameCallback?.({ projectile: null, trajectory: [] });
  }

  /**
   * Animation loop
   */
  private animate(timestamp: number): void {
    if (!this.currentProjectile) return;

    const deltaTime = this.lastFrameTime === 0 ? 0 : (timestamp - this.lastFrameTime) / 1000;
    this.lastFrameTime = timestamp;

    if (deltaTime > 0 && deltaTime < 0.1) {
      // Update projectile physics
      this.currentProjectile = Physics.updateProjectile(this.currentProjectile, deltaTime, this.gravity, this.wind);
      
      // Add to trajectory
      this.trajectory.push({ x: this.currentProjectile.x, y: this.currentProjectile.y });

      // Check if projectile hit terrain or went off screen
        if (this.currentProjectile.y >= this.renderer.getTerrainY(this.currentProjectile.x) ||
          this.currentProjectile.x < 0 || 
          this.currentProjectile.x > this.canvasWidth) {
        // Projectile finished; clear the active render channel explicitly.
        this.currentProjectile = null;
        this.animationFrameId = null;
        this.trajectory = [];
        this.lastFrameTime = 0;
        this.onFrameCallback?.({ projectile: null, trajectory: [] });
        this.onCompleteCallback?.();
        return;
      }
    }

    // Render current state
    this.onFrameCallback?.({ projectile: this.currentProjectile, trajectory: this.trajectory });

    // Continue animation
    this.animationFrameId = requestAnimationFrame((timestamp) => this.animate(timestamp));
  }
}
