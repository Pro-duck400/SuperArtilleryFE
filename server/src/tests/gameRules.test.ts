import { WebSocket } from 'ws';
import { describe, expect, it } from 'vitest';
import type { PrivateGame } from '../types/private-game';
import { GameRules } from '../services/gameRules';
import { createBattlefield } from '../utils/battlefield';

function createFlatBattlefield() {
  const battlefield = createBattlefield(1);
  battlefield.terrain.hillHeight = 0;
  battlefield.terrain.leftY = battlefield.groundY;
  battlefield.terrain.rightY = battlefield.groundY;
  battlefield.castles[0].base_y = battlefield.groundY;
  battlefield.castles[1].base_y = battlefield.groundY;
  return battlefield;
}

function createGame(): PrivateGame {
  return {
    id: 'game-1',
    status: 'pending',
    createdAt: 100,
    expiresAt: 1_000,
    lastActivityAt: 100,
    invitation: {
      inviteCode: 'ABCD',
      inviteCodeHash: 'code-hash',
      expiresAt: 1_000,
      accepted: true
    },
    initiator: {
      name: 'Alice',
      sessionTokenHash: 'alice-hash',
      websocket: null
    },
    invited: {
      name: 'Bob',
      sessionTokenHash: 'bob-hash',
      websocket: null
    },
    currentTurn: 0,
    gameStarted: false,
    round: 1,
    rematchReady: [false, false]
  };
}

describe('GameRules', () => {
  it('starts a game when both players have open sockets', () => {
    const game = createGame();
    const socket = { readyState: WebSocket.OPEN } as WebSocket;
    game.initiator.websocket = socket;
    game.invited.websocket = socket;

    const result = new GameRules().startIfReady(game, 200);

    expect(result).not.toBeNull();
    expect(game.status).toBe('active');
    expect(game.gameStarted).toBe(true);
    expect(game.currentTurn).toBe(0);
    expect(game.lastActivityAt).toBe(200);
    expect(game.battlefield).toEqual(result?.battlefield);
  });

  it('transitions a pending game to expired when the initiator disconnects', () => {
    const game = createGame();

    const result = new GameRules().disconnect(game, 0, 300);

    expect(result).toEqual({ statusChanged: true, status: 'expired' });
    expect(game.initiator.websocket).toBeNull();
  });

  it('finishes an active game when a player disconnects', () => {
    const game = createGame();
    game.status = 'active';
    game.gameStarted = true;
    game.battlefield = createFlatBattlefield();

    const result = new GameRules().disconnect(game, 1, 400);

    expect(result).toEqual({ statusChanged: true, status: 'finished' });
    expect(game.gameFinishedAt).toBe(400);
  });

  it('switches turns after a miss and updates activity', () => {
    const game = createGame();
    game.status = 'active';
    game.gameStarted = true;
    game.battlefield = createFlatBattlefield();

    const result = new GameRules().fire(game, 0, 45, 10, 500);

    expect(result).toEqual({ kind: 'miss', nextPlayerId: 1 });
    expect(game.currentTurn).toBe(1);
    expect(game.lastActivityAt).toBe(500);
  });

  it('switches back to player one after player two misses', () => {
    const game = createGame();
    game.status = 'active';
    game.gameStarted = true;
    game.battlefield = createFlatBattlefield();
    game.currentTurn = 1;

    const result = new GameRules().fire(game, 1, 45, 10, 600);

    expect(result).toEqual({ kind: 'miss', nextPlayerId: 0 });
    expect(game.currentTurn).toBe(0);
  });

  it('finishes the game after a hit without switching turns', () => {
    const game = createGame();
    game.status = 'active';
    game.gameStarted = true;
    game.battlefield = createFlatBattlefield();

    const result = new GameRules().fire(game, 0, 0, 900, 600);

    expect(result.kind).toBe('hit');
    expect(game.status).toBe('finished');
    expect(game.gameFinishedAt).toBe(600);
    expect(game.currentTurn).toBe(0);
  });

  it('waits for both players before starting a rematch', () => {
    const game = createGame();
    game.status = 'finished';
    game.gameStarted = true;
    game.round = 2;
    game.gameFinishedAt = 700;
    game.battlefield = createFlatBattlefield();

    const rules = new GameRules();
    const waiting = rules.requestRematch(game, 0, 800);

    expect(waiting).toMatchObject({ kind: 'waiting', playersAnswered: 1, playersReady: 1 });
    expect(waiting.answers).toEqual(['play_again', null]);
    expect(game.rematchReady).toEqual([true, false]);
    expect(game.status).toBe('finished');

    const socket = { readyState: WebSocket.OPEN } as WebSocket;
    game.initiator.websocket = socket;
    game.invited.websocket = socket;
    const started = rules.requestRematch(game, 1, 900);

    expect(started.kind).toBe('started');
    expect(game.status).toBe('active');
    expect(game.round).toBe(3);
    expect(game.currentTurn).toBe(0);
    expect(game.gameFinishedAt).toBeUndefined();
    expect(game.rematchReady).toEqual([false, false]);
    expect(game.battlefield).toEqual(started.kind === 'started' ? started.battlefield : null);
  });

  it('clears rematch answers when a final response declines a rematch', () => {
    const game = createGame();
    game.status = 'finished';
    game.gameStarted = true;
    game.round = 2;
    game.gameFinishedAt = 700;
    game.battlefield = createFlatBattlefield();

    const rules = new GameRules();
    const firstResponse = rules.requestRematch(game, 0, 'play_again', 800);
    expect(firstResponse).toMatchObject({ kind: 'waiting', playersAnswered: 1, playersReady: 1 });
    expect(firstResponse.answers).toEqual(['play_again', null]);

    const finalResponse = rules.requestRematch(game, 1, 'had_enough', 900);
    expect(finalResponse).toMatchObject({ kind: 'waiting', playersAnswered: 2, playersReady: 1 });
    expect(finalResponse.answers).toEqual(['play_again', 'had_enough']);
    expect(game.status).toBe('finished');
    expect(game.round).toBe(2);
    expect(game.rematchReady).toEqual([false, false]);
    expect(game.rematchAnswers).toEqual([null, null]);
  });

  it('starts a new round with only the players who stayed in when another player had enough', () => {
    const game = createGame();
    game.status = 'finished';
    game.gameStarted = true;
    game.round = 2;
    game.gameFinishedAt = 700;
    game.battlefield = createFlatBattlefield();
    game.lobbySlots = [
      { playerId: 0, session: game.initiator, status: 'ready', active: true, eliminated: false },
      { playerId: 1, session: game.invited, status: 'ready', active: true, eliminated: false },
      { playerId: 2, session: { name: 'Charlie', sessionTokenHash: 'charlie-hash', websocket: null }, status: 'ready', active: true, eliminated: false }
    ];
    game.rematchAnswers = [null, null, null];
    game.rematchReady = [false, false, false];

    const rules = new GameRules();
    const firstResponse = rules.requestRematch(game, 0, 'play_again', 800);
    const secondResponse = rules.requestRematch(game, 1, 'play_again', 900);
    const finalResponse = rules.requestRematch(game, 2, 'had_enough', 1000);

    expect(firstResponse.kind).toBe('waiting');
    expect(secondResponse.kind).toBe('waiting');
    expect(finalResponse.kind).toBe('started');
    expect(game.status).toBe('active');
    expect(game.round).toBe(3);
    expect(game.lobbySlots.filter(slot => slot.active && !slot.eliminated)).toHaveLength(2);
    expect(game.lobbySlots.map(slot => slot.playerId)).toEqual([0, 1]);
    expect(game.lobbySlots.filter(slot => slot.status === 'skipped').map(slot => slot.playerId)).toEqual([]);
    expect(finalResponse.answers).toEqual(['play_again', 'play_again', 'had_enough']);
  });

  it('clears rematch readiness when a finished player disconnects', () => {
    const game = createGame();
    game.status = 'finished';
    game.gameStarted = true;
    game.rematchReady = [true, true];

    new GameRules().disconnect(game, 0, 500);

    expect(game.rematchReady).toEqual([false, true]);
    expect(game.status).toBe('finished');
  });
});
