// Manages all DOM interactions and UI state
import type { ShotHistoryEntry } from './game';

export class UIManager {
  // DOM elements
  private registrationPanel: HTMLDivElement;
  private serverRow: HTMLDivElement;
  private lobbyModeRow: HTMLDivElement;
  private joinGameRow: HTMLDivElement;
  private createGameRow: HTMLDivElement;
  private internetGameRow: HTMLDivElement;
  private lobbyModeToggle: HTMLButtonElement;
  private createModeToggle: HTMLButtonElement;
  private lobbyModeOptions: HTMLSpanElement;
  private createModeOptions: HTMLSpanElement;
  private joinPlayerNameInput: HTMLInputElement;
  private joinGameButton: HTMLButtonElement;
  private gamePanel: HTMLDivElement;
  private windLabel: HTMLDivElement;
  private playerNameInput: HTMLInputElement;
  private serverAddressInput: HTMLInputElement;
  private serverAddressToggle: HTMLButtonElement;
  private serverAddressOptions: HTMLSpanElement;
  private serverHealthButton: HTMLAnchorElement;
  private serverHealthStatus: HTMLDivElement;
  private serverHealthMessage: HTMLSpanElement;
  private actionButton: HTMLButtonElement;
  private hotSeatPanel: HTMLDivElement | null;
  private startHotSeatButton: HTMLButtonElement | null;
  private hotSeatPlayerOneInput: HTMLInputElement | null;
  private hotSeatPlayerTwoInput: HTMLInputElement | null;
  private inviteInput: HTMLInputElement;
  private inviteInputLabel: HTMLLabelElement;
  private registrationError: HTMLDivElement;
  private inviteInfoEl: HTMLDivElement;
  private inviteCodeTextEl: HTMLSpanElement;
  private inviteUrlTextEl: HTMLSpanElement;
  private copyInviteCodeButton: HTMLButtonElement;
  private copyInviteUrlButton: HTMLButtonElement;
  private messageEl: HTMLDivElement;
  private shotHistoryRowsEl: HTMLTableSectionElement;
  private angleInput: HTMLInputElement;
  private velocityInput: HTMLInputElement;
  private fireButton: HTMLButtonElement;
  private rematchButton: HTMLButtonElement;
  private defaultServerAddress: string;
  private creatingGame = false;
  private lobbyMode: 'create' | 'join' = 'create';
  private createMode: 'internet' | 'device' = 'internet';
  private joinOnlyMode = false;
  private serverHealthCheckId = 0;

  // Event callbacks
  private onCreateGameCallback: ((name: string, serverAddress: string) => void) | null = null;
  private onJoinGameCallback: ((inviteCode: string, name: string, serverAddress: string) => void) | null = null;
  private onHotSeatCallback: ((firstName: string, secondName: string, serverAddress: string) => void) | null = null;
  private onFireCallback: ((angle: number, velocity: number) => void) | null = null;
  private onRematchCallback: (() => void) | null = null;

  constructor(defaultServerAddress: string) {
    this.defaultServerAddress = defaultServerAddress;
    // Get DOM elements
    this.registrationPanel = document.getElementById('registrationPanel') as HTMLDivElement;
    this.serverRow = document.getElementById('serverRow') as HTMLDivElement;
    this.lobbyModeRow = document.getElementById('lobbyModeRow') as HTMLDivElement;
    this.joinGameRow = document.getElementById('joinGameRow') as HTMLDivElement;
    this.createGameRow = document.getElementById('createGameRow') as HTMLDivElement;
    this.internetGameRow = document.getElementById('internetGameRow') as HTMLDivElement;
    this.lobbyModeToggle = document.getElementById('lobbyModeToggle') as HTMLButtonElement;
    this.createModeToggle = document.getElementById('createModeToggle') as HTMLButtonElement;
    this.lobbyModeOptions = document.getElementById('lobbyModeOptions') as HTMLSpanElement;
    this.createModeOptions = document.getElementById('createModeOptions') as HTMLSpanElement;
    this.joinPlayerNameInput = document.getElementById('joinPlayerNameInput') as HTMLInputElement;
    this.joinGameButton = document.getElementById('joinGameButton') as HTMLButtonElement;
    this.gamePanel = document.getElementById('gamePanel') as HTMLDivElement;
    this.windLabel = document.getElementById('windLabel') as HTMLDivElement;
    this.playerNameInput = document.getElementById('playerNameInput') as HTMLInputElement;
    this.serverAddressInput = document.getElementById('serverAddressInput') as HTMLInputElement;
    this.serverAddressToggle = document.getElementById('serverAddressToggle') as HTMLButtonElement;
    this.serverAddressOptions = document.getElementById('serverAddressOptions') as HTMLSpanElement;
    this.serverHealthButton = document.getElementById('serverHealthButton') as HTMLAnchorElement;
    this.serverHealthStatus = document.getElementById('serverHealthStatus') as HTMLDivElement;
    this.serverHealthMessage = document.getElementById('serverHealthMessage') as HTMLSpanElement;
    this.actionButton = document.getElementById('actionButton') as HTMLButtonElement;
    this.hotSeatPanel = document.getElementById('hotSeatPanel') as HTMLDivElement | null;
    this.startHotSeatButton = document.getElementById('startHotSeatButton') as HTMLButtonElement | null;
    this.hotSeatPlayerOneInput = document.getElementById('hotSeatPlayerOneInput') as HTMLInputElement | null;
    this.hotSeatPlayerTwoInput = document.getElementById('hotSeatPlayerTwoInput') as HTMLInputElement | null;
    this.inviteInput = document.getElementById('inviteInput') as HTMLInputElement;
    this.inviteInputLabel = document.getElementById('inviteInputLabel') as HTMLLabelElement;
    this.registrationError = document.getElementById('registrationError') as HTMLDivElement;
    this.inviteInfoEl = document.getElementById('inviteInfo') as HTMLDivElement;
    this.inviteCodeTextEl = document.getElementById('inviteCodeText') as HTMLSpanElement;
    this.inviteUrlTextEl = document.getElementById('inviteUrlText') as HTMLSpanElement;
    this.copyInviteCodeButton = document.getElementById('copyInviteCodeButton') as HTMLButtonElement;
    this.copyInviteUrlButton = document.getElementById('copyInviteUrlButton') as HTMLButtonElement;
    this.messageEl = document.getElementById('message') as HTMLDivElement;
    this.shotHistoryRowsEl = document.getElementById('shotHistoryRows') as HTMLTableSectionElement;
    this.angleInput = document.getElementById('angleInput') as HTMLInputElement;
    this.velocityInput = document.getElementById('velocityInput') as HTMLInputElement;
    this.fireButton = document.getElementById('fireButton') as HTMLButtonElement;
    this.rematchButton = document.getElementById('rematchButton') as HTMLButtonElement;
    this.serverAddressInput.value = defaultServerAddress;
    this.updateLobbyVisibility();

    this.playerNameInput.maxLength = 15;
    this.joinPlayerNameInput.maxLength = 15;
    this.playerNameInput.addEventListener('input', () => {
      if (this.playerNameInput.value.length > 15) {
        this.playerNameInput.value = this.playerNameInput.value.slice(0, 15);
      }
    });

    this.angleInput.addEventListener('input', () => {
      this.angleInput.value = this.angleInput.value.slice(0, 2);
    });

    this.velocityInput.addEventListener('input', () => {
      this.velocityInput.value = this.velocityInput.value.slice(0, 3);
    });

    this.setupEventListeners();
    void this.checkServerHealth(defaultServerAddress);
    this.playerNameInput.focus();
  }

  /**
   * Set up DOM event listeners
   */
  private setupEventListeners(): void {
    const setListboxOpen = (toggle: HTMLButtonElement, options: HTMLSpanElement, open: boolean): void => {
      options.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
    };

    this.lobbyModeToggle.addEventListener('click', () => {
      setListboxOpen(this.lobbyModeToggle, this.lobbyModeOptions, this.lobbyModeOptions.hidden === true);
    });
    this.createModeToggle.addEventListener('click', () => {
      setListboxOpen(this.createModeToggle, this.createModeOptions, this.createModeOptions.hidden === true);
    });

    this.lobbyModeOptions.querySelectorAll<HTMLButtonElement>('[role="option"]').forEach((option) => {
      option.addEventListener('click', () => {
        this.lobbyMode = option.dataset.mode?.toLowerCase() === 'join' ? 'join' : 'create';
        this.lobbyModeToggle.textContent = this.lobbyMode === 'join' ? 'Join' : 'Create';
        setListboxOpen(this.lobbyModeToggle, this.lobbyModeOptions, false);
        this.updateLobbyVisibility();
      });
    });

    this.createModeOptions.querySelectorAll<HTMLButtonElement>('[role="option"]').forEach((option) => {
      option.addEventListener('click', () => {
        this.createMode = option.dataset.mode === 'device' ? 'device' : 'internet';
        this.createModeToggle.textContent = this.createMode === 'device' ? 'on this device' : 'over Internet';
        setListboxOpen(this.createModeToggle, this.createModeOptions, false);
        this.updateLobbyVisibility();
      });
    });

    const setOptionsExpanded = (expanded: boolean): void => {
      this.serverAddressOptions.hidden = !expanded;
      this.serverAddressToggle.setAttribute('aria-expanded', String(expanded));
      this.serverAddressInput.setAttribute('aria-expanded', String(expanded));
    };

    this.serverAddressToggle.addEventListener('click', () => {
      setOptionsExpanded(this.serverAddressOptions.hidden === true);
    });

    this.serverAddressOptions.querySelectorAll<HTMLButtonElement>('[role="option"]').forEach((option) => {
      option.addEventListener('click', () => {
        const serverAddress = option.dataset.serverAddress || '';
        this.serverAddressInput.value = serverAddress;
        setOptionsExpanded(false);
        void this.checkServerHealth(serverAddress);
      });
    });

    this.serverHealthButton.addEventListener('click', (event) => {
      event.preventDefault();
      const serverAddress = this.serverAddressInput.value.trim() || this.defaultServerAddress;
      void this.checkServerHealth(serverAddress);
    });

    const submitCreate = (): void => {
      const playerName = this.playerNameInput.value.trim();
      const serverAddress = this.serverAddressInput.value.trim() || this.defaultServerAddress;
      if (!this.validateName(playerName) || !this.validateServer(serverAddress)) return;
      this.registrationError.textContent = '';
      this.onCreateGameCallback?.(playerName, serverAddress);
    };

    const submitJoin = (): void => {
      const playerName = this.joinPlayerNameInput.value.trim();
      const inviteCode = this.inviteInput.value.trim();
      const serverAddress = this.serverAddressInput.value.trim() || this.defaultServerAddress;
      if (!this.validateName(playerName) || !this.validateServer(serverAddress)) return;
      if (!/^[A-Za-z0-9]{4}$/.test(inviteCode)) {
        this.registrationError.textContent = 'Enter a 4-character invite code';
        return;
      }
      this.registrationError.textContent = '';
      this.onJoinGameCallback?.(inviteCode, playerName, serverAddress);
    };

    this.actionButton.addEventListener('click', submitCreate);
    this.joinGameButton.addEventListener('click', submitJoin);

    [this.playerNameInput, this.joinPlayerNameInput, this.inviteInput].forEach((input) => {
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          (this.lobbyMode === 'join' ? this.joinGameButton : this.actionButton).click();
        }
      });
    });

    // Fire button
    this.fireButton.addEventListener('click', () => {
      const angle = Number(this.angleInput.value);
      const velocity = Number(this.velocityInput.value);

      if (!Number.isInteger(angle) || !Number.isInteger(velocity)) {
        this.messageEl.textContent = 'Invalid input';
        return;
      }

      if (angle < 0 || angle > 99) {
        this.messageEl.textContent = 'Angle must be between 0 and 99';
        return;
      }

      if (velocity < 30 || velocity > 999) {
        this.messageEl.textContent = 'Velocity must be between 30 and 999';
        return;
      }

      if (this.onFireCallback) {
        this.onFireCallback(angle, velocity);
      }
    });

    this.rematchButton.addEventListener('click', () => {
      this.onRematchCallback?.();
    });

    this.startHotSeatButton?.addEventListener('click', () => {
      const firstName = this.hotSeatPlayerOneInput?.value.trim() ?? '';
      const secondName = this.hotSeatPlayerTwoInput?.value.trim() ?? '';
      const serverAddress = this.serverAddressInput.value.trim() || this.defaultServerAddress;
      if (!this.validateName(firstName) || !this.validateName(secondName) || !this.validateServer(serverAddress)) return;
      this.registrationError.textContent = '';
      this.onHotSeatCallback?.(firstName, secondName, serverAddress);
    });

    this.velocityInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.fireButton.click();
      }
    });
  }

  // changed playerId parameter from 0 | 1 to string as it causes an error in main when called
  public setPlayerNames(
    playerId: number,
    playerName: string,
    opponentName: string,
    positions?: { left: { x: number; y: number }; right: { x: number; y: number } }
  ): void {
    const leftNameEl = document.getElementById('playerNameLeft');
    const rightNameEl = document.getElementById('playerNameRight');

    if (positions) {
      this.positionPlayerName(leftNameEl, positions.left);
      this.positionPlayerName(rightNameEl, positions.right);
    }

    if (playerId === 0) {
        if (leftNameEl) {
            leftNameEl.textContent = playerName;
            leftNameEl.classList.add('player-name-connected');
        }
        if (rightNameEl) {
            rightNameEl.textContent = opponentName;
            rightNameEl.classList.add('player-name-connected');
        }
    } else {
        if (leftNameEl) {
            leftNameEl.textContent = opponentName;
            leftNameEl.classList.add('player-name-connected');
        }
        if (rightNameEl) {
            rightNameEl.textContent = playerName;
            rightNameEl.classList.add('player-name-connected');
        }
    }
  }

  private positionPlayerName(element: HTMLElement | null, position: { x: number; y: number }): void {
    if (!element) return;
    element.style.left = `${position.x}px`;
    element.style.top = `${position.y}px`;
  }


  /**
   * Register callback for creating a new private game
   */
  public onCreateGame(callback: (name: string, serverAddress: string) => void): void {
    this.onCreateGameCallback = callback;
  }

  /**
   * Register callback for joining an existing game via invite token or code
   */
  public onJoinGame(callback: (inviteCode: string, name: string, serverAddress: string) => void): void {
    this.onJoinGameCallback = callback;
  }

  public onHotSeat(callback: (firstName: string, secondName: string, serverAddress: string) => void): void {
    this.onHotSeatCallback = callback;
  }

  /**
   * Register callback for fire event
   */
  public onFire(callback: (angle: number, velocity: number) => void): void {
    this.onFireCallback = callback;
  }

  public onRematch(callback: () => void): void {
    this.onRematchCallback = callback;
  }

  /**
   * Show registration in progress
   */
  public showRegistering(): void {
    this.creatingGame = this.lobbyMode === 'create';
    this.actionButton.disabled = this.creatingGame && this.createMode === 'internet';
    this.joinGameButton.disabled = !this.creatingGame;
    if (this.hotSeatPanel) {
      const startingHotSeat = this.creatingGame && this.createMode === 'device';
      const button = this.startHotSeatButton;
      if (button) button.disabled = startingHotSeat;
      if (startingHotSeat) button!.textContent = 'Starting...';
    }
    if (this.creatingGame && this.createMode === 'internet') this.actionButton.textContent = 'Creating...';
    if (this.lobbyMode === 'join') this.joinGameButton.textContent = 'Joining...';
  }

  /**
   * Show registration error
   */
  public showRegistrationError(error: string): void {
    this.registrationError.textContent = error;
    this.creatingGame = false;
    this.actionButton.disabled = false;
    this.actionButton.textContent = 'Create Game';
    this.joinGameButton.disabled = false;
    this.joinGameButton.textContent = 'Join the game';
    if (this.startHotSeatButton) {
      this.startHotSeatButton.disabled = false;
      this.startHotSeatButton.textContent = 'Start Hot Seat';
    }
    this.updateLobbyVisibility();
  }

  public showInviteInfo(code: string, inviteUrl: string): void {
    this.inviteInfoEl.style.display = 'block';
    this.inviteCodeTextEl.textContent = code;
    this.inviteUrlTextEl.textContent = inviteUrl;

    this.wireCopyButton(this.copyInviteCodeButton, code);
    this.wireCopyButton(this.copyInviteUrlButton, inviteUrl);
  }

  public hideInviteInfo(): void {
    this.inviteInfoEl.style.display = 'none';
    this.inviteCodeTextEl.textContent = '';
    this.inviteUrlTextEl.textContent = '';
    this.copyInviteCodeButton.onclick = null;
    this.copyInviteUrlButton.onclick = null;
  }

  public setServerAddress(serverAddress: string): void {
    this.serverAddressInput.value = serverAddress;
  }

  /**
   * Wire a button to copy the given text to the clipboard, with brief "Copied!" feedback.
   */
  private wireCopyButton(button: HTMLButtonElement, textToCopy: string): void {
    const defaultLabel = '📋 Copy';
    button.textContent = defaultLabel;
    button.onclick = () => {
      navigator.clipboard
        .writeText(textToCopy)
        .then(() => {
          button.textContent = '✅ Copied!';
          setTimeout(() => {
            button.textContent = defaultLabel;
          }, 1500);
        })
        .catch(() => {
          button.textContent = 'Copy failed';
        });
    };
  }

  /**
   * Configure the lobby for a player arriving via an invite link/code: only the
   * name field and Join button are relevant, so hide Create Game and the
   * invite code/link input (pre-filled internally) to avoid confusing the user.
   */
  public enterJoinOnlyMode(inviteCode: string): void {
    this.joinOnlyMode = true;
    this.lobbyMode = 'join';
    this.inviteInput.value = inviteCode;
    this.serverRow.hidden = true;
    this.lobbyModeRow.hidden = true;
    this.createGameRow.hidden = true;
    this.internetGameRow.hidden = true;
    if (this.hotSeatPanel) this.hotSeatPanel.hidden = true;
    this.serverAddressInput.disabled = true;
    this.serverAddressToggle.disabled = true;
    this.inviteInputLabel.style.display = 'none';
    this.joinGameRow.hidden = false;
    this.joinPlayerNameInput.focus();
  }

  private validateName(name: string): boolean {
    if (!name) {
      this.registrationError.textContent = 'Please enter your name';
      return false;
    }
    if (name.length < 2) {
      this.registrationError.textContent = 'Name must be at least 2 characters';
      return false;
    }
    if (name.length > 15) {
      this.registrationError.textContent = 'Name must be 15 characters or less';
      return false;
    }
    return true;
  }

  private validateServer(serverAddress: string): boolean {
    try {
      const parsedUrl = new URL(serverAddress);
      if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') return true;
    } catch {
      // Fall through to the shared validation message.
    }
    this.registrationError.textContent = 'Please enter a valid server address, e.g. http://localhost:3000';
    return false;
  }

  private async checkServerHealth(serverAddress: string): Promise<void> {
    const checkId = ++this.serverHealthCheckId;
    this.serverHealthStatus.classList.remove('error');
    this.serverHealthMessage.textContent = 'Checking server...';
    const startedAt = performance.now();

    try {
      const response = await fetch(`${serverAddress.replace(/\/$/, '')}/api/v1/health`);
      const duration = Math.round(performance.now() - startedAt);
      if (checkId !== this.serverHealthCheckId) return;
      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}`);
      }
      const health = await response.json() as { version?: string; contractVersion?: string };
      this.serverHealthStatus.classList.remove('error');
      this.serverHealthMessage.textContent = `Server v${health.version ?? 'unknown'} | Contract v${health.contractVersion ?? 'unknown'} | Response time: ${duration}ms`;
    } catch (error) {
      if (checkId !== this.serverHealthCheckId) return;
      this.serverHealthStatus.classList.add('error');
      this.serverHealthMessage.textContent = error instanceof Error ? error.message : 'Unable to reach server';
    }
  }

  private updateLobbyVisibility(): void {
    if (this.joinOnlyMode) return;
    const joining = this.lobbyMode === 'join';
    this.joinGameRow.hidden = !joining;
    this.createGameRow.hidden = joining;
    this.internetGameRow.hidden = joining || this.createMode !== 'internet';
    if (this.hotSeatPanel) this.hotSeatPanel.hidden = joining || this.createMode !== 'device';
    this.lobbyModeOptions.querySelectorAll<HTMLElement>('[role="option"]').forEach((option) => {
      option.setAttribute('aria-selected', String(option.dataset.mode === this.lobbyMode));
    });
    this.createModeOptions.querySelectorAll<HTMLElement>('[role="option"]').forEach((option) => {
      option.setAttribute('aria-selected', String(option.dataset.mode === this.createMode));
    });
  }

  /**
   * Switch from registration to game panel
   */
  public showGamePanel(): void {
    this.registrationPanel.style.display = 'none';
    this.gamePanel.style.display = 'block';
  }

  /**
   * Update message text
   */
  public setMessage(text: string): void {
    this.messageEl.textContent = text;
  }

  public setWindLabel(wind: number): void {
    this.windLabel.textContent = `wind: ${Math.ceil(wind)}`;
  }

  public renderShotHistory(history: ShotHistoryEntry[]): void {
    this.shotHistoryRowsEl.replaceChildren();

    const angleRow = document.createElement('tr');
    const velocityRow = document.createElement('tr');
    const angleLabel = document.createElement('th');
    const velocityLabel = document.createElement('th');

    angleLabel.scope = 'row';
    angleLabel.textContent = 'Angle';
    velocityLabel.scope = 'row';
    velocityLabel.textContent = 'Velocity';
    angleRow.appendChild(angleLabel);
    velocityRow.appendChild(velocityLabel);

    for (let index = 0; index < 4; index += 1) {
      const shot = history[index];
      const angleCell = document.createElement('td');
      const velocityCell = document.createElement('td');
      const angleText = shot ? `${shot.angle}°` : '—';
      const velocityText = shot ? String(shot.velocity) : '—';

      angleCell.textContent = angleText;
      velocityCell.textContent = velocityText;
      angleCell.setAttribute('aria-label', `Angle ${angleText}`);
      velocityCell.setAttribute('aria-label', `Velocity ${velocityText}`);
      angleRow.appendChild(angleCell);
      velocityRow.appendChild(velocityCell);
    }

    this.shotHistoryRowsEl.append(angleRow, velocityRow);
  }

  /**
   * Update UI based on turn state and highlight current player's name
   * @param isMyTurn Whether it's this client's turn
   */
  public updateTurnUI(currentTurn: 0 | 1, isMyTurn: boolean): void {
    this.fireButton.disabled = !isMyTurn;
    if (isMyTurn) {
      this.angleInput.disabled = false;
      this.velocityInput.disabled = false;
    } else {
      this.angleInput.disabled = true;
      this.velocityInput.disabled = true;
    }

    // Highlight only the player whose turn it is
      const leftNameEl = document.getElementById('playerNameLeft');
      const rightNameEl = document.getElementById('playerNameRight');

      // Remove the active class from both
      leftNameEl?.classList.remove('player-name-active-turn');
      rightNameEl?.classList.remove('player-name-active-turn');

      // Add the active class to the current player's name
      if (currentTurn === 0) {
        leftNameEl?.classList.add('player-name-active-turn');
      } else {
        rightNameEl?.classList.add('player-name-active-turn');
      }

      if (isMyTurn) {
        this.angleInput.focus();
      }
  }

  public setShotInputs(shot: ShotHistoryEntry | undefined): void {
    this.angleInput.value = String(shot?.angle ?? 45);
    this.velocityInput.value = String(shot?.velocity ?? 150);
  }

  /**
   * Disable fire button (e.g., while firing or game over)
   */
  public disableFireButton(): void {
    this.fireButton.disabled = true;
  }

  private setGameOverControlsVisible(visible: boolean): void {
    const controls = document.getElementById('controls') as HTMLDivElement | null;
    if (!controls) return;

    const angleField = this.angleInput.closest('label');
    const velocityField = this.velocityInput.closest('label');

    if (angleField) angleField.style.display = visible ? 'none' : '';
    if (velocityField) velocityField.style.display = visible ? 'none' : '';
    this.fireButton.style.display = visible ? 'none' : '';
    this.rematchButton.style.display = visible ? 'inline-block' : 'none';
    this.rematchButton.disabled = !visible;
    if (visible) {
      this.rematchButton.textContent = 'Play again';
    }
  }

  /**
   * Show game over message
   */
  public showGameOver(won: boolean, playerName: string, opponentName: string): void {
    this.messageEl.textContent = won
      ? `🎉 ${playerName} won! ${opponentName} lost.`
      : `😔 ${playerName} lost. ${opponentName} won!`;
    this.fireButton.disabled = true;
    this.setGameOverControlsVisible(true);
    this.rematchButton.disabled = false;
    this.rematchButton.textContent = 'Play again';
  }

  public setRematchWaiting(playersReady: number): void {
    this.rematchButton.style.display = 'inline-block';
    this.rematchButton.disabled = true;
    this.rematchButton.textContent = `Waiting (${playersReady}/2)`;
  }

  public showRematchAvailable(): void {
    this.rematchButton.style.display = 'inline-block';
    this.rematchButton.disabled = false;
    this.rematchButton.textContent = 'Play again';
  }

  public prepareForNewRound(): void {
    this.setGameOverControlsVisible(false);
    this.rematchButton.style.display = 'none';
    this.rematchButton.disabled = true;
  }
}
