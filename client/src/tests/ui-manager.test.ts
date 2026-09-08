import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UIManager } from '../ts/ui-manager';

describe('UIManager private game flow', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="app">
        <div id="registrationPanel" style="display: block;">
          <div id="serverRow"><label id="serverAddressLabel"><span class="server-address-combobox">
            <input id="serverAddressInput" value="" role="combobox" aria-controls="serverAddressOptions" aria-expanded="false" />
            <button type="button" id="serverAddressToggle" aria-label="Show server address options" aria-expanded="false">&#9662;</button>
            <span id="serverAddressOptions" role="listbox" hidden>
              <button type="button" role="option" data-server-address="https://superartillery-server-production.up.railway.app">https://superartillery-server-production.up.railway.app</button>
              <button type="button" role="option" data-server-address="http://localhost:3000">http://localhost:3000</button>
            </span>
          </span><div id="serverHealthStatus" role="status"><span id="serverHealthMessage"></span><a href="#" id="serverHealthButton" role="button">🔄</a></div></label></div>
          <div id="lobbyModeRow"><span class="lobby-select"><button id="lobbyModeToggle">Create</button><span id="lobbyModeOptions" role="listbox" hidden><button role="option" data-mode="create"></button><button role="option" data-mode="join"></button></span></span></div>
          <div id="joinGameRow" hidden><label><input id="joinPlayerNameInput" /></label><label id="inviteInputLabel"><input id="inviteInput" value="" /></label><button id="joinGameButton">Join the game</button></div>
          <div id="createGameRow"><div><button id="createModeToggle">over Internet</button><span id="createModeOptions" role="listbox" hidden><button role="option" data-mode="internet"></button><button role="option" data-mode="device"></button></span></div></div>
          <div id="internetGameRow"><input id="playerNameInput" value="" maxlength="15" /><button id="actionButton">Create Game</button></div>
          <div id="hotSeatPanel" hidden><input id="hotSeatPlayerOneInput" /><input id="hotSeatPlayerTwoInput" /><button id="startHotSeatButton">Start Hot Seat</button></div>
          <div id="registrationError"></div>
          <div id="inviteInfo">
            <span id="inviteCodeText"></span>
            <button id="copyInviteCodeButton"></button>
            <span id="inviteUrlText"></span>
            <button id="copyInviteUrlButton"></button>
          </div>
        </div>
        <div id="gamePanel" style="display: none;">
          <div id="battlefieldFrame">
            <div id="windLabel"></div>
            <canvas id="gameCanvas" width="420" height="240"></canvas>
            <div id="playerNameLeft"></div>
            <div id="playerNameRight"></div>
          </div>
          <div id="controls">
            <input id="angleInput" value="45" />
            <input id="velocityInput" value="150" />
            <button id="fireButton" disabled>Fire!</button>
          </div>
          <section id="shotHistory">
            <h2 id="shotHistoryTitle">Your last four shots</h2>
            <table><tbody id="shotHistoryRows"></tbody></table>
          </section>
          <div id="message"></div>
          <button id="rematchButton" type="button" style="display: none;">Play again</button>
        </div>
      </div>
    `;
  });

  it('provides editable server address choices', () => {
    new UIManager('https://superartillery-server-production.up.railway.app');
    const serverInput = document.getElementById('serverAddressInput') as HTMLInputElement;
    const toggle = document.getElementById('serverAddressToggle') as HTMLButtonElement;
    const options = document.querySelectorAll<HTMLButtonElement>('#serverAddressOptions [role="option"]');

    expect(serverInput.value).toBe('https://superartillery-server-production.up.railway.app');
    toggle.click();
    expect(document.getElementById('serverAddressOptions')?.hidden).toBe(false);
    expect(Array.from(options).map((option) => option.dataset.serverAddress)).toEqual([
      'https://superartillery-server-production.up.railway.app',
      'http://localhost:3000'
    ]);

    options[1].click();
    expect(serverInput.value).toBe('http://localhost:3000');
  });

  it('shows server health details after selecting a server', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.2.0', contractVersion: '1.2.0' })
    });
    vi.stubGlobal('fetch', fetchSpy);
    new UIManager('http://localhost:3000');

    const option = document.querySelector<HTMLButtonElement>('#serverAddressOptions [role="option"]') as HTMLButtonElement;
    option.click();
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('https://superartillery-server-production.up.railway.app/api/v1/health'));
    await vi.waitFor(() => expect(document.getElementById('serverHealthMessage')?.textContent).toMatch(
      /^Server v1\.2\.0 \| Contract v1\.2\.0 \| Response time: \d+ms$/
    ));
    vi.unstubAllGlobals();
  });

  it('checks the preselected server automatically', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.2.0', contractVersion: '1.2.0' })
    });
    vi.stubGlobal('fetch', fetchSpy);
    new UIManager('http://localhost:3000');

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('http://localhost:3000/api/v1/health'));
    await vi.waitFor(() => expect(document.getElementById('serverHealthMessage')?.textContent).toMatch(
      /^Server v1\.2\.0 \| Contract v1\.2\.0 \| Response time: \d+ms$/
    ));
    vi.unstubAllGlobals();
  });

  it('checks the current server when the refresh button is pressed', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.2.0', contractVersion: '1.2.0' })
    });
    vi.stubGlobal('fetch', fetchSpy);
    new UIManager('http://localhost:3000');

    const serverInput = document.getElementById('serverAddressInput') as HTMLInputElement;
    serverInput.value = 'https://custom.example.com';
    (document.getElementById('serverHealthButton') as HTMLAnchorElement).click();

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('https://custom.example.com/api/v1/health'));
    vi.unstubAllGlobals();
  });

  it('shows a red error when the selected server health check fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch')));
    new UIManager('http://localhost:3000');

    const option = document.querySelector<HTMLButtonElement>('#serverAddressOptions [role="option"]') as HTMLButtonElement;
    option.click();
    await vi.waitFor(() => expect(document.getElementById('serverHealthMessage')?.textContent).toBe('Failed to fetch'));

    expect(document.getElementById('serverHealthStatus')?.classList.contains('error')).toBe(true);
    vi.unstubAllGlobals();
  });

  it('shows Create and over Internet as the collapsed default selections', () => {
    new UIManager('http://localhost:3000');

    expect(document.getElementById('lobbyModeToggle')?.textContent).toBe('Create');
    expect(document.getElementById('createModeToggle')?.textContent).toBe('over Internet');
    expect(document.getElementById('lobbyModeOptions')?.hidden).toBe(true);
    expect(document.getElementById('createModeOptions')?.hidden).toBe(true);
  });

  it('allows creating a private game from the lobby', () => {
    const ui = new UIManager('http://localhost:3000');
    const createSpy = vi.fn();
    ui.onCreateGame(createSpy);

    const nameInput = document.getElementById('playerNameInput') as HTMLInputElement;
    const serverInput = document.getElementById('serverAddressInput') as HTMLInputElement;
    const button = document.getElementById('actionButton') as HTMLButtonElement;

    (document.querySelector<HTMLButtonElement>('#lobbyModeOptions [data-mode="create"]') as HTMLButtonElement).click();
    nameInput.value = 'Alice';
    serverInput.value = 'http://localhost:3000';
    button.click();

    expect(createSpy).toHaveBeenCalledWith('Alice', 'http://localhost:3000');
  });

  it('creates a game after explicitly selecting Create', () => {
    const ui = new UIManager('http://localhost:3000');
    const createSpy = vi.fn();
    ui.onCreateGame(createSpy);

    const createOption = document.querySelector<HTMLButtonElement>('#lobbyModeOptions [role="option"]') as HTMLButtonElement;
    const nameInput = document.getElementById('playerNameInput') as HTMLInputElement;
    nameInput.value = 'Alice';
    createOption.click();
    (document.getElementById('actionButton') as HTMLButtonElement).click();

    expect(createSpy).toHaveBeenCalledWith('Alice', 'http://localhost:3000');
  });

  it('switches between create modes and starts hot seat on this device', () => {
    const ui = new UIManager('http://localhost:3000');
    const hotSeatSpy = vi.fn();
    ui.onHotSeat(hotSeatSpy);

    (document.querySelector<HTMLButtonElement>('[data-mode="create"]') as HTMLButtonElement).click();
    const deviceOption = document.querySelector<HTMLButtonElement>('[data-mode="device"]') as HTMLButtonElement;
    deviceOption.click();

    expect((document.getElementById('internetGameRow') as HTMLDivElement).hidden).toBe(true);
    expect((document.getElementById('hotSeatPanel') as HTMLDivElement).hidden).toBe(false);
    expect((document.getElementById('serverRow') as HTMLDivElement).hidden).toBe(false);

    (document.querySelector<HTMLButtonElement>('[data-mode="internet"]') as HTMLButtonElement).click();
    expect((document.getElementById('serverRow') as HTMLDivElement).hidden).toBe(false);

    (document.getElementById('hotSeatPlayerOneInput') as HTMLInputElement).value = 'Alice';
    (document.getElementById('hotSeatPlayerTwoInput') as HTMLInputElement).value = 'Bob';
    (document.getElementById('startHotSeatButton') as HTMLButtonElement).click();

    expect(hotSeatSpy).toHaveBeenCalledWith('Alice', 'Bob', 'http://localhost:3000');
  });

  it('blocks names longer than 15 characters and enforces the HTML max length', () => {
    const ui = new UIManager('http://localhost:3000');
    const createSpy = vi.fn();
    ui.onCreateGame(createSpy);

    const nameInput = document.getElementById('playerNameInput') as HTMLInputElement;
    const serverInput = document.getElementById('serverAddressInput') as HTMLInputElement;
    const button = document.getElementById('actionButton') as HTMLButtonElement;
    const error = document.getElementById('registrationError') as HTMLDivElement;

    expect(nameInput.maxLength).toBe(15);

    nameInput.value = '1234567890123456';
    serverInput.value = 'http://localhost:3000';
    button.click();

    expect(error.textContent).toBe('Name must be 15 characters or less');
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('fires when Enter is pressed in the velocity input', () => {
    const ui = new UIManager('http://localhost:3000');
    const fireSpy = vi.fn();
    ui.onFire(fireSpy);

    const angleInput = document.getElementById('angleInput') as HTMLInputElement;
    const velocityInput = document.getElementById('velocityInput') as HTMLInputElement;
    angleInput.value = '45';
    velocityInput.value = '150';
    ui.updateTurnUI(0, true);

    velocityInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter' }));

    expect(fireSpy).toHaveBeenCalledWith(45, 150);
  });

    it('restores shot inputs and focuses angle on the active turn', () => {
      const ui = new UIManager('http://localhost:3000');
      const angleInput = document.getElementById('angleInput') as HTMLInputElement;
      const velocityInput = document.getElementById('velocityInput') as HTMLInputElement;

      ui.setShotInputs({ angle: 62, velocity: 240 });
      ui.updateTurnUI(1, true);

      expect(angleInput.value).toBe('62');
      expect(velocityInput.value).toBe('240');
      expect(document.activeElement).toBe(angleInput);

      ui.setShotInputs(undefined);
      expect(angleInput.value).toBe('45');
      expect(velocityInput.value).toBe('150');
    });

  it('enforces angle and velocity limits', () => {
    const ui = new UIManager('http://localhost:3000');
    const fireSpy = vi.fn();
    ui.onFire(fireSpy);
    ui.updateTurnUI(0, true);

    const angleInput = document.getElementById('angleInput') as HTMLInputElement;
    const velocityInput = document.getElementById('velocityInput') as HTMLInputElement;
    const fireButton = document.getElementById('fireButton') as HTMLButtonElement;
    const message = document.getElementById('message') as HTMLDivElement;

    angleInput.value = '100';
    velocityInput.value = '30';
    fireButton.click();
    expect(message.textContent).toBe('Angle must be between 0 and 99');
    expect(fireSpy).not.toHaveBeenCalled();

    angleInput.value = '99';
    velocityInput.value = '29';
    fireButton.click();
    expect(message.textContent).toBe('Velocity must be between 30 and 999');
    expect(fireSpy).not.toHaveBeenCalled();

    velocityInput.value = '999';
    fireButton.click();
    expect(fireSpy).toHaveBeenCalledWith(99, 999);
  });

  it('changes to join mode when Join is selected', () => {
    const ui = new UIManager('http://localhost:3000');
    const joinSpy = vi.fn();
    ui.onJoinGame(joinSpy);

    const nameInput = document.getElementById('joinPlayerNameInput') as HTMLInputElement;
    const serverInput = document.getElementById('serverAddressInput') as HTMLInputElement;
    const inviteInput = document.getElementById('inviteInput') as HTMLInputElement;
    const joinOption = document.querySelector<HTMLButtonElement>('[data-mode="join"]') as HTMLButtonElement;
    const actionButton = document.getElementById('joinGameButton') as HTMLButtonElement;
    const error = document.getElementById('registrationError') as HTMLDivElement;

    nameInput.value = 'Bob';
    serverInput.value = 'http://localhost:3000';
    expect(actionButton.textContent).toBe('Join the game');

    inviteInput.value = 'ABCD';
    joinOption.click();

    inviteInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter' }));
    expect(joinSpy).toHaveBeenCalledWith('ABCD', 'Bob', 'http://localhost:3000');
    expect(error.textContent).toBe('');
  });

  it('enables joining only for populated invite-code input and hides server selection for invite links', () => {
    const ui = new UIManager('http://localhost:3000');
    const inviteInput = document.getElementById('inviteInput') as HTMLInputElement;
    const serverLabel = document.getElementById('serverAddressLabel') as HTMLLabelElement;

    expect((document.getElementById('joinGameRow') as HTMLDivElement).hidden).toBe(true);
    inviteInput.value = 'https://example.com/?invite=ABCD';

    ui.setServerAddress('https://api.example.com');
    ui.enterJoinOnlyMode('ABCD');
    expect((document.getElementById('serverRow') as HTMLDivElement).hidden).toBe(true);
    expect(serverLabel.style.display).not.toBe('none');
    expect((document.getElementById('serverAddressInput') as HTMLInputElement).disabled).toBe(true);
  });

  it('shows invite details after creation', () => {
    const ui = new UIManager('http://localhost:3000');
    const inviteInfo = document.getElementById('inviteInfo') as HTMLDivElement;

    ui.showInviteInfo('ABCD', 'https://example.com/?invite=token');

    expect(inviteInfo.style.display).toBe('block');
    expect(inviteInfo.textContent).toContain('ABCD');
    expect(inviteInfo.textContent).toContain('https://example.com/?invite=token');
  });

  it('hides lobby inputs while creating and restores them after an error', () => {
    const ui = new UIManager('http://localhost:3000');
    const inviteLabel = document.getElementById('inviteInputLabel') as HTMLLabelElement;
    const actionButton = document.getElementById('actionButton') as HTMLButtonElement;

    (document.querySelector<HTMLButtonElement>('[data-mode="create"]') as HTMLButtonElement).click();
    ui.showRegistering();

    expect(actionButton.disabled).toBe(true);
    expect(actionButton.textContent).toBe('Creating...');

    ui.showRegistrationError('Server unavailable');

    expect(actionButton.disabled).toBe(false);
    expect(inviteLabel.style.display).not.toBe('none');
    expect(actionButton.textContent).toBe('Create Game');
  });

  it('copies the invite URL to the clipboard when the copy button is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const ui = new UIManager('http://localhost:3000');
    ui.showInviteInfo('ABCD', 'https://example.com/?invite=token');

    const copyButton = document.getElementById('copyInviteUrlButton') as HTMLButtonElement;
    copyButton.click();
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith('https://example.com/?invite=token');
  });

  it('hides invite details after a connection timeout', () => {
    const ui = new UIManager('http://localhost:3000');
    const inviteInfo = document.getElementById('inviteInfo') as HTMLDivElement;
    const codeButton = document.getElementById('copyInviteCodeButton') as HTMLButtonElement;
    const urlButton = document.getElementById('copyInviteUrlButton') as HTMLButtonElement;

    ui.showInviteInfo('ABCD', 'https://example.com/?invite=ABCD');
    ui.hideInviteInfo();

    expect(inviteInfo.style.display).toBe('none');
    expect(codeButton.onclick).toBeNull();
    expect(urlButton.onclick).toBeNull();
  });

  it('updates player names and turn state correctly', () => {
    const ui = new UIManager('http://localhost:3000');
    const left = document.getElementById('playerNameLeft') as HTMLDivElement;
    const right = document.getElementById('playerNameRight') as HTMLDivElement;

    ui.setPlayerNames(0, 'Alice', 'Bob');
    expect(left.textContent).toBe('Alice');
    expect(right.textContent).toBe('Bob');

    ui.updateTurnUI(0, true);
    expect(left.classList.contains('player-name-active-turn')).toBe(true);

    ui.updateTurnUI(1, false);
    expect(right.classList.contains('player-name-active-turn')).toBe(true);
  });

  it('positions player names at their castle labels when coordinates are provided', () => {
    const ui = new UIManager('http://localhost:3000');
    const left = document.getElementById('playerNameLeft') as HTMLDivElement;
    const right = document.getElementById('playerNameRight') as HTMLDivElement;

    ui.setPlayerNames(0, 'Alice', 'Bob', {
      left: { x: 25, y: 146 },
      right: { x: 255, y: 142 }
    });

    expect(left.style.left).toBe('25px');
    expect(left.style.top).toBe('146px');
    expect(right.style.left).toBe('255px');
    expect(right.style.top).toBe('142px');
  });

  it('shows both player names in the game over message', () => {
    const ui = new UIManager('http://localhost:3000');
    const message = document.getElementById('message') as HTMLDivElement;
    const fireButton = document.getElementById('fireButton') as HTMLButtonElement;

    ui.showGameOver(false, 'Alex', 'Bob');
    expect(message.textContent).toBe('😔 Alex lost. Bob won!');
    expect(fireButton.disabled).toBe(true);

    ui.showGameOver(true, 'Alex', 'Bob');
    expect(message.textContent).toBe('🎉 Alex won! Bob lost.');
  });

  it('offers a rematch after game over and shows waiting state after selection', () => {
    const ui = new UIManager('http://localhost:3000');
    const rematchButton = document.getElementById('rematchButton') as HTMLButtonElement;
    const rematchSpy = vi.fn();

    ui.onRematch(rematchSpy);
    ui.showGameOver(true, 'Alex', 'Bob');

    expect(rematchButton.style.display).toBe('inline-block');
    expect(rematchButton.disabled).toBe(false);
    rematchButton.click();
    expect(rematchSpy).toHaveBeenCalledOnce();

    ui.setRematchWaiting(1);
    expect(rematchButton.disabled).toBe(true);
    expect(rematchButton.textContent).toBe('Waiting (1)');

    ui.prepareForNewRound();
    expect(rematchButton.style.display).toBe('none');
  });

  it('renders angle and velocity as rows with newest-first history columns', () => {
    const ui = new UIManager('http://localhost:3000');

    ui.renderShotHistory([
      { angle: 45, velocity: 150 },
      { angle: 30, velocity: 120 }
    ]);

    const rows = document.querySelectorAll('#shotHistoryRows tr');
    expect(rows).toHaveLength(2);
    expect(Array.from(rows[0].querySelectorAll('th, td')).map((cell) => cell.textContent)).toEqual([
      'Angle', '45°', '30°', '—', '—'
    ]);
    expect(Array.from(rows[1].querySelectorAll('th, td')).map((cell) => cell.textContent)).toEqual([
      'Velocity', '150', '120', '—', '—'
    ]);
  });
});
