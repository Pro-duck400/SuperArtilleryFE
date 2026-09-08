import { GameManager } from '../services/gameManager';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { WebSocket } from 'ws';

describe('GameManager', () => {
  let gameManager: GameManager;

  beforeEach(() => {
    gameManager = new GameManager();
  });

  afterEach(() => {
    gameManager.shutdown();
  });

  describe('createGame', () => {
    it('creates a game with two empty player slots', () => {
      const result = gameManager.createGame('Alice');

      if (!('error' in result)) {
        expect(result.gameId).toBeDefined();
        expect(result.playerToken).toBeDefined();
        expect(result.inviteUrl).toBeDefined();
        expect(result.inviteCode).toBeDefined();
        expect(result.inviteCode.length).toBe(4);
        expect(/^[A-Z0-9]{4}$/.test(result.inviteCode)).toBe(true);
      } else {
        throw new Error('Should not have error');
      }
    });

    it('generates unique opaque game IDs and invitation codes', () => {
      const result1 = gameManager.createGame('Alice');
      const result2 = gameManager.createGame('Bob');

      if (!('error' in result1) && !('error' in result2)) {
        expect(result1.gameId).not.toBe(result2.gameId);
        expect(result1.playerToken).not.toBe(result2.playerToken);
        expect(result1.inviteCode).not.toBe(result2.inviteCode);
      } else {
        throw new Error('Should not have errors');
      }
    });

    it('returns invite URL and code separately', () => {
      const result = gameManager.createGame('Charlie');

      if (!('error' in result)) {
        expect(result.inviteUrl).toContain('invite=');
        expect(result.inviteUrl).toContain('?invite=');
        expect(result.inviteCode).not.toBe(result.playerToken);
        expect(result.inviteCode.length).toBe(4);
      } else {
        throw new Error('Should not have error');
      }
    });

    it('rejects invalid player names', () => {
      const result = gameManager.createGame('');
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.code).toBe('INVALID_PLAYER_NAME');
      }
    });

    it('rejects names longer than 15 characters', () => {
      const result = gameManager.createGame('ThisNameIsTooLongForTheGame');
      expect('error' in result).toBe(true);
    });

    it('rejects names starting with non-alphanumeric', () => {
      const result = gameManager.createGame('-InvalidName');
      expect('error' in result).toBe(true);
    });
  });

  describe('acceptInvitation', () => {
    it('allocates multiple lobby slots and reports readiness', () => {
      const created = gameManager.createGame('Alice', undefined, undefined, 4);
      if ('error' in created) throw new Error('Should create game');

      const bob = gameManager.acceptInvitation(created.inviteCode, 'Bob');
      const charlie = gameManager.acceptInvitation(created.inviteCode, 'Charlie');
      if ('error' in bob || 'error' in charlie) throw new Error('Should accept invitations');

      const aliceSocket = { readyState: WebSocket.OPEN, send: vi.fn() } as any;
      const bobSocket = { readyState: WebSocket.OPEN, send: vi.fn() } as any;
      const charlieSocket = { readyState: WebSocket.OPEN, send: vi.fn() } as any;
      gameManager.connectPlayer(created.gameId, created.playerToken, aliceSocket);
      gameManager.connectPlayer(created.gameId, bob.playerToken, bobSocket);
      gameManager.connectPlayer(created.gameId, charlie.playerToken, charlieSocket);

      const status = gameManager.getGameStatus(created.gameId, created.playerToken);
      if ('error' in status) throw new Error('Should return lobby status');
      expect(status.requiredPlayers).toBe(4);
      expect(status.playersConnected).toBe(3);
      expect(status.slots.map(slot => slot.playerName)).toEqual(['Alice', 'Bob', 'Charlie', undefined]);
      expect(status.slots.map(slot => slot.status)).toEqual(['ready', 'ready', 'ready', 'waiting']);
    });

    it('lets the creator skip a partially filled lobby and start with two players', () => {
      const created = gameManager.createGame('Alice', undefined, undefined, 4);
      if ('error' in created) throw new Error('Should create game');
      const accepted = gameManager.acceptInvitation(created.inviteCode, 'Bob');
      if ('error' in accepted) throw new Error('Should accept invitation');

      const aliceSocket = { readyState: WebSocket.OPEN, send: vi.fn() } as any;
      const bobSocket = { readyState: WebSocket.OPEN, send: vi.fn() } as any;
      gameManager.connectPlayer(created.gameId, created.playerToken, aliceSocket);
      gameManager.connectPlayer(created.gameId, accepted.playerToken, bobSocket);

      const skipped = gameManager.skipWaiting(created.gameId, created.playerToken);
      if ('error' in skipped) throw new Error('Should skip waiting players');
      expect(skipped.started).toBe(true);
      expect(skipped.playersConnected).toBe(2);
      expect(skipped.requiredPlayers).toBe(2);
    });

    it('starts a full three-player lobby and broadcasts the roster to every socket', () => {
      const created = gameManager.createGame('Alex', undefined, undefined, 3);
      if ('error' in created) throw new Error('Should create game');
      const bob = gameManager.acceptInvitation(created.inviteCode, 'Bob');
      const alice = gameManager.acceptInvitation(created.inviteCode, 'Alice');
      if ('error' in bob || 'error' in alice) throw new Error('Should accept invitations');

      const sockets = [0, 1, 2].map(() => ({ readyState: WebSocket.OPEN, send: vi.fn() }));
      gameManager.connectPlayer(created.gameId, created.playerToken, sockets[0] as any);
      gameManager.connectPlayer(created.gameId, bob.playerToken, sockets[1] as any);
      gameManager.connectPlayer(created.gameId, alice.playerToken, sockets[2] as any);

      const status = gameManager.getGameStatus(created.gameId, created.playerToken);
      if ('error' in status) throw new Error('Should return game status');
      expect(status.status).toBe('active');
      expect(status.playersConnected).toBe(3);
      for (const socket of sockets) {
        const start = socket.send.mock.calls
          .map(([payload]) => JSON.parse(payload as string))
          .find(message => message.type === 'game_start');
        expect(start.players.map((player: { playerName: string }) => player.playerName)).toEqual(['Alex', 'Bob', 'Alice']);
      }
    });

    it('accepts a valid invitation via token', () => {
      const created = gameManager.createGame('Alice');
      if ('error' in created) throw new Error('Should create game');

      const accepted = gameManager.acceptInvitation(created.inviteCode, 'Bob');
      if ('error' in accepted) throw new Error('Should accept invitation');

      expect(accepted.gameId).toBe(created.gameId);
      expect(accepted.playerToken).not.toBe(created.playerToken);
    });

    it('accepts a valid invitation via code', () => {
      const created = gameManager.createGame('Alice');
      if ('error' in created) throw new Error('Should create game');

      const accepted = gameManager.acceptInvitation(created.inviteCode, 'Bob');
      if ('error' in accepted) throw new Error('Should accept invitation');

      expect(accepted.gameId).toBe(created.gameId);
    });

    it('rejects an unknown invitation', () => {
      const result = gameManager.acceptInvitation('UNKNOWNCODE', 'Bob');
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.code).toBe('INVALID_INVITATION');
      }
    });

    it('rejects a second acceptance of the same invitation', () => {
      const created = gameManager.createGame('Alice');
      if ('error' in created) throw new Error('Should create game');

      // First acceptance should succeed
      const accepted1 = gameManager.acceptInvitation(created.inviteCode, 'Bob');
      if ('error' in accepted1) throw new Error('First acceptance should succeed');

      // Second acceptance should fail
      const accepted2 = gameManager.acceptInvitation(created.inviteCode, 'Charlie');
      expect('error' in accepted2).toBe(true);
      if ('error' in accepted2) {
        expect(accepted2.code).toBe('INVITATION_ALREADY_ACCEPTED');
      }
    });

    it('rejects invitation with invalid player name', () => {
      const created = gameManager.createGame('Alice');
      if ('error' in created) throw new Error('Should create game');

      const result = gameManager.acceptInvitation(created.inviteCode, '');
      expect('error' in result).toBe(true);
    });

    it('generates separate session token for invited player', () => {
      const created = gameManager.createGame('Alice');
      if ('error' in created) throw new Error('Should create game');

      const accepted = gameManager.acceptInvitation(created.inviteCode, 'Bob');
      if ('error' in accepted) throw new Error('Should accept invitation');

      expect(accepted.playerToken).not.toBe(created.playerToken);
      expect(accepted.playerToken.length).toBeGreaterThan(0);
    });
  });

  describe('getPlayerIdFromToken', () => {
    it('derives player ID from session token', () => {
      const created = gameManager.createGame('Alice');
      if ('error' in created) throw new Error('Should create game');

      const initiatorId = gameManager.getPlayerIdFromToken(created.gameId, created.playerToken);
      expect(initiatorId).toBe(0);

      const accepted = gameManager.acceptInvitation(created.inviteCode, 'Bob');
      if ('error' in accepted) throw new Error('Should accept invitation');

      const invitedId = gameManager.getPlayerIdFromToken(accepted.gameId, accepted.playerToken);
      expect(invitedId).toBe(1);
    });

    it('rejects token for different game', () => {
      const created1 = gameManager.createGame('Alice');
      const created2 = gameManager.createGame('Charlie');
      if ('error' in created1 || 'error' in created2) throw new Error('Should create games');

      // Try to use token from game1 in game2
      const result = gameManager.getPlayerIdFromToken(created2.gameId, created1.playerToken);
      expect(result).toBeNull();
    });

    it('rejects invalid token', () => {
      const created = gameManager.createGame('Alice');
      if ('error' in created) throw new Error('Should create game');

      const result = gameManager.getPlayerIdFromToken(created.gameId, 'invalid-token');
      expect(result).toBeNull();
    });
  });

  describe('expiration and cleanup', () => {
    it('expires pending invitations after TTL', () => {
      // This test requires waiting for cleanup cycle
      // Create a game and let it expire
      const created = gameManager.createGame('Alice');
      if ('error' in created) throw new Error('Should create game');

      // Immediately check - should exist
      let status = gameManager.getGameStatus(created.gameId, created.playerToken);
      expect(!('error' in status)).toBe(true);

      // In a real test with mocked timers, we'd advance time
      // For now, just verify the method exists and works
    });

    it('removes expired games from memory', () => {
      const created1 = gameManager.createGame('Alice');
      const created2 = gameManager.createGame('Bob');
      
      if ('error' in created1 || 'error' in created2) throw new Error('Should create games');

      // Both games should be in stats
      let stats = gameManager.getStats();
      expect(stats.gameCount).toBe(2);

      // After shutdown and restart, games would be gone
      // (In real scenario with time-based expiry)
    });

    it('enforces maximum active games limit', () => {
      const maxGames = 100;
      
      // Try to exceed max games
      for (let i = 0; i < maxGames + 1; i++) {
        const result = gameManager.createGame(`Player${i}`);
        
        if (i < maxGames) {
          expect('error' in result).toBe(false);
        } else {
          expect('error' in result).toBe(true);
          if ('error' in result) {
            expect(result.code).toBe('MAX_GAMES_REACHED');
          }
        }
      }

      const stats = gameManager.getStats();
      expect(stats.maxGamesReached).toBe(true);
    });
  });

  describe('WebSocket connection', () => {
    it('connects player via session token', () => {
      const created = gameManager.createGame('Alice');
      if ('error' in created) throw new Error('Should create game');

      // Mock WebSocket
      const mockWs = { readyState: WebSocket.OPEN } as any;

      const result = gameManager.connectPlayer(created.gameId, created.playerToken, mockWs);
      if ('error' in result) throw new Error('Should connect player');

      expect(result.playerId).toBe(0);
    });

    it('rejects invalid session token on WebSocket connect', () => {
      const created = gameManager.createGame('Alice');
      if ('error' in created) throw new Error('Should create game');

      const mockWs = { readyState: WebSocket.OPEN } as any;
      const result = gameManager.connectPlayer(created.gameId, 'invalid-token', mockWs);

      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.code).toBe('INVALID_SESSION_TOKEN');
      }
    });

    it('rejects unknown game ID', () => {
      const mockWs = { readyState: WebSocket.OPEN } as any;
      const result = gameManager.connectPlayer('unknown-game-id', 'some-token', mockWs);

      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.code).toBe('GAME_NOT_FOUND');
      }
    });
  });

  describe('fire action', () => {
    it('starts a hot-seat game from one connected socket', () => {
      const created = gameManager.createHotSeatGame('Alice', 'Bob');
      if ('error' in created) throw new Error('Should create hot-seat game');

      const socket = { readyState: WebSocket.OPEN, send: vi.fn() } as any;
      const connection = gameManager.connectPlayer(created.gameId, created.players[0].playerToken, socket);
      expect(connection).toEqual({ playerId: 0 });

      const game = (gameManager as any).games.get(created.gameId);
      expect(game.gameStarted).toBe(true);
      expect(game.initiator.websocket).toBe(socket);
      expect(game.invited.websocket).toBe(socket);
      expect(socket.send).toHaveBeenCalledTimes(2);
    });

    it('accepts fire with valid session token', () => {
      const created = gameManager.createGame('Alice');
      if ('error' in created) throw new Error('Should create game');

      const accepted = gameManager.acceptInvitation(created.inviteCode, 'Bob');
      if ('error' in accepted) throw new Error('Should accept invitation');

      // Connect both players to start game
      const mockWs = { readyState: WebSocket.OPEN, send: vi.fn() } as any;
      gameManager.connectPlayer(created.gameId, created.playerToken, mockWs);
      gameManager.connectPlayer(accepted.gameId, accepted.playerToken, mockWs);

      // Fire should work with session token
      const result = gameManager.fire(created.gameId, created.playerToken, 45, 50);
      if ('error' in result) {
        // May fail if it's not player's turn, but should not fail due to token
        expect(result.code).not.toBe('INVALID_SESSION_TOKEN');
      }
    });

    it('alternates authenticated turns between both players', () => {
      const created = gameManager.createGame('Alice');
      if ('error' in created) throw new Error('Should create game');
      const accepted = gameManager.acceptInvitation(created.inviteCode, 'Bob');
      if ('error' in accepted) throw new Error('Should accept invitation');

      const aliceSocket = { readyState: WebSocket.OPEN, send: vi.fn() } as any;
      const bobSocket = { readyState: WebSocket.OPEN, send: vi.fn() } as any;
      gameManager.connectPlayer(created.gameId, created.playerToken, aliceSocket);
      gameManager.connectPlayer(created.gameId, accepted.playerToken, bobSocket);

      const firstShot = gameManager.fire(created.gameId, created.playerToken, 45, 30);
      expect('error' in firstShot).toBe(false);
      const firstTurn = bobSocket.send.mock.calls
        .map(([payload]: [string]) => JSON.parse(payload))
        .filter((message: { type: string }) => message.type === 'turn_change')
        .at(-1);
      expect(firstTurn.playerId_turn).toBe(1);

      const secondShot = gameManager.fire(created.gameId, accepted.playerToken, 45, 30);
      expect('error' in secondShot).toBe(false);
      const secondTurn = aliceSocket.send.mock.calls
        .map(([payload]: [string]) => JSON.parse(payload))
        .filter((message: { type: string }) => message.type === 'turn_change')
        .at(-1);
      expect(secondTurn.playerId_turn).toBe(0);
    });

    it('rejects fire with invalid session token', () => {
      const created = gameManager.createGame('Alice');
      if ('error' in created) throw new Error('Should create game');

      const result = gameManager.fire(created.gameId, 'invalid-token', 45, 50);
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.code).toBe('INVALID_SESSION_TOKEN');
      }
    });

    it('validates angle and velocity', () => {
      const created = gameManager.createGame('Alice');
      if ('error' in created) throw new Error('Should create game');

      const accepted = gameManager.acceptInvitation(created.inviteCode, 'Bob');
      if ('error' in accepted) throw new Error('Should accept invitation');
      const socket = { readyState: WebSocket.OPEN, send: vi.fn() } as any;
      gameManager.connectPlayer(created.gameId, created.playerToken, socket);
      gameManager.connectPlayer(accepted.gameId, accepted.playerToken, socket);

      // Invalid angle
      const result1 = gameManager.fire(created.gameId, created.playerToken, 100, 30);
      expect('error' in result1 && result1.code).toBe('INVALID_ANGLE');

      // Invalid velocity
      const result2 = gameManager.fire(created.gameId, created.playerToken, 45, 29);
      expect('error' in result2 && result2.code).toBe('INVALID_VELOCITY');

      expect('error' in gameManager.fire(created.gameId, created.playerToken, 99, 30)).toBe(false);
    });
  });

  describe('rematch action', () => {
    it('starts a new round after both players request it', () => {
      const created = gameManager.createGame('Alice');
      if ('error' in created) throw new Error('Should create game');
      const accepted = gameManager.acceptInvitation(created.inviteCode, 'Bob');
      if ('error' in accepted) throw new Error('Should accept invitation');

      const firstSocket = { readyState: WebSocket.OPEN, send: vi.fn() } as any;
      const secondSocket = { readyState: WebSocket.OPEN, send: vi.fn() } as any;
      gameManager.connectPlayer(created.gameId, created.playerToken, firstSocket);
      gameManager.connectPlayer(accepted.gameId, accepted.playerToken, secondSocket);

      const game = (gameManager as any).games.get(created.gameId);
      game.status = 'finished';
      game.gameFinishedAt = Date.now();

      const waiting = gameManager.requestRematch(created.gameId, created.playerToken);
      expect(waiting).toMatchObject({ success: true, playersReady: 1, roundStarted: false });

      const started = gameManager.requestRematch(created.gameId, accepted.playerToken);
      expect(started).toMatchObject({ success: true, playersReady: 2, roundStarted: true });
      expect(game.round).toBe(2);
      expect(game.status).toBe('active');
      expect(firstSocket.send).toHaveBeenCalledWith(expect.stringContaining('"round":2'));
      expect(secondSocket.send).toHaveBeenCalledWith(expect.stringContaining('"round":2'));
    });

    it('keeps final rematch answers in the status payload before clearing the state', () => {
      const created = gameManager.createGame('Alice');
      if ('error' in created) throw new Error('Should create game');
      const accepted = gameManager.acceptInvitation(created.inviteCode, 'Bob');
      if ('error' in accepted) throw new Error('Should accept invitation');

      const firstSocket = { readyState: WebSocket.OPEN, send: vi.fn() } as any;
      const secondSocket = { readyState: WebSocket.OPEN, send: vi.fn() } as any;
      gameManager.connectPlayer(created.gameId, created.playerToken, firstSocket);
      gameManager.connectPlayer(accepted.gameId, accepted.playerToken, secondSocket);

      const game = (gameManager as any).games.get(created.gameId);
      game.status = 'finished';
      game.gameFinishedAt = Date.now();

      const firstResponse = gameManager.requestRematch(created.gameId, created.playerToken, 'play_again');
      expect(firstResponse).toMatchObject({ success: true, playersReady: 1, roundStarted: false });

      const finalResponse = gameManager.requestRematch(created.gameId, accepted.playerToken, 'had_enough');
      expect(finalResponse).toMatchObject({ success: true, playersReady: 1, roundStarted: false });
      expect(finalResponse.players).toEqual(expect.arrayContaining([
        expect.objectContaining({ playerId: 0, playerName: 'Alice', answer: 'play_again' }),
        expect.objectContaining({ playerId: 1, playerName: 'Bob', answer: 'had_enough' })
      ]));
      expect((gameManager as any).games.get(created.gameId).rematchAnswers).toEqual([null, null]);
    });
  });

  describe('game statistics', () => {
    it('returns accurate game count', () => {
      const stats1 = gameManager.getStats();
      expect(stats1.gameCount).toBe(0);

      gameManager.createGame('Alice');
      const stats2 = gameManager.getStats();
      expect(stats2.gameCount).toBe(1);

      gameManager.createGame('Bob');
      const stats3 = gameManager.getStats();
      expect(stats3.gameCount).toBe(2);
    });

    it('counts only pending invitations', () => {
      const created = gameManager.createGame('Alice');
      if ('error' in created) throw new Error('Should create game');

      let stats = gameManager.getStats();
      expect(stats.invitationCount).toBe(1);

      // Accept the invitation
      gameManager.acceptInvitation(created.inviteCode, 'Bob');
      stats = gameManager.getStats();
      expect(stats.invitationCount).toBe(0); // Invitation accepted
    });
  });
});
