// Player-related types

export interface Player {
  id: number;
  name: string;
  castleX: number;
  active?: boolean;
  connected?: boolean;
}
