const path = require('path');
const os = require('os');
const fs = require('fs');

class ConfigManager {
  constructor() {
    this.env = process.env.NODE_ENV || 'development';
    this.appDataDir = path.join(os.homedir(), '.Vysper');
    this.configFilePath = path.join(this.appDataDir, 'config.json');
    this.loadConfiguration();
  }

  loadConfiguration() {
    this.config = {
      app: {
        name: 'Vysper',
        version: '2.0.0',
        processTitle: 'Vysper',
        dataDir: this.appDataDir,
        isDevelopment: this.env === 'development',
        isProduction: this.env === 'production'
      },
      
      window: {
        defaultWidth: 400,
        defaultHeight: 600,
        minWidth: 300,
        minHeight: 400,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          enableRemoteModule: false,
          preload: path.join(__dirname, '../../preload.js')
        }
      },

      ocr: {
        language: 'eng',
        tempDir: os.tmpdir(),
        cleanupDelay: 5000
      },

      llm: {
        nvidia: {
          model: 'mistralai/mistral-small-4-119b-2603',
          endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions',
          maxRetries: 3,
          timeout: 60000,
          fallbackEnabled: true
        }
      },

      autotype: {
        delay: 3000,
        wpm: 45,
        enableTypos: true
      },

      session: {
        maxMemorySize: 1000,
        compressionThreshold: 500,
        clearOnRestart: false
      },

      stealth: {
        hideFromDock: true,
        noAttachConsole: true,
        disguiseProcess: true,
        pipewireExclusion: true
      }
    };

    // Load persisted settings from disk, overriding defaults
    this.loadPersistedSettings();
  }

  /**
   * Load settings from ~/.Vysper/config.json
   * This allows the model, API key, and other settings to persist across restarts.
   */
  loadPersistedSettings() {
    try {
      // Ensure the config directory exists
      if (!fs.existsSync(this.appDataDir)) {
        fs.mkdirSync(this.appDataDir, { recursive: true });
      }

      if (fs.existsSync(this.configFilePath)) {
        const savedConfig = JSON.parse(fs.readFileSync(this.configFilePath, 'utf8'));

        // Deep merge saved config into defaults
        if (savedConfig.llm && savedConfig.llm.nvidia) {
          if (savedConfig.llm.nvidia.model) {
            this.config.llm.nvidia.model = savedConfig.llm.nvidia.model;
          }
          if (savedConfig.llm.nvidia.apiKey) {
            // Restore API key from config file
            process.env.NVIDIA_API_KEY = savedConfig.llm.nvidia.apiKey;
          }
        }

        if (savedConfig.autotype) {
          if (savedConfig.autotype.delay !== undefined) {
            this.config.autotype.delay = savedConfig.autotype.delay;
          }
          if (savedConfig.autotype.wpm !== undefined) {
            this.config.autotype.wpm = savedConfig.autotype.wpm;
          }
        }

        if (savedConfig.app) {
          if (savedConfig.app.activeSkill) {
            this.config.app.activeSkill = savedConfig.app.activeSkill;
          }
          if (savedConfig.app.codingLanguage) {
            this.config.app.codingLanguage = savedConfig.app.codingLanguage;
          }
          if (savedConfig.app.appIcon) {
            this.config.app.appIcon = savedConfig.app.appIcon;
          }
        }

        logger_debug('Settings loaded from disk', { path: this.configFilePath });
      }
    } catch (error) {
      // Silently ignore config file errors - use defaults
      console.warn('Failed to load persisted settings:', error.message);
    }
  }

  /**
   * Persist current settings to ~/.Vysper/config.json
   */
  persistSettings(settings) {
    try {
      if (!fs.existsSync(this.appDataDir)) {
        fs.mkdirSync(this.appDataDir, { recursive: true });
      }

      // Read existing config or start fresh
      let savedConfig = {};
      if (fs.existsSync(this.configFilePath)) {
        try {
          savedConfig = JSON.parse(fs.readFileSync(this.configFilePath, 'utf8'));
        } catch {
          savedConfig = {};
        }
      }

      // Update with new settings
      if (settings.nvidiaKey) {
        if (!savedConfig.llm) savedConfig.llm = {};
        if (!savedConfig.llm.nvidia) savedConfig.llm.nvidia = {};
        savedConfig.llm.nvidia.apiKey = settings.nvidiaKey;
      }
      if (settings.autotypeDelay !== undefined) {
        if (!savedConfig.autotype) savedConfig.autotype = {};
        savedConfig.autotype.delay = parseInt(settings.autotypeDelay, 10);
      }
      if (settings.autotypeWpm !== undefined) {
        if (!savedConfig.autotype) savedConfig.autotype = {};
        savedConfig.autotype.wpm = parseInt(settings.autotypeWpm, 10);
      }
      if (settings.activeSkill) {
        if (!savedConfig.app) savedConfig.app = {};
        savedConfig.app.activeSkill = settings.activeSkill;
      }
      if (settings.codingLanguage) {
        if (!savedConfig.app) savedConfig.app = {};
        savedConfig.app.codingLanguage = settings.codingLanguage;
      }
      if (settings.selectedIcon || settings.appIcon) {
        if (!savedConfig.app) savedConfig.app = {};
        savedConfig.app.appIcon = settings.selectedIcon || settings.appIcon;
      }
      if (settings.llmProvider) {
        if (!savedConfig.llm) savedConfig.llm = {};
        savedConfig.llm.provider = settings.llmProvider;
      }

      fs.writeFileSync(this.configFilePath, JSON.stringify(savedConfig, null, 2), 'utf8');
      console.log('Settings saved to disk', { path: this.configFilePath });
    } catch (error) {
      console.error('Failed to persist settings:', error.message);
    }
  }

  get(keyPath) {
    return keyPath.split('.').reduce((obj, key) => obj?.[key], this.config);
  }

  set(keyPath, value) {
    const keys = keyPath.split('.');
    const lastKey = keys.pop();
    const target = keys.reduce((obj, key) => obj[key] = obj[key] || {}, this.config);
    target[lastKey] = value;
  }

  getApiKey(service) {
    // Check environment variable first, then config
    const envKey = `${service.toUpperCase()}_API_KEY`;
    if (process.env[envKey]) {
      return process.env[envKey];
    }
    // Check persisted config
    return this.get(`llm.nvidia.apiKey`);
  }

  isFeatureEnabled(feature) {
    return this.get(`features.${feature}`) !== false;
  }
}

function logger_debug(msg, meta) {
  // Simple debug logger that works before logger is fully initialized
  try {
    console.log(`[CONFIG] ${msg}`, meta || '');
  } catch {}
}

module.exports = new ConfigManager(); 
