import { Router } from 'express';
import type { Request } from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import { GameManager } from '../services/gameManager';
import type { HealthResponse, ErrorResponse } from '../types/private-game';
import { HTTP_STATUS } from '../httpStatus';
import { CONTRACT_VERSION } from '../contract-version';

// Derive a full base URL for the client that preserves any pathname when possible.
// Prefer the full Referer (origin + pathname) so invite links include the app path
// (e.g. https://user.github.io/SuperArtillery/). Fall back to Origin if Referer
// is absent or malformed.
function getClientBaseUrl(req: Request): string | undefined {
  const referer = req.headers.referer;
  if (typeof referer === 'string' && referer) {
    try {
      const u = new URL(referer);
      // Ensure pathname ends with '/'
      const pathname = u.pathname.endsWith('/') ? u.pathname : `${u.pathname}/`;
      return `${u.origin}${pathname}`;
    } catch {
      // ignore malformed referer
    }
  }

  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin) {
    return origin;
  }

  return undefined;
}

function formatUptime(uptimeSeconds: number): string {
  const totalMilliseconds = Math.floor(uptimeSeconds * 1000);
  const days = Math.floor(totalMilliseconds / 86400000);
  const hours = Math.floor(totalMilliseconds / 3600000) % 24;
  const minutes = Math.floor(totalMilliseconds / 60000) % 60;
  const seconds = Math.floor(totalMilliseconds / 1000) % 60;
  const milliseconds = totalMilliseconds % 1000;

  return `${days}.${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
}

export function createApiRouter(game: GameManager): Router {
  const router = Router();

  router.use((req, res, next) => {
    const bodyPlayerName = typeof req.body?.name === 'string'
      ? req.body.name
      : typeof req.body?.firstName === 'string'
        ? [req.body.firstName, req.body.secondName].filter((name): name is string => typeof name === 'string').join(', ')
        : undefined;
    const token = typeof req.query.sessionToken === 'string' ? req.query.sessionToken : undefined;
    const gameId = typeof req.params.gameId === 'string' ? req.params.gameId : undefined;
    const playerName = bodyPlayerName ?? (token ? game.getPlayerNameFromToken(token, gameId) : undefined) ?? 'anonymous';
    const endpoint = `${req.method} ${req.baseUrl}${req.path}`;
    console.log(`🌐 HTTP endpoint=${endpoint} player=${playerName}`);
    res.once('finish', () => {
      console.log(`🌐 HTTP response endpoint=${endpoint} player=${playerName} status=${res.statusCode}`);
    });
    next();
  });

  // Determine server version from env or package.json once at startup
  const SERVER_VERSION: string =
    process.env.VERSION ||
    (() => {
      try {
        const pkg = JSON.parse(
          readFileSync(join(__dirname, '../../package.json'), 'utf8')
        );
        return typeof pkg.version === 'string' ? pkg.version : 'dev';
      } catch (e) {
        return 'dev';
      }
    })();

  // GET /api/v1/health - Enhanced health check
  router.get('/v1/health', (_req, res) => {
    const stats = game.getStats();
    const timestamp = new Date();
    const uptime = process.uptime();
    const healthResponse: HealthResponse = {
      status: stats.maxReached ? 'degraded' : 'ok',
      timestamp: timestamp.toISOString(),
      uptime: formatUptime(uptime),
      games: stats.games,
      inviteCount: stats.inviteCount,
      maxReached: stats.maxReached,
      version: SERVER_VERSION,
      contractVersion: CONTRACT_VERSION
    };
    res.json(healthResponse);
  });

  // POST /api/v1/games - Create a private game
  router.post('/v1/games', (req, res) => {
    const { name, playerCount, clientUrl } = req.body;
    const clientOrigin = typeof clientUrl === 'string' ? clientUrl : getClientBaseUrl(req);
    const forwardedProto = req.headers['x-forwarded-proto'];
    const protocol = typeof forwardedProto === 'string'
      ? forwardedProto.split(',')[0].trim()
      : req.protocol;
    const serverOrigin = process.env.SERVER_URL || `${protocol}://${req.get('host')}`;

    const result = game.createGame(name, clientOrigin, serverOrigin, playerCount ?? 2);

    if ('error' in result) {
      const statusCode = result.code === GameManager.ERROR_CODES.MAX_GAMES_REACHED ? HTTP_STATUS.SERVICE_UNAVAILABLE : HTTP_STATUS.BAD_REQUEST;
      const errorResponse: ErrorResponse = {
        code: result.code,
        message: result.error
      };
      return res.status(statusCode).json(errorResponse);
    }

    return res.status(HTTP_STATUS.CREATED).json(result);
  });

  router.post('/v1/games/:gameId/skip-waiting', (req, res) => {
    const { gameId } = req.params;
    const sessionToken = req.query.sessionToken as string | undefined;
    if (!sessionToken) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        code: GameManager.ERROR_CODES.MISSING_SESSION_TOKEN,
        message: GameManager.ERROR_MESSAGES.MISSING_SESSION_TOKEN
      });
    }

    const result = game.skipWaiting(gameId, sessionToken);
    if ('error' in result) {
      const statusCode = result.code === GameManager.ERROR_CODES.GAME_NOT_FOUND
        ? HTTP_STATUS.NOT_FOUND
        : result.code === GameManager.ERROR_CODES.INVALID_SESSION_TOKEN || result.code === GameManager.ERROR_CODES.NOT_CREATOR
          ? HTTP_STATUS.UNAUTHORIZED
          : HTTP_STATUS.BAD_REQUEST;
      return res.status(statusCode).json({ code: result.code, message: result.error });
    }
    return res.status(HTTP_STATUS.OK).json(result);
  });

  router.post('/v1/hot-seat/games', (req, res) => {
    const { firstName, secondName } = req.body;
    const result = game.createHotSeatGame(firstName, secondName);
    if ('error' in result) {
      const statusCode = result.code === GameManager.ERROR_CODES.MAX_GAMES_REACHED
        ? HTTP_STATUS.SERVICE_UNAVAILABLE
        : HTTP_STATUS.BAD_REQUEST;
      return res.status(statusCode).json({ code: result.code, message: result.error });
    }
    return res.status(HTTP_STATUS.CREATED).json(result);
  });

  // POST /api/v1/invitations/accept - Accept an invitation
  router.post('/v1/invitations/accept', (req, res) => {
    const { inviteCode, name } = req.body;
    const result = game.acceptInvitation(inviteCode, name);

    if ('error' in result) {
      const statusCode = result.code === GameManager.ERROR_CODES.INVITATION_EXPIRED ? HTTP_STATUS.GONE : HTTP_STATUS.BAD_REQUEST;
      const errorResponse: ErrorResponse = {
        code: result.code,
        message: result.error
      };
      return res.status(statusCode).json(errorResponse);
    }

    return res.status(HTTP_STATUS.OK).json(result);
  });

  // GET /api/v1/games/:gameId/status - Get game status (requires session token)
  router.get('/v1/games/:gameId/status', (req, res) => {
    const { gameId } = req.params;
    const sessionToken = req.query.sessionToken as string | undefined;

    if (!sessionToken) {
      const errorResponse: ErrorResponse = {
        code: GameManager.ERROR_CODES.MISSING_SESSION_TOKEN,
        message: GameManager.ERROR_MESSAGES.MISSING_SESSION_TOKEN
      };
      return res.status(HTTP_STATUS.UNAUTHORIZED).json(errorResponse);
    }

    const result = game.getGameStatus(gameId, sessionToken);

    if ('error' in result) {
      const statusCode = result.code === GameManager.ERROR_CODES.GAME_NOT_FOUND ? HTTP_STATUS.NOT_FOUND : HTTP_STATUS.UNAUTHORIZED;
      const errorResponse: ErrorResponse = {
        code: result.code,
        message: result.error
      };
      return res.status(statusCode).json(errorResponse);
    }

    return res.status(HTTP_STATUS.OK).json(result);
  });

  // POST /api/v1/games/:gameId/rematch - Request another round
  router.post('/v1/games/:gameId/rematch', (req, res) => {
    const { gameId } = req.params;
    const sessionToken = req.query.sessionToken as string | undefined;
    const answer = req.body?.answer;

    if (!sessionToken) {
      const errorResponse: ErrorResponse = {
        code: GameManager.ERROR_CODES.MISSING_SESSION_TOKEN,
        message: GameManager.ERROR_MESSAGES.MISSING_SESSION_TOKEN
      };
      return res.status(HTTP_STATUS.UNAUTHORIZED).json(errorResponse);
    }

    const result = game.requestRematch(gameId, sessionToken, answer);
    if ('error' in result) {
      const errorResponse: ErrorResponse = {
        code: result.code,
        message: result.error
      };
      return res.status(result.statusCode).json(errorResponse);
    }

    return res.status(HTTP_STATUS.OK).json({
      answer: result.answer,
      playersAnswered: result.playersAnswered,
      playersReady: result.playersReady,
      required: result.required,
      players: result.players,
      roundStarted: result.roundStarted
    });
  });

  // POST /api/v1/fire - Fire a projectile (updated for session tokens)
  router.post('/v1/fire', (req, res) => {
    const { gameId, angle, velocity, direction } = req.body;
    const sessionToken = req.query.sessionToken as string | undefined;

    // Validate required fields
    if (!gameId || !sessionToken || angle === undefined || velocity === undefined) {
      const errorResponse: ErrorResponse = {
        code: GameManager.ERROR_CODES.MISSING_FIELDS,
        message: GameManager.ERROR_MESSAGES.MISSING_FIELDS
      };
      return res.status(HTTP_STATUS.BAD_REQUEST).json(errorResponse);
    }

    // Validate types
    if (typeof gameId !== 'string' || typeof angle !== 'number' || typeof velocity !== 'number') {
      const errorResponse: ErrorResponse = {
        code: GameManager.ERROR_CODES.INVALID_FIELD_TYPES,
        message: GameManager.ERROR_MESSAGES.INVALID_FIELD_TYPES
      };
      return res.status(HTTP_STATUS.BAD_REQUEST).json(errorResponse);
    }

    // Call game manager to handle fire
    if (direction !== undefined && direction !== 'Left' && direction !== 'Right') {
      const errorResponse: ErrorResponse = {
        code: GameManager.ERROR_CODES.INVALID_FIELD_TYPES,
        message: 'direction must be Left or Right'
      };
      return res.status(HTTP_STATUS.BAD_REQUEST).json(errorResponse);
    }

    const result = game.fire(gameId, sessionToken, angle, velocity, direction);

    if ('error' in result) {
      const errorResponse: ErrorResponse = {
        code: result.code,
        message: result.error
      };
      return res.status(result.statusCode).json(errorResponse);
    }

    return res.status(HTTP_STATUS.OK).send();
  });

  return router;
}
