require("dotenv").config();

const { app, BrowserWindow, globalShortcut, session, ipcMain, desktopCapturer } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

// Wayland/Linux stabilization flags
if (process.platform === 'linux') {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('disable-dev-shm-usage');
  if (process.env.XDG_SESSION_TYPE === 'wayland') {
    app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer,UseOzonePlatform,WaylandWindowDecorations');
    app.commandLine.appendSwitch('ozone-platform', 'wayland');
  }
}

const logger = require("./src/core/logger").createServiceLogger("MAIN");
const config = require("./src/core/config");

const ocrService = require("./src/services/ocr.service");
const llmService = require("./src/services/llm.service");
const autotypeService = require("./src/services/autotype.service");

const windowManager = require("./src/managers/window.manager");
const sessionManager = require("./src/managers/session.manager");

class ApplicationController {
  constructor() {
    this.isReady = false;
    this.activeSkill = "general";
    this.lastLLMResponse = null;
    this.imageQueue = [];
    this.setupEventHandlers();
  }

  setupEventHandlers() {
    app.whenReady().then(() => this.onAppReady());
    app.on("window-all-closed", () => app.quit());
    app.on("activate", () => this.onActivate());
    app.on("will-quit", () => this.onWillQuit());
    this.setupIPCHandlers();
  }

  async onAppReady() {
    logger.info("Application starting", { version: config.get("app.version") });
    try {
      this.setupPermissions();
      await new Promise(r => setTimeout(r, 200));
      await windowManager.initializeWindows();
      this.setupGlobalShortcuts();
      this.isReady = true;
      logger.info("Application initialized successfully");
    } catch (error) {
      logger.error("Application initialization failed", { error: error.message });
      app.quit();
    }
  }

  setupPermissions() {
    session.defaultSession.setPermissionRequestHandler((_, permission, callback) => {
      callback(permission === "display-capture" || permission === "media");
    });

    if (session.defaultSession.setDisplayMediaRequestHandler) {
      session.defaultSession.setDisplayMediaRequestHandler((_, callback) => {
        desktopCapturer.getSources({ types: ['screen', 'window'] }).then(sources => {
          const screen = sources.find(s => s.name.includes('Entire screen')) || sources[0];
          callback(screen ? { video: screen, audio: 'loopback' } : null);
        }).catch(() => callback(null));
      });
    }
  }

  setupGlobalShortcuts() {
    const shortcuts = [
      ["F6", () => { logger.info('F6 pressed'); this.triggerScreenshotCapture(); }],
      ["F7", () => { logger.info('F7 pressed'); this.sendCapturedImages(); }],
      ["F8", () => { logger.info('F8 pressed'); this.startAutoType(); }],
      ["F9", () => { logger.info('F9 pressed'); this.cancelAutoType(); }],
      ["F10", () => { logger.info('F10 pressed'); this.clearSessionMemory(); }],
      ["CommandOrControl+Shift+V", () => { logger.info('Toggle visibility'); windowManager.toggleVisibility(); }],
    ];

    shortcuts.forEach(([accel, handler]) => {
      const success = globalShortcut.register(accel, handler);
      if (success) logger.info(`Registered shortcut: ${accel}`);
      else logger.warn(`Failed to register shortcut: ${accel}`);
    });
  }

  setupIPCHandlers() {
    ipcMain.handle("take-screenshot", () => this.triggerScreenshotCapture());
    ipcMain.handle("start-autotype", (_, text, delay) => this.startAutoType(text, delay));
    ipcMain.handle("cancel-autotype", () => this.cancelAutoType());
    ipcMain.handle("get-autotype-status", () => autotypeService.getStatus());
    ipcMain.handle("set-autotype-delay", (_, delay) => { autotypeService.setDelay(delay); return { success: true }; });


    ipcMain.handle("process-screenshot-data", async (_, { dataUrl, imageQueue }) => {
      try {
        const result = await this.analyzeImage(imageQueue?.length ? imageQueue : dataUrl, "");
        return result;
      } catch (error) {
        logger.error("process-screenshot-data error", { error: error.message });
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("show-all-windows", () => { windowManager.showAllWindows(); return { success: true }; });
    ipcMain.handle("hide-all-windows", () => { windowManager.hideAllWindows(); return { success: true }; });
    ipcMain.handle("enable-window-interaction", () => { windowManager.setInteractive(true); return { success: true }; });
    ipcMain.handle("disable-window-interaction", () => { windowManager.setInteractive(false); return { success: true }; });
    ipcMain.handle("resize-window", (_, { width, height }) => {
      const main = windowManager.getWindow("main");
      if (main) main.setSize(width, height);
      return { success: true };
    });
    ipcMain.handle("move-window", (_, { deltaX, deltaY, windowKey }) => {
      windowManager.moveWindow(windowKey, deltaX, deltaY);
      return { success: true };
    });
    ipcMain.handle("get-window-stats", () => windowManager.getWindowStats());
    ipcMain.handle("close-window", () => { windowManager.hideAllWindows(); return { success: true }; });

    ipcMain.handle("clear-session-memory", () => {
      sessionManager.clear();
      windowManager.broadcastToAllWindows("session-cleared");
      return { success: true };
    });

    ipcMain.handle("send-chat-message", async (_, text) => {
      sessionManager.addUserInput(text, 'chat');
      setTimeout(async () => {
        const history = sessionManager.getOptimizedHistory();
        await this.processTextWithLLM(text, history);
      }, 500);
      return { success: true };
    });

    ipcMain.handle("get-settings", () => this.getSettings());
    ipcMain.handle("save-settings", (_, settings) => this.saveSettings(settings));
    ipcMain.handle("update-active-skill", (_, skill) => {
      this.activeSkill = skill;
      windowManager.broadcastToAllWindows("skill-changed", { skill });
      return { success: true };
    });

    ipcMain.handle("set-nvidia-api-key", (_, apiKey) => { llmService.updateApiKey(apiKey); return llmService.getStats(); });
    ipcMain.handle("get-nvidia-status", () => llmService.getStats());
    ipcMain.handle("test-nvidia-connection", async () => llmService.testConnection());

    // Screen capture sources
    ipcMain.handle("get-screen-sources", async () => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen', 'window'],
          thumbnailSize: { width: 150, height: 150 }
        });
        return sources.map(s => ({
          id: s.id,
          name: s.name,
          display_id: s.display_id,
          appIcon: s.appIcon?.toDataURL()
        }));
      } catch (error) {
        logger.error("Failed to get screen sources", { error: error.message });
        return [];
      }
    });

    ipcMain.handle("quit-app", () => { windowManager.destroyAllWindows(); globalShortcut.unregisterAll(); app.quit(); });
    ipcMain.on("quit-app", () => { windowManager.destroyAllWindows(); globalShortcut.unregisterAll(); app.quit(); });
  }

  captureScreenshot() {
    if (!this.isReady) return;
    this.imageQueue.push({ timestamp: Date.now() });
    const mainWindow = windowManager.windows.get("main");
    if (mainWindow?.webContents) mainWindow.webContents.send("trigger-stream-capture");
  }

  async sendCapturedImages() {
    // Trigger analyze in the renderer via IPC event
    const mainWindow = windowManager.windows.get("main");
    if (mainWindow?.webContents) mainWindow.webContents.send("trigger-analyze");
  }

  cancelAutoType() {
    autotypeService.cancel();
  }

  async triggerScreenshotCapture() {
    if (!this.isReady) return;
    const mainWindow = windowManager.windows.get("main");
    if (mainWindow?.webContents) {
      if (!mainWindow.isVisible()) mainWindow.showInactive();
      mainWindow.webContents.send("trigger-stream-capture");
    }
  }

  async analyzeImage(imageOrQueue, ocrText) {
    const startTime = Date.now();
    const mainWindow = windowManager.windows.get("main");
    
    try {
      windowManager.showLLMLoading();
      sessionManager.clear();
      sessionManager.addOCREvent(ocrText, { source: 'screenshot' });

      const visionPrompt = `Analyze the image and provide ONLY the answer. No explanation.

Rules:
- Multiple choice: Letter + answer (e.g., "B. Binary Search")
- Code: Solution only, minimal/no comments
- Fill-in-blank: Missing part only
- Short answer: Just the answer

NO meta-commentary. NO "Looking at..." or "Based on...". Respond immediately.`;

      const llmResult = await llmService.processScreenshotWithVision(
        imageOrQueue,
        visionPrompt,
        'dsa',
        []
      );

      this.lastLLMResponse = llmResult.response;
      autotypeService.setResponseText(llmResult.response);
      sessionManager.addModelResponse(llmResult.response, { skill: 'dsa', processingTime: Date.now() - startTime });
      windowManager.showLLMResponse(llmResult.response, { 
        skill: 'dsa', 
        processingTime: Date.now() - startTime,
        usedFallback: llmResult.metadata?.usedFallback 
      });

      return { success: true, response: llmResult.response };
    } catch (error) {
      logger.error("Analysis failed", { error: error.message, stack: error.stack });
      
      const errorMessage = error.message || 'Unknown error occurred';
      windowManager.showLLMResponse('', { 
        error: `Analysis failed: ${errorMessage}`,
        usedFallback: false
      });
      
      return { success: false, error: errorMessage };
    }
  }

  async processTextWithLLM(text, sessionHistory) {
    try {
      sessionManager.addUserInput(text, 'llm_input');
      const llmResult = await llmService.processTextWithSkill(text, this.activeSkill, sessionHistory.recent, null);
      this.lastLLMResponse = llmResult.response;
      sessionManager.addModelResponse(llmResult.response, { skill: this.activeSkill, processingTime: llmResult.metadata.processingTime });
      windowManager.showLLMResponse(llmResult.response, { skill: this.activeSkill, processingTime: llmResult.metadata.processingTime });
    } catch (error) {
      logger.error("LLM processing failed", { error: error.message });

    }
  }

  async startAutoType(text, delay) {
    // If text provided, parse it into sections first
    if (text && typeof text === 'string') {
      autotypeService.setResponseText(text);
    }
    
    // If no text and no sections, try lastLLMResponse
    if (!autotypeService.responseSections.length && !autotypeService.currentText) {
      const lastResponse = this.lastLLMResponse;
      if (!lastResponse) return { success: false, error: 'No text available to type' };
      autotypeService.setResponseText(lastResponse);
    }
    
    try {
      const result = await autotypeService.typeText(null, delay);
      
      // Log section info for user awareness
      if (result.hasNextSection) {
        logger.info(`Section ${result.currentSection} of ${result.totalSections} typed. Press F8 again for next section.`);
      }
      
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  clearSessionMemory() {
    sessionManager.clear();
    windowManager.broadcastToAllWindows("session-cleared");
  }

  onActivate() {
    if (!this.isReady) {
      this.onAppReady();
    } else {
      const main = windowManager.getWindow("main");
      if (main?.isVisible()) main.show();
    }
  }

  onWillQuit() {
    globalShortcut.unregisterAll();
    windowManager.destroyAllWindows();
    autotypeService.cancel();
  }

  getSettings() {
    return {
      codingLanguage: this.codingLanguage || "javascript",
      activeSkill: this.activeSkill || "general",
      autotypeDelay: autotypeService.typingDelay,
    };
  }

  saveSettings(settings) {
    try {
      if (settings.codingLanguage) this.codingLanguage = settings.codingLanguage;
      if (settings.activeSkill) {
        this.activeSkill = settings.activeSkill;
        windowManager.broadcastToAllWindows("skill-changed", { skill: settings.activeSkill });
      }
      if (settings.nvidiaKey) llmService.updateApiKey(settings.nvidiaKey);
      if (settings.autotypeDelay !== undefined) autotypeService.setDelay(parseInt(settings.autotypeDelay, 10));
      config.persistSettings(settings);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

new ApplicationController();
