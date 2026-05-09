require("dotenv").config();

const { app, BrowserWindow, globalShortcut, session, ipcMain, desktopCapturer } = require("electron");
const fs = require("fs");
const path = require("path");
const os = require("os");

// Wayland/Linux stabilization flags - must be set BEFORE app is ready
if (process.platform === 'linux') {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer,UseOzonePlatform,WaylandWindowDecorations');
  app.commandLine.appendSwitch('ozone-platform', 'wayland');
  app.commandLine.appendSwitch('disable-dev-shm-usage'); // Fixes shared memory fatal errors
}

const logger = require("./src/core/logger").createServiceLogger("MAIN");
const config = require("./src/core/config");

// Services
const ocrService = require("./src/services/ocr.service");
const llmService = require("./src/services/llm.service");
const autotypeService = require("./src/services/autotype.service");

// Managers
const windowManager = require("./src/managers/window.manager");
const sessionManager = require("./src/managers/session.manager");

class ApplicationController {
  constructor() {
    this.isReady = false;
    this.activeSkill = "general";
    this.lastLLMResponse = null;

    // Window configurations for reference
    this.windowConfigs = {
      main: { title: "Vysper" },
      chat: { title: "Chat" },
      llmResponse: { title: "AI Response" },
      settings: { title: "Settings" },
    };

    this.setupStealth();
    this.setupEventHandlers();
  }

  setupStealth() {
    if (config.get("stealth.disguiseProcess")) {
      process.title = config.get("app.processTitle");
    }

    // Set default stealth app name early
    app.setName("Terminal ");
    process.title = "Terminal ";

    if (
      process.platform === "darwin" &&
      config.get("stealth.noAttachConsole")
    ) {
      process.env.ELECTRON_NO_ATTACH_CONSOLE = "1";
      process.env.ELECTRON_NO_ASAR = "1";
    }
  }

  setupEventHandlers() {
    app.whenReady().then(() => this.onAppReady());
    app.on("window-all-closed", () => this.onWindowAllClosed());
    app.on("activate", () => this.onActivate());
    app.on("will-quit", () => this.onWillQuit());

    this.setupIPCHandlers();
  }

  async onAppReady() {
    // Force stealth mode IMMEDIATELY when app is ready
    app.setName("Terminal ");
    process.title = "Terminal ";

    logger.info("Application starting", {
      version: config.get("app.version"),
      environment: config.get("app.isDevelopment")
        ? "development"
        : "production",
      platform: process.platform,
    });

    try {
      this.setupPermissions();

      // Small delay to ensure desktop/space detection is accurate
      await new Promise((resolve) => setTimeout(resolve, 200));

      await windowManager.initializeWindows();
      this.setupGlobalShortcuts();

      // Initialize default stealth mode with terminal icon
      this.updateAppIcon("terminal");

      this.isReady = true;

      logger.info("Application initialized successfully", {
        windowCount: Object.keys(windowManager.getWindowStats().windows).length,
        currentDesktop: "detected",
      });

      sessionManager.addEvent("Application started");
    } catch (error) {
      logger.error("Application initialization failed", {
        error: error.message,
      });
      app.quit();
    }
  }

  setupPermissions() {
    session.defaultSession.setPermissionRequestHandler(
      (webContents, permission, callback) => {
        // Only allow display-capture, no microphone or camera
        const allowedPermissions = ["display-capture", "media"];
        const granted = allowedPermissions.includes(permission);

        logger.debug("Permission request", { permission, granted });
        callback(granted);
      }
    );

    // Bypasses the internal Chromium picker for getDisplayMedia
    if (session.defaultSession.setDisplayMediaRequestHandler) {
      session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
        // Find screen sources
        desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
          logger.info('Available screen sources', { count: sources.length, sources: sources.map(s => s.name) });
          
          // Prefer 'Entire screen' or 'Screen 1' or just the first source
          const screen = sources.find(s => s.name.includes('Entire screen')) || 
                         sources.find(s => s.name.includes('Screen')) || 
                         sources[0];
                         
          if (screen) {
            logger.info('Auto-selecting screen source for capture', { name: screen.name, id: screen.id });
            callback({ video: screen, audio: 'loopback' });
          } else {
            logger.warn('No screen sources found for display media request');
            callback(null);
          }
        }).catch(err => {
          logger.error('Failed to get screen sources for display media', { error: err.message });
          callback(null);
        });
      });
    }
  }

  setupGlobalShortcuts() {
    const shortcuts = {
      "CommandOrControl+Shift+S": () => this.triggerScreenshotCapture(),
      "CommandOrControl+Shift+V": () => windowManager.toggleVisibility(),
      "CommandOrControl+Shift+I": () => windowManager.toggleInteraction(),
      "CommandOrControl+Shift+C": () => windowManager.switchToWindow("chat"),
      "CommandOrControl+Shift+\\": () => this.clearSessionMemory(),
      "CommandOrControl+,": () => windowManager.showSettings(),
      "Alt+A": () => windowManager.toggleInteraction(),
      "CommandOrControl+Shift+T": () => windowManager.forceAlwaysOnTopForAllWindows(),
      "CommandOrControl+Shift+D": () => {
        const nextDisplay = windowManager.cycleDisplay();
        if (nextDisplay) {
          logger.info("Cycled display", { displayId: nextDisplay.id });
        }
      },
      "CommandOrControl+Shift+Alt+T": () => {
        const results = windowManager.testAlwaysOnTopForAllWindows();
        logger.info('Always-on-top test triggered via shortcut', results);
      },
      // Context-sensitive shortcuts based on interaction mode
      "CommandOrControl+Up": () => this.handleUpArrow(),
      "CommandOrControl+Down": () => this.handleDownArrow(),
      "CommandOrControl+Left": () => this.handleLeftArrow(),
      "CommandOrControl+Right": () => this.handleRightArrow(),
      "F8": () => this.startAutoType(),
    };

    Object.entries(shortcuts).forEach(([accelerator, handler]) => {
      const success = globalShortcut.register(accelerator, handler);
      if (success) {
        logger.info("Global shortcut registered", { accelerator });
      } else {
        logger.error("FAILED to register global shortcut", { accelerator });
        // Fallback or warning for Linux/Wayland users
        if (process.platform === 'linux') {
          logger.warn(`Shortcut ${accelerator} might be blocked by your window manager (Wayland). Try another shortcut or use interactive mode.`);
        }
      }
    });
  }

  setupIPCHandlers() {
    // Screenshot capture → NVIDIA NIM Vision API
    ipcMain.handle("take-screenshot", () => this.triggerScreenshotCapture());

    // Auto-type IPC handlers
    ipcMain.handle("start-autotype", (event, text, delay) => {
      return this.startAutoType(text, delay);
    });

    ipcMain.handle("cancel-autotype", () => {
      return this.cancelAutoType();
    });

    // Renderer logging bridge for debugging Wayland issues
    ipcMain.handle('log-error-to-main', (event, data) => {
      const level = data.level || 'error';
      const msg = data.message || 'Unknown renderer error';
      const meta = data.meta || {};
      
      if (level === 'warn') {
        logger.warn(`[RENDERER] ${msg}`, meta);
      } else {
        logger.error(`[RENDERER] ${msg}`, meta);
      }
      return true;
    });



    // Process screenshot data from renderer
    ipcMain.handle("process-screenshot-data", async (event, { dataUrl, imageQueue }) => {
      try {
        if (imageQueue && imageQueue.length > 0) {
          logger.info(`Received image queue with ${imageQueue.length} images`);
          await this.analyzeImage(imageQueue, ""); 
        } else if (dataUrl) {
          await this.analyzeImage(dataUrl, "");
        } else {
          throw new Error('No image data provided');
        }
        return { success: true };
      } catch (error) {
        logger.error("Failed to process screenshot data", { error: error.message });
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("get-autotype-status", () => {
      return autotypeService.getStatus();
    });

    ipcMain.handle("set-autotype-delay", (event, delay) => {
      autotypeService.setDelay(delay);
      return { success: true };
    });

    ipcMain.handle("set-autotype-wpm", (event, wpm) => {
      autotypeService.setWPM(wpm);
      return { success: true };
    });

    // Window management
    ipcMain.on("chat-window-ready", () => {
      setTimeout(() => {
        windowManager.broadcastToAllWindows("transcription-received", {
          text: "Vysper AI assistant ready. Capture a screenshot to analyze your screen.",
        });
      }, 1000);
    });

    ipcMain.handle("show-all-windows", () => {
      windowManager.showAllWindows();
      return windowManager.getWindowStats();
    });

    ipcMain.handle("hide-all-windows", () => {
      windowManager.hideAllWindows();
      return windowManager.getWindowStats();
    });

    ipcMain.handle("enable-window-interaction", () => {
      windowManager.setInteractive(true);
      return windowManager.getWindowStats();
    });

    ipcMain.handle("disable-window-interaction", () => {
      windowManager.setInteractive(false);
      return windowManager.getWindowStats();
    });

    ipcMain.handle("switch-to-chat", () => {
      windowManager.switchToWindow("chat");
      return windowManager.getWindowStats();
    });

    ipcMain.handle("switch-to-skills", () => {
      windowManager.switchToWindow("skills");
      return windowManager.getWindowStats();
    });

    ipcMain.handle("resize-window", (event, { width, height }) => {
      const mainWindow = windowManager.getWindow("main");
      if (mainWindow) {
        mainWindow.setSize(width, height);
        logger.debug("Main window resized", { width, height });
      }
      return { success: true };
    });

    ipcMain.handle("move-window", (event, { deltaX, deltaY, windowKey }) => {
      if (windowKey) {
        windowManager.moveWindow(windowKey, deltaX, deltaY);
      } else {
        windowManager.moveBoundWindows(deltaX, deltaY);
      }
      return { success: true };
    });

    ipcMain.handle("get-session-history", () => {
      return sessionManager.getOptimizedHistory();
    });

    ipcMain.handle("clear-session-memory", () => {
      sessionManager.clear();
      windowManager.broadcastToAllWindows("session-cleared");
      return { success: true };
    });

    ipcMain.handle("force-always-on-top", () => {
      windowManager.forceAlwaysOnTopForAllWindows();
      return { success: true };
    });

    ipcMain.handle("test-always-on-top", () => {
      const results = windowManager.testAlwaysOnTopForAllWindows();
      return { success: true, results };
    });

    ipcMain.handle("send-chat-message", async (event, text) => {
      sessionManager.addUserInput(text, 'chat');
      logger.debug('Chat message added to session memory', { textLength: text.length });

      setTimeout(async () => {
        try {
          const sessionHistory = sessionManager.getOptimizedHistory();
          await this.processTextWithLLM(text, sessionHistory);
        } catch (error) {
          logger.error("Failed to process chat message with LLM", {
            error: error.message,
            text: text.substring(0, 100)
          });
        }
      }, 500);

      return { success: true };
    });

    ipcMain.handle("get-skill-prompt", (event, skillName) => {
      try {
        const { promptLoader } = require('./prompt-loader');
        const skillPrompt = promptLoader.getSkillPrompt(skillName);
        return skillPrompt;
      } catch (error) {
        logger.error('Failed to get skill prompt', { skillName, error: error.message });
        return null;
      }
    });

    // NVIDIA NIM API key configuration
    ipcMain.handle("set-nvidia-api-key", (event, apiKey) => {
      llmService.updateApiKey(apiKey);
      return llmService.getStats();
    });

    ipcMain.handle("get-nvidia-status", () => {
      return llmService.getStats();
    });

    ipcMain.handle("test-nvidia-connection", async () => {
      return await llmService.testConnection();
    });

    ipcMain.handle("run-nvidia-diagnostics", async () => {
      try {
        const apiTest = await llmService.testConnection();

        return {
          success: true,
          apiTest,
          timestamp: new Date().toISOString()
        };
      } catch (error) {
        return {
          success: false,
          error: error.message,
          timestamp: new Date().toISOString()
        };
      }
    });

    // Window binding IPC handlers
    ipcMain.handle("set-window-binding", (event, enabled) => {
      return windowManager.setWindowBinding(enabled);
    });

    ipcMain.handle("toggle-window-binding", () => {
      return windowManager.toggleWindowBinding();
    });

    ipcMain.handle("get-window-binding-status", () => {
      return windowManager.getWindowBindingStatus();
    });

    ipcMain.handle("get-window-stats", () => {
      return windowManager.getWindowStats();
    });

    ipcMain.handle("set-window-gap", (event, gap) => {
      return windowManager.setWindowGap(gap);
    });

    ipcMain.handle("move-bound-windows", (event, { deltaX, deltaY }) => {
      windowManager.moveBoundWindows(deltaX, deltaY);
      return windowManager.getWindowBindingStatus();
    });

    // Settings handlers
    ipcMain.handle("show-settings", () => {
      windowManager.showSettings();

      const settingsWindow = windowManager.getWindow("settings");
      if (settingsWindow) {
        const currentSettings = this.getSettings();
        setTimeout(() => {
          settingsWindow.webContents.send("load-settings", currentSettings);
        }, 100);
      }

      return { success: true };
    });

    ipcMain.handle("get-settings", () => {
      return this.getSettings();
    });

    ipcMain.handle("save-settings", (event, settings) => {
      return this.saveSettings(settings);
    });

    ipcMain.handle("update-app-icon", (event, iconKey) => {
      return this.updateAppIcon(iconKey);
    });

    ipcMain.handle("update-active-skill", (event, skill) => {
      this.activeSkill = skill;
      windowManager.broadcastToAllWindows("skill-changed", { skill });
      return { success: true };
    });

    ipcMain.handle("restart-app-for-stealth", () => {
      const { app } = require("electron");
      app.relaunch();
      app.exit();
    });

    ipcMain.handle("close-window", (event) => {
      const webContents = event.sender;
      const window = windowManager.windows.forEach((win, type) => {
        if (win.webContents === webContents) {
          win.hide();
          return true;
        }
      });
      return { success: true };
    });

    // LLM window specific handlers
    ipcMain.handle("expand-llm-window", (event, contentMetrics) => {
      windowManager.expandLLMWindow(contentMetrics);
      return { success: true, contentMetrics };
    });

    ipcMain.handle("resize-llm-window-for-content", (event, contentMetrics) => {
      windowManager.expandLLMWindow(contentMetrics);
      return { success: true, contentMetrics };
    });

    ipcMain.handle("quit-app", () => {
      logger.info("Quit app requested via IPC");
      try {
        const { app } = require("electron");
        windowManager.destroyAllWindows();
        globalShortcut.unregisterAll();
        app.quit();
        setTimeout(() => {
          process.exit(0);
        }, 2000);
      } catch (error) {
        logger.error("Error during quit:", error);
        process.exit(1);
      }
    });

    // Handle close settings
    ipcMain.on("close-settings", () => {
      const settingsWindow = windowManager.getWindow("settings");
      if (settingsWindow) {
        settingsWindow.hide();
      }
    });

    // Handle save settings (synchronous)
    ipcMain.on("save-settings", (event, settings) => {
      this.saveSettings(settings);
    });

    // Handle update skill
    ipcMain.on("update-skill", (event, skill) => {
      this.activeSkill = skill;
      windowManager.broadcastToAllWindows("skill-updated", { skill });
    });

    // Handle quit app (alternative method)
    ipcMain.on("quit-app", () => {
      logger.info("Quit app requested via IPC (on method)");
      try {
        const { app } = require("electron");
        windowManager.destroyAllWindows();
        globalShortcut.unregisterAll();
        app.quit();
        setTimeout(() => process.exit(0), 1000);
      } catch (error) {
        logger.error("Error during quit (on method):", error);
        process.exit(1);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Screenshot Capture → NVIDIA NIM Vision API
  // ---------------------------------------------------------------------------

  async triggerScreenshotCapture() {
    if (!this.isReady) {
      logger.warn("Screenshot requested before application ready");
      return;
    }

    try {
      const mainWindow = windowManager.windows.get("main");
      if (mainWindow && !mainWindow.isDestroyed()) {
        // Ensure main window is "active" enough to handle IPC
        if (!mainWindow.isVisible()) {
          logger.debug("Showing main window for capture trigger");
          mainWindow.showInactive();
        }
        
        // Send event to renderer to use its persistent stream
        mainWindow.webContents.send("trigger-stream-capture");
      } else {
        // Fallback to legacy
        windowManager.showLLMLoading();
        const captureResult = await ocrService.captureAndProcess();
        await this.analyzeImage(captureResult.imageBase64, captureResult.text);
      }
    } catch (error) {
      logger.error("Capture trigger failed", { error: error.message });
    }
  }

  async analyzeImage(imageOrQueue, ocrText) {
    const isQueue = Array.isArray(imageOrQueue);
    const startTime = Date.now();
    try {
      windowManager.showLLMLoading();

      // Clear session memory to ensure blank context for every new screen sent
      // as requested by the user.
      logger.info("Clearing session memory for fresh screen analysis");
      sessionManager.clear();

      // Add OCR extracted text to session memory (now fresh)
      sessionManager.addOCREvent(ocrText, {
        source: 'screenshot'
      });

      const sessionHistory = sessionManager.getOptimizedHistory();

      // Build a vision prompt with "Answer First" and "Tell me which answer to pick" logic
      const visionPrompt = `CRITICAL: PROVIDE THE EXACT CORRECT ANSWER IMMEDIATELY.
If this is a multiple choice question, EXPLICITLY TELL ME WHICH OPTION TO PICK (e.g., "Pick Option B").
If this is a coding task, provide the complete, optimized solution.

YOUR MISSION:
1. Identify the exact problem, question, or coding task shown.
2. Read the entire screen and all provided context.
3. Provide the COMPREHENSIVE and EXACT CORRECT SOLUTION.
4. ANSWER FIRST: Give the direct answer before any explanation.
${ocrText && ocrText.trim().length > 0 ? `\nOCR DATA (Text on screen): "${ocrText.substring(0, 5000)}"` : ""}`;

      // Send screenshot(s) to NVIDIA NIM vision API
      const llmResult = await llmService.processScreenshotWithVision(
        imageOrQueue,
        visionPrompt,
        this.activeSkill,
        [] // Pass empty history to ensure blank context for the LLM request
      );

      this.lastLLMResponse = llmResult.response;

      sessionManager.addModelResponse(llmResult.response, {
        skill: this.activeSkill,
        processingTime: Date.now() - startTime
      });

      windowManager.showLLMResponse(llmResult.response, {
        skill: this.activeSkill,
        processingTime: Date.now() - startTime
      });

      this.broadcastLLMSuccess(llmResult);

      return { success: true, response: llmResult.response };
    } catch (error) {
      logger.error("Analysis failed", { error: error.message });
      this.broadcastLLMError(error);
      return { success: false, error: error.message };
    }
  }

  // ---------------------------------------------------------------------------

  async processTextWithLLM(text, sessionHistory) {
    try {
      sessionManager.addUserInput(text, 'llm_input');

      const llmResult = await llmService.processTextWithSkill(
        text,
        this.activeSkill,
        sessionHistory.recent,
        null
      );

      // Store the LLM response for auto-type
      this.lastLLMResponse = llmResult.response;

      sessionManager.addModelResponse(llmResult.response, {
        skill: this.activeSkill,
        processingTime: llmResult.metadata.processingTime,
        usedFallback: llmResult.metadata.usedFallback,
      });

      windowManager.showLLMResponse(llmResult.response, {
        skill: this.activeSkill,
        processingTime: llmResult.metadata.processingTime,
        usedFallback: llmResult.metadata.usedFallback,
      });

      this.broadcastLLMSuccess(llmResult);
    } catch (error) {
      logger.error("LLM processing failed", {
        error: error.message,
        skill: this.activeSkill,
      });

      windowManager.hideLLMResponse();

      this.broadcastLLMError(error.message);
    }
  }

  // ---------------------------------------------------------------------------
  // Auto-type functionality
  // ---------------------------------------------------------------------------

  async startAutoType(text, delay) {
    logger.debug("startAutoType called", { hasProvidedText: !!text, hasLastLLMResponse: !!this.lastLLMResponse });
    const textToType = text || this.lastLLMResponse;

    if (!textToType) {
      return { success: false, error: 'No text available to type' };
    }

    try {
      logger.info('Starting auto-type', {
        textLength: textToType.length,
        delay: delay || 'default',
        wpm: autotypeService.wpm
      });

      const result = await autotypeService.typeText(textToType, delay);

      logger.info('Auto-type completed', {
        typedLength: result.typedLength
      });

      return result;
    } catch (error) {
      if (error.message === 'Typing cancelled') {
        logger.info('Auto-type was cancelled by user');
        return { success: false, cancelled: true };
      }

      logger.error('Auto-type failed', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  cancelAutoType() {
    autotypeService.cancel();
    logger.info('Auto-type cancelled');
    return { success: true };
  }

  // ---------------------------------------------------------------------------
  // Session management
  // ---------------------------------------------------------------------------

  clearSessionMemory() {
    try {
      sessionManager.clear();
      windowManager.broadcastToAllWindows("session-cleared");
      logger.info("Session memory cleared via global shortcut");
    } catch (error) {
      logger.error("Error clearing session memory:", error);
    }
  }

  // ---------------------------------------------------------------------------
  // Arrow key handlers
  // ---------------------------------------------------------------------------

  handleUpArrow() {
    const isInteractive = windowManager.getWindowStats().isInteractive;
    if (isInteractive) {
      this.navigateSkill(-1);
    } else {
      windowManager.moveBoundWindows(0, -20);
    }
  }

  handleDownArrow() {
    const isInteractive = windowManager.getWindowStats().isInteractive;
    if (isInteractive) {
      this.navigateSkill(1);
    } else {
      windowManager.moveBoundWindows(0, 20);
    }
  }

  handleLeftArrow() {
    const isInteractive = windowManager.getWindowStats().isInteractive;
    if (!isInteractive) {
      windowManager.moveBoundWindows(-20, 0);
    }
  }

  handleRightArrow() {
    const isInteractive = windowManager.getWindowStats().isInteractive;
    if (!isInteractive) {
      windowManager.moveBoundWindows(20, 0);
    }
  }

  navigateSkill(direction) {
    const availableSkills = [
      "general",
      "programming",
      "dsa",
      "system-design",
      "behavioral",
      "data-science",
      "sales",
      "presentation",
      "negotiation",
      "devops",
    ];

    const currentIndex = availableSkills.indexOf(this.activeSkill);
    if (currentIndex === -1) {
      logger.warn("Current skill not found in available skills", {
        currentSkill: this.activeSkill,
        availableSkills,
      });
      return;
    }

    let newIndex = currentIndex + direction;
    if (newIndex >= availableSkills.length) {
      newIndex = 0;
    } else if (newIndex < 0) {
      newIndex = availableSkills.length - 1;
    }

    const newSkill = availableSkills[newIndex];
    this.activeSkill = newSkill;

    sessionManager.setActiveSkill(newSkill);

    logger.info("Skill navigated via global shortcut", {
      from: availableSkills[currentIndex],
      to: newSkill,
      direction: direction > 0 ? "down" : "up",
    });

    windowManager.broadcastToAllWindows("skill-updated", { skill: newSkill });
  }

  // ---------------------------------------------------------------------------
  // Broadcast methods
  // ---------------------------------------------------------------------------

  broadcastOCRSuccess(ocrResult) {
    windowManager.broadcastToAllWindows("ocr-completed", {
      text: ocrResult.text,
      metadata: ocrResult.metadata,
    });
  }

  broadcastOCRError(errorMessage) {
    windowManager.broadcastToAllWindows("ocr-error", {
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });
  }

  broadcastLLMSuccess(llmResult) {
    const broadcastData = {
      response: llmResult.response,
      metadata: llmResult.metadata,
      skill: this.activeSkill,
    };

    logger.info("Broadcasting LLM success to all windows", {
      responseLength: llmResult.response.length,
      skill: this.activeSkill,
    });

    windowManager.broadcastToAllWindows("llm-response", broadcastData);
  }

  broadcastLLMError(errorMessage) {
    windowManager.broadcastToAllWindows("llm-error", {
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });
  }

  // ---------------------------------------------------------------------------
  // App lifecycle
  // ---------------------------------------------------------------------------

  onWindowAllClosed() {
    if (process.platform !== "darwin") {
      app.quit();
    }
  }

  onActivate() {
    if (!this.isReady) {
      this.onAppReady();
    } else {
      const mainWindow = windowManager.getWindow("main");
      if (mainWindow && mainWindow.isVisible()) {
        windowManager.showOnCurrentDesktop(mainWindow);
      }

      windowManager.windows.forEach((window, type) => {
        if (window.isVisible()) {
          windowManager.showOnCurrentDesktop(window);
        }
      });
    }
  }

  onWillQuit() {
    globalShortcut.unregisterAll();
    windowManager.destroyAllWindows();
    autotypeService.cancel();

    const sessionStats = sessionManager.getMemoryUsage();
    logger.info("Application shutting down", {
      sessionEvents: sessionStats.eventCount,
      sessionSize: sessionStats.approximateSize,
    });
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  getSettings() {
    return {
      codingLanguage: this.codingLanguage || "javascript",
      activeSkill: this.activeSkill || "general",
      appIcon: this.appIcon || "terminal",
      selectedIcon: this.appIcon || "terminal",
      autotypeDelay: autotypeService.typingDelay,
      autotypeWpm: autotypeService.wpm,
    };
  }

  saveSettings(settings) {
    try {
      if (settings.codingLanguage) {
        this.codingLanguage = settings.codingLanguage;
      }
      if (settings.activeSkill) {
        this.activeSkill = settings.activeSkill;
        windowManager.broadcastToAllWindows("skill-updated", {
          skill: settings.activeSkill,
        });
      }
      if (settings.appIcon) {
        this.appIcon = settings.appIcon;
      }
      if (settings.selectedIcon) {
        this.appIcon = settings.selectedIcon;
        this.updateAppIcon(settings.selectedIcon);
      }
      if (settings.nvidiaKey) {
        llmService.updateApiKey(settings.nvidiaKey);
      }
      if (settings.autotypeDelay !== undefined) {
        autotypeService.setDelay(parseInt(settings.autotypeDelay, 10));
      }
      if (settings.autotypeWpm !== undefined) {
        autotypeService.setWPM(parseInt(settings.autotypeWpm, 10));
      }

      this.persistSettings(settings);

      logger.info("Settings saved successfully", settings);
      return { success: true };
    } catch (error) {
      logger.error("Failed to save settings", { error: error.message });
      return { success: false, error: error.message };
    }
  }

  persistSettings(settings) {
    // Delegate to config manager for disk persistence
    try {
      config.persistSettings(settings);
    } catch (error) {
      logger.error('Failed to persist settings to disk', { error: error.message });
    }
  }

  updateAppIcon(iconKey) {
    try {
      const { app } = require("electron");
      const path = require("path");
      const fs = require("fs");

      const iconPaths = {
        terminal: "assests/icons/terminal.png",
        activity: "assests/icons/activity.png",
        settings: "assests/icons/settings.png",
      };

      const appNames = {
        terminal: "Terminal ",
        activity: "Activity Monitor ",
        settings: "System Settings ",
      };

      const iconPath = iconPaths[iconKey];
      const appName = appNames[iconKey];

      if (!iconPath) {
        logger.error("Invalid icon key", { iconKey });
        return { success: false, error: "Invalid icon key" };
      }

      const fullIconPath = path.resolve(iconPath);

      if (!fs.existsSync(fullIconPath)) {
        logger.error("Icon file not found", {
          iconKey,
          iconPath: fullIconPath,
        });
        return { success: false, error: "Icon file not found" };
      }

      if (process.platform === "darwin") {
        app.dock.setIcon(fullIconPath);
        setTimeout(() => {
          app.dock.setIcon(fullIconPath);
        }, 100);
        setTimeout(() => {
          app.dock.setIcon(fullIconPath);
        }, 500);
      } else {
        windowManager.windows.forEach((window, type) => {
          if (window && !window.isDestroyed()) {
            window.setIcon(fullIconPath);
          }
        });
      }

      this.updateAppName(appName, iconKey);

      logger.info("App icon and name updated successfully", {
        iconKey,
        appName,
        iconPath: fullIconPath,
        platform: process.platform,
      });

      this.appIcon = iconKey;
      return { success: true };
    } catch (error) {
      logger.error("Failed to update app icon", {
        error: error.message,
        stack: error.stack,
      });
      return { success: false, error: error.message };
    }
  }

  updateAppName(appName, iconKey) {
    try {
      const { app } = require("electron");

      process.title = appName;

      if (process.platform === "darwin") {
        app.setName(appName);

        try {
          if (process.mainModule && process.mainModule.filename) {
            process.env.CFBundleName = appName.trim();
          }
        } catch (e) {
          // Silently fail
        }

        if (app.dock) {
          app.dock.setBadge("");
          setTimeout(() => {
            app.dock.setIcon(
              require("path").resolve(`assests/icons/${iconKey}.png`)
            );
          }, 50);
        }
      }

      app.setAppUserModelId(`${appName.trim()}-${iconKey}`);

      const windows = windowManager.windows;
      windows.forEach((window, type) => {
        if (window && !window.isDestroyed()) {
          const stealthTitle = appName.trim();
          window.setTitle(stealthTitle);
        }
      });

      const refreshTimes = [50, 100, 200, 500];
      refreshTimes.forEach((delay) => {
        setTimeout(() => {
          process.title = appName;
          if (process.platform === "darwin") {
            app.setName(appName);
          }
        }, delay);
      });

      logger.info("App name updated for stealth mode", {
        appName,
        processTitle: process.title,
        appGetName: app.getName(),
        iconKey,
        platform: process.platform,
      });
    } catch (error) {
      logger.error("Failed to update app name", { error: error.message });
    }
  }
}

new ApplicationController();
