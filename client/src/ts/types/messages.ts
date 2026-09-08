import type { components } from './generated/openapi';

export type Position = components['schemas']['Position'];
export type CastleConfig = components['schemas']['Castle'];
export type BattlefieldConfig = components['schemas']['Battlefield'];
export type PlayerState = components['schemas']['PlayerState'];

export type GameStartMessage = components['schemas']['GameStartMessage'];
export type ShotMessage = components['schemas']['ShotMessage'];
export type TurnChangeMessage = components['schemas']['TurnChangeMessage'];
export type GameOverMessage = components['schemas']['GameOverMessage'];
export type WebSocketErrorMessage = components['schemas']['WebSocketErrorMessage'];

export type GameMessage = components['schemas']['GameMessage'];
