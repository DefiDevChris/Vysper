const { BrowserWindow, screen } = require('electron');
const config = require('../core/config');

class WindowManager {
  constructor() {
    this.windows = new Map();
  }

  async initializeWindows() {
    if (this.windows.has('main')) return;
    const display = screen.getPrimaryDisplay();
    const { width, height } = display.workAreaSize;

    const win = new BrowserWindow({
      width: Math.min(900, width - 40),
      height: Math.min(700, height - 40),
      x: display.bounds.x + 20,
      y: display.bounds.y + 20,
      webPreferences: {
        ...config.get('window.webPreferences'),
        devTools: true,
      },
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: true,
      minimizable: false,
      maximizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      fullscreenable: false,
      title: 'Vysper',
      type: 'normal'
    });

    await win.loadFile('index.html');
    win.on('closed', () => this.windows.delete('main'));
    this.windows.set('main', win);
  }

  getWindow(type) { return this.windows.get(type); }

  showLLMResponse(content, metadata) {
    const win = this.windows.get('main');
    if (win && !win.isDestroyed()) {
      win.webContents.send('display-llm-response', { content, metadata, timestamp: new Date().toISOString() });
    }
  }

  showLLMLoading() {
    const win = this.windows.get('main');
    if (win && !win.isDestroyed()) {
      win.webContents.send('show-loading');
    }
  }

  broadcastToAllWindows(channel, data) {
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) win.webContents.send(channel, data);
    }
  }

  showAllWindows() {
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) win.show();
    }
  }

  hideAllWindows() {
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) win.hide();
    }
  }

  toggleVisibility() {
    const isVisible = Array.from(this.windows.values()).some(w => w.isVisible());
    if (isVisible) this.hideAllWindows();
    else this.showAllWindows();
    return !isVisible;
  }

  setInteractive(interactive) {
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) win.setIgnoreMouseEvents(!interactive);
    }
  }

  moveWindow(type, dx, dy) {
    const win = this.windows.get(type);
    if (!win || win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    win.setPosition(x + dx, y + dy);
  }

  getWindowStats() {
    const stats = {};
    this.windows.forEach((win, type) => {
      stats[type] = { isVisible: win.isVisible(), isDestroyed: win.isDestroyed() };
    });
    return { windows: stats, isInteractive: true, isVisible: true };
  }

  destroyAllWindows() {
    this.windows.forEach(win => { if (!win.isDestroyed()) win.destroy(); });
    this.windows.clear();
  }
}

module.exports = new WindowManager();
