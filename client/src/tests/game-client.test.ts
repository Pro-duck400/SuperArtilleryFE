import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GameClient } from '../ts/game-client';
import { Game } from '../ts/game';

describe('GameClient private-game flow', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('stores a create-game session and exposes it', async () => {
    const game = new Game();
    const client = new GameClient('http://localhost:3000', 'ws://localhost:3000', game);

    const healthSpy = vi.spyOn((client as any).apiClient, 'healthCheckWithRetry').mockResolvedValue({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: '0.00:00:01.000',
      gameCount: 0,
      invitationCount: 0,
      maxGamesReached: false,
      version: '1.0.0',
      contractVersion: '1.0.0'
    });
    const apiSpy = vi.spyOn((client as any).apiClient, 'createGame').mockResolvedValue({
      gameId: 'game-123',
      playerToken: 'token-a',
      inviteUrl: 'https://example.com/?invite=token-a',
      inviteCode: 'ABCD'
    });

    await client.createGame('Alice');

    expect(healthSpy).toHaveBeenCalled();
    expect(apiSpy).toHaveBeenCalledWith('Alice', window.location.href);
    expect(client.getGameSession()?.gameId).toBe('game-123');
    expect(client.hasActiveSession()).toBe(true);
  });

  it('restores a previously saved session from storage', () => {
    sessionStorage.setItem(
      'gameSession',
      JSON.stringify({
        gameId: 'saved-game',
        sessionToken: 'saved-token',
        playerName: 'Alice'
      })
    );

    const game = new Game();
    const client = new GameClient('http://localhost:3000', 'ws://localhost:3000', game);

    expect(client.hasActiveSession()).toBe(true);
    expect(client.getGameSession()?.gameId).toBe('saved-game');
  });

  it('returns player id from the stored session when available', () => {
    const game = new Game();
    const client = new GameClient('http://localhost:3000', 'ws://localhost:3000', game);

    game.setPlayer(0, 'Alice');
    expect(client.getPlayerId()).toBe(0);
  });

  it('records only local player shots received from the server', () => {
    const game = new Game();
    game.setPlayer(0, 'Alice');
    const client = new GameClient('http://localhost:3000', 'ws://localhost:3000', game);

    (client as any).handleMessage({ type: 'shot', playerId: 1, angle: 20, velocity: 100 });
    (client as any).handleMessage({ type: 'shot', playerId: 0, angle: 45, velocity: 150 });

    expect(game.getShotHistory()).toEqual([{ angle: 45, velocity: 150 }]);
  });

  it('dispatches rematch readiness updates from the server', () => {
    const game = new Game();
    const client = new GameClient('http://localhost:3000', 'ws://localhost:3000', game);
    const statusSpy = vi.fn();

    client.onRematchStatus(statusSpy);
    (client as any).handleMessage({
      type: 'rematch_status',
      playersReady: 1,
      required: 2
    });

    expect(statusSpy).toHaveBeenCalledWith(1);
  });

  it('applies consecutive turn changes for both players', () => {
    const game = new Game();
    game.setPlayer(0, 'Alice');
    const client = new GameClient('http://localhost:3000', 'ws://localhost:3000', game);
    const players = [
      { playerId: 0, name: 'Alice', active: true, connected: true },
      { playerId: 1, name: 'Bob', active: true, connected: true }
    ];

    (client as any).handleMessage({ type: 'turn_change', turnId: 1, players });
    expect(game.getState()).toMatchObject({ currentTurn: 1, isMyTurn: false });

    (client as any).handleMessage({ type: 'turn_change', turnId: 0, players });
    expect(game.getState()).toMatchObject({ currentTurn: 0, isMyTurn: true });
  });
});
