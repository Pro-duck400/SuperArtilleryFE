// REST API client for SuperArtillery private games

export interface CreateGameResponse {
  gameId: string;
  playerToken: string;
  inviteUrl: string;
  inviteCode: string;
  playerCount: number;
}

export interface LobbySlot {
  playerId: number;
  name?: string;
  status: 'waiting' | 'ready' | 'skipped';
}

export interface AcceptInvitationResponse {
  gameId: string;
  playerToken: string;
  playerId: number;
}

export interface CreateHotSeatResponse {
  gameId: string;
  players: [
    { playerId: 0; name: string; playerToken: string },
    { playerId: 1; name: string; playerToken: string }
  ];
}

export interface GameStatusResponse {
  status: 'pending' | 'active' | 'finished' | 'expired';
  playersConnected: number;
  required: number;
  ready: boolean;
  readyCount: number;
  slots: LobbySlot[];
  canSkipWaiting: boolean;
}

export interface SkipWaitingResponse {
  started: boolean;
  playersConnected: number;
  required: number;
  slots: LobbySlot[];
}

export interface RematchResponse {
  answer: 'play_again' | 'had_enough';
  playersAnswered: number;
  required: number;
  players: Array<{ playerId: number; name: string; answer?: 'play_again' | 'had_enough' }>;
  roundStarted: boolean;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  timestamp: string;
  uptime: string;
  games: number;
  inviteCount: number;
  maxReached: boolean;
  version: string;
  contractVersion: string;
}

export interface ErrorResponse {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export class ApiClient {
  private baseUrl: string;
  private readonly REQUEST_TIMEOUT_MS = 5000;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /**
   * Health check with retry logic
   * Retries with delays: 0, 1, 2, 5 seconds
   */
  public async healthCheckWithRetry(): Promise<HealthResponse> {
    const delays = [0, 1000, 2000, 5000];
    let lastError: Error | null = null;

    for (let i = 0; i < delays.length; i++) {
      if (i > 0) {
        await this.delay(delays[i]);
      }

      try {
        return await this.healthCheck();
      } catch (error) {
        lastError = error as Error;
        console.log(
          `Health check attempt ${i + 1}/${delays.length} failed: ${
            lastError.message
          }`
        );
      }
    }

    throw lastError || new Error('Health check failed after all retries');
  }

  /**
   * Single health check request
   */
  public async healthCheck(): Promise<HealthResponse> {
    const response = await this.fetchWithTimeout(`${this.baseUrl}/api/v1/health`, {
      method: 'GET'
    });

    if (!response.ok) {
      throw new Error('Server is not responding');
    }

    return response.json();
  }

  /**
   * Create a new private game
   */
  public async createGame(playerName: string, clientUrl: string, playerCount: number = 2): Promise<CreateGameResponse> {
    const response = await this.fetchWithTimeout(`${this.baseUrl}/api/v1/games`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name: playerName, clientUrl, playerCount })
    });

    if (!response.ok) {
      throw new Error(
        await this.extractErrorMessage(response, 'Failed to create game')
      );
    }

    return response.json();
  }

  public async createHotSeatGame(
    firstPlayerName: string,
    secondPlayerName: string
  ): Promise<CreateHotSeatResponse> {
    const response = await this.fetchWithTimeout(`${this.baseUrl}/api/v1/hot-seat/games`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: firstPlayerName, secondName: secondPlayerName })
    });

    if (!response.ok) {
      throw new Error(await this.extractErrorMessage(response, 'Failed to create hot-seat game'));
    }

    return response.json();
  }

  /**
   * Accept an invitation
   */
  public async acceptInvitation(
    inviteCode: string,
    playerName: string
  ): Promise<AcceptInvitationResponse> {
    const body = { inviteCode, name: playerName };

    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/api/v1/invitations/accept`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      }
    );

    if (!response.ok) {
      throw new Error(
        await this.extractErrorMessage(response, 'Failed to accept invitation')
      );
    }

    return response.json();
  }

  /**
   * Get game status
   */
  public async getGameStatus(
    gameId: string,
    sessionToken: string
  ): Promise<GameStatusResponse> {
    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/api/v1/games/${gameId}/status?sessionToken=${encodeURIComponent(
        sessionToken
      )}`,
      {
        method: 'GET'
      }
    );

    if (!response.ok) {
      throw new Error(
        await this.extractErrorMessage(response, 'Failed to get game status')
      );
    }

    return response.json();
  }

  public async skipWaiting(gameId: string, sessionToken: string): Promise<SkipWaitingResponse> {
    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/api/v1/games/${gameId}/skip-waiting?sessionToken=${encodeURIComponent(sessionToken)}`,
      { method: 'POST' }
    );
    if (!response.ok) {
      throw new Error(await this.extractErrorMessage(response, 'Unable to skip waiting players'));
    }
    return response.json();
  }

  /**
   * Fire a shot (updated for session tokens)
   */
  public async fire(
    gameId: string,
    sessionToken: string,
    angle: number,
    velocity: number,
    direction?: 'Left' | 'Right'
  ): Promise<void> {
    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/api/v1/fire?sessionToken=${encodeURIComponent(sessionToken)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ gameId, angle, velocity, ...(direction ? { direction } : {}) })
      }
    );

    if (!response.ok) {
      throw new Error(await this.extractErrorMessage(response, 'Fire action failed'));
    }
  }

  public async requestRematch(gameId: string, sessionToken: string, answer: 'play_again' | 'had_enough'): Promise<RematchResponse> {
    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/api/v1/games/${gameId}/rematch?sessionToken=${encodeURIComponent(sessionToken)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer })
      }
    );

    if (!response.ok) {
      throw new Error(await this.extractErrorMessage(response, 'Rematch request failed'));
    }

    return response.json();
  }

  /**
   * Fetch with timeout
   */
  private async fetchWithTimeout(
    url: string,
    options: RequestInit
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.REQUEST_TIMEOUT_MS);

    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Extract error message from response
   */
  private async extractErrorMessage(
    response: Response,
    fallback: string
  ): Promise<string> {
    try {
      const errorBody = (await response.json()) as {
        details?: string;
        message?: string;
      };
      if (typeof errorBody.message === 'string' && errorBody.message.trim() !== '') {
        return errorBody.message;
      }
      if (typeof errorBody.details === 'string' && errorBody.details.trim() !== '') {
        return errorBody.details;
      }
    } catch {
      // Ignore parse failures and fall back to status text/fallback
    }

    return response.statusText || fallback;
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }
}
