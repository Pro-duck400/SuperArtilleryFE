import { WebSocketServer, WebSocket } from 'ws';
import * as dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { createServer } from 'http';
import { readFileSync } from 'fs';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import { GameManager } from './services/gameManager';
import { createApiRouter } from './routes/api';
import { CONTRACT_VERSION } from './contract-version';

// Load environment variables
dotenv.config();

const PORT = parseInt(process.env.PORT || '3000', 10);

// Game manager instance (supports multiple concurrent games)
const game = new GameManager();

// Create Express app for HTTP endpoints
const app = express();

// Load canonical OpenAPI contract from repository-level contracts folder.
const openapiSpecPath = path.resolve(__dirname, '../../contracts/openapi/superartillery.yaml');
const openapiSpecRaw = readFileSync(openapiSpecPath, 'utf8');
const swaggerSpec = parseYaml(openapiSpecRaw);
app.use('/api/swagger', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Enable CORS for all routes
app.use(cors());

// Middleware to parse JSON bodies
app.use(express.json());

// Mount API routes
app.use('/api', createApiRouter(game));

// Create HTTP server
const httpServer = createServer(app);

// Create WebSocket server attached to HTTP server
const wss = new WebSocketServer({ server: httpServer });

// Map to track connection metadata: gameId and playerId for each WebSocket
const connectionMetadata = new WeakMap<WebSocket, { gameId: string; playerId: number }>();

function logWebSocketMessage(direction: 'sent' | 'received', message: unknown, playerName: string, gameId?: string): void {
  const payload = typeof message === 'string' ? message : JSON.stringify(message);
  console.log(`📡 WebSocket ${direction} player=${playerName} game=${gameId ?? 'unknown'} payload=${payload}`);
}

// Start HTTP server
httpServer.listen(PORT, () => {
  console.log(`🚀 SuperArtillery server running on port ${PORT}`);
  console.log(`   HTTP API: http://localhost:${PORT}/api/swagger`);
  console.log(`   WebSocket: wss://localhost:${PORT}`);
});

wss.on('connection', (ws: WebSocket, req) => {
  console.log('📡 New WebSocket connection attempt...');

  // Extract gameId and sessionToken from query string
  // Pattern: wss://server/?gameId=XXX&sessionToken=YYY
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const gameId = url.searchParams.get('gameId');
  const sessionToken = url.searchParams.get('sessionToken');
  const contractVersion = url.searchParams.get('contractVersion');

  if (contractVersion !== CONTRACT_VERSION) {
    const errorMsg = JSON.stringify({
      type: 'error',
      code: 'CONTRACT_VERSION_MISMATCH',
      message: `Client contract version ${contractVersion || 'missing'} is not supported. Server requires ${CONTRACT_VERSION}.`,
      details: {
        expected: CONTRACT_VERSION,
        received: contractVersion
      }
    });
    logWebSocketMessage('sent', errorMsg, 'unknown', gameId ?? undefined);
    ws.send(errorMsg);
    ws.close(1008, 'Contract version mismatch');
    return;
  }

  if (!gameId || !sessionToken) {
    console.log('❌ Connection rejected: missing gameId or sessionToken');
    const errorMsg = JSON.stringify({
      type: 'error',
      code: 'MISSING_AUTH',
      message: 'gameId and sessionToken are required'
    });
    logWebSocketMessage('sent', errorMsg, 'unknown', gameId ?? undefined);
    ws.send(errorMsg);
    ws.close(1008, 'Missing authentication parameters');
    return;
  }

  // Authenticate and connect player via session token
  const result = game.connectPlayer(gameId, sessionToken, ws);

  if ('error' in result) {
    console.log(`❌ Connection rejected: ${result.error}`);
    const errorMsg = JSON.stringify({
      type: 'error',
      code: result.code,
      message: result.error
    });
    logWebSocketMessage('sent', errorMsg, 'unknown', gameId);
    ws.send(errorMsg);
    ws.close(1008, 'Authentication failed');
    return;
  }

  const playerId = result.playerId;
  const playerName = game.getPlayerName(gameId, playerId) ?? `Player ${playerId + 1}`;
  
  // Store connection metadata
  connectionMetadata.set(ws, { gameId, playerId });

  console.log(`✅ Player ${playerId} (${playerName}) connected to game ${gameId}`);

  // Note: Clients don't send WebSocket messages - they use HTTP endpoints instead
  // WebSocket is used only for server -> client broadcasts (game_start, shot, turn_change, game_over)

  // Handle disconnection
  ws.on('close', () => {
    const metadata = connectionMetadata.get(ws);
    if (metadata) {
      console.log(
        `❌ Player ${metadata.playerId} (${game.getPlayerName(metadata.gameId, metadata.playerId) ?? `Player ${metadata.playerId + 1}`}) disconnected from game ${metadata.gameId}`
      );
      game.disconnectPlayer(metadata.gameId, metadata.playerId, ws);
    }
  });

  ws.on('message', (rawMessage) => {
    const metadata = connectionMetadata.get(ws);
    const playerName = metadata ? game.getPlayerName(metadata.gameId, metadata.playerId) ?? `Player ${metadata.playerId + 1}` : 'unknown';
    logWebSocketMessage('received', rawMessage.toString(), playerName, metadata?.gameId);
  });

  // Handle errors
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Handle server errors
wss.on('error', (error) => {
  console.error('WebSocket server error:', error);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down server...');
  game.shutdown();
  httpServer.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down server...');
  game.shutdown();
  httpServer.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
