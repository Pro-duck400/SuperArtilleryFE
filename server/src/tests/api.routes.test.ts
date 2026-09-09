import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach } from 'vitest';
import { createApiRouter } from '../routes/api';
import { GameManager } from '../services/gameManager';
import { CONTRACT_VERSION } from '../contract-version';

describe('API routes', () => {
  let app: express.Express;
  let gameManager: GameManager;

  beforeEach(() => {
    gameManager = new GameManager();
    app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(gameManager));
  });

  it('creates a game and returns invite details', async () => {
    const response = await request(app)
      .post('/api/v1/games')
      .send({ name: 'Alice' })
      .expect(201);

    expect(response.body.gameId).toBeTruthy();
    expect(response.body.playerToken).toBeTruthy();
    expect(response.body.inviteCode).toMatch(/^[A-Z0-9]{4}$/i);
    expect(response.body.inviteUrl).toContain('invite=');
  });

  it('creates a hot-seat game with credentials for both players', async () => {
    const response = await request(app)
      .post('/api/v1/hot-seat/games')
      .send({ firstName: 'Alice', secondName: 'Bob' })
      .expect(201);

    expect(response.body.gameId).toBeTruthy();
    expect(response.body.players).toHaveLength(2);
    expect(response.body.players[0]).toMatchObject({ playerId: 0, name: 'Alice' });
    expect(response.body.players[1]).toMatchObject({ playerId: 1, name: 'Bob' });
    expect(response.body.players[0].playerToken).toBeTruthy();
    expect(response.body.players[1].playerToken).toBeTruthy();
  });

  it('accepts an invitation by code', async () => {
    const created = gameManager.createGame('Alice');
    if ('error' in created) throw new Error('Expected created game');

    const response = await request(app)
      .post('/api/v1/invitations/accept')
      .send({ inviteCode: created.inviteCode, name: 'Bob' })
      .expect(200);

    expect(response.body.gameId).toBe(created.gameId);
    expect(response.body.playerToken).toBeTruthy();
  });

  it('requires a session token for status polling', async () => {
    const created = gameManager.createGame('Alice');
    if ('error' in created) throw new Error('Expected created game');

    const response = await request(app)
      .get(`/api/v1/games/${created.gameId}/status`)
      .expect(401);

    expect(response.body.code).toBe('MISSING_SESSION_TOKEN');
  });

  it('returns status for a valid session token', async () => {
    const created = gameManager.createGame('Alice');
    if ('error' in created) throw new Error('Expected created game');

    const response = await request(app)
      .get(`/api/v1/games/${created.gameId}/status`)
      .query({ sessionToken: created.playerToken })
      .expect(200);

    expect(response.body.status).toBe('pending');
    expect(response.body.playersConnected).toBe(0);
    expect(response.body.required).toBe(2);
    expect(response.body.ready).toBe(false);
    expect(response.body.readyCount).toBe(0);
  });

  it('rejects a rematch request before the game has finished', async () => {
    const created = gameManager.createGame('Alice');
    if ('error' in created) throw new Error('Expected created game');

    const response = await request(app)
      .post(`/api/v1/games/${created.gameId}/rematch`)
      .query({ sessionToken: created.playerToken })
      .expect(400);

    expect(response.body.code).toBe('REMATCH_NOT_AVAILABLE');
  });

  it('requires a session token for rematch requests', async () => {
    const response = await request(app)
      .post('/api/v1/games/game-1/rematch')
      .expect(401);

    expect(response.body.code).toBe('MISSING_SESSION_TOKEN');
  });

  it('rejects fire without required payload fields', async () => {
    const response = await request(app)
      .post('/api/v1/fire')
      .query({ sessionToken: 'abc' })
      .send({ gameId: 'x', angle: 45 })
      .expect(400);

    expect(response.body.code).toBe('MISSING_FIELDS');
  });

  it('reports health with stats', async () => {
    const response = await request(app)
      .get('/api/v1/health')
      .expect(200);

    expect(response.body).toMatchObject({
      status: 'ok',
      games: expect.any(Number),
      invites: expect.any(Number),
      gamesEverStarted: expect.any(Number),
      maxReached: expect.any(Boolean),
      timestamp: expect.any(String),
      uptime: expect.stringMatching(/^\d+\.\d{2}:\d{2}:\d{2}\.\d{3}$/),
      contractVersion: CONTRACT_VERSION
    });
  });
});
