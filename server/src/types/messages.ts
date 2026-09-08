import type { components } from './generated/openapi';

export type Position = components['schemas']['Position'];
export type Castle = components['schemas']['Castle'];
export type Battlefield = components['schemas']['Battlefield'];

export type GameStartMessage = components['schemas']['GameStartMessage'];
export type ShotMessage = components['schemas']['ShotMessage'];
export type TurnChangeMessage = components['schemas']['TurnChangeMessage'];
export type GameOverMessage = components['schemas']['GameOverMessage'];
export type RematchStatusMessage = components['schemas']['RematchStatusMessage'];
export type WebSocketErrorMessage = components['schemas']['WebSocketErrorMessage'];
export type LobbyStatusMessage = components['schemas']['LobbyStatusMessage'];

export type GameMessage = components['schemas']['GameMessage'];

