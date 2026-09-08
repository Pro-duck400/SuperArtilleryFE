// Game-related types

export interface Position {
  x: number;
  y: number;
}

export interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface GameState {
  playerId: number | null;
  currentTurn: number;
  isMyTurn: boolean;
}
