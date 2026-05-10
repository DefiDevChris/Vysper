const path = require('path');
const fs = require('fs');
const os = require('os');

class ConfigManager {
  constructor() {
    this.appDataDir = path.join(os.homedir(), '.Vysper');
    this.configFilePath = path.join(this.appDataDir, 'config.json');
    this.config = this.loadConfiguration();
  }

  loadConfiguration() {
    const defaults = {
      app: {
        name: 'Vysper',
        version: '2.0.0',
        processTitle: 'Vysper',
        dataDir: this.appDataDir
      },
      window: {
        minWidth: 300,
        minHeight: 400,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: path.join(__dirname, '../../preload.js')
        }
      },
      ocr: { language: 'eng', tempDir: os.tmpdir() },
      llm: {
        nvidia: {
          model: 'moonshotai/kimi-k2.6',
          endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions',
          maxRetries: 3,
          timeout: 30000,
          visionTimeout: 120000,
          fallbackEnabled: true
        }
      },
      autotype: { delay: 3000 },
      session: { maxMemorySize: 1000, compressionThreshold: 500 },
      stealth: { hideFromDock: true, noAttachConsole: true, disguiseProcess: true }
    };

    try {
      if (fs.existsSync(this.configFilePath)) {
        const saved = JSON.parse(fs.readFileSync(this.configFilePath, 'utf8'));
        if (saved.llm?.nvidia?.apiKey) {
          process.env.NVIDIA_API_KEY = saved.llm.nvidia.apiKey;
        }
        return this.mergeDeep(defaults, saved);
      }
    } catch (e) {
      console.warn('Failed to load config:', e.message);
    }

    return defaults;
  }

  mergeDeep(target, source) {
    const result = { ...target };
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.mergeDeep(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }

  get(keyPath) {
    return keyPath.split('.').reduce((obj, key) => obj?.[key], this.config);
  }

  set(keyPath, value) {
    const keys = keyPath.split('.');
    const lastKey = keys.pop();
    const target = keys.reduce((obj, key) => {
      if (!obj[key]) obj[key] = {};
      return obj[key];
    }, this.config);
    target[lastKey] = value;
  }

  getApiKey(service) {
    return process.env[`${service.toUpperCase()}_API_KEY`] || this.get('llm.nvidia.apiKey');
  }

  persistSettings(settings) {
    try {
      if (!fs.existsSync(this.appDataDir)) {
        fs.mkdirSync(this.appDataDir, { recursive: true });
      }
      const current = fs.existsSync(this.configFilePath)
        ? JSON.parse(fs.readFileSync(this.configFilePath, 'utf8'))
        : {};
      if (settings.nvidiaKey) this.set('llm.nvidia.apiKey', settings.nvidiaKey);
      if (settings.autotypeDelay !== undefined) this.set('autotype.delay', parseInt(settings.autotypeDelay, 10));
      fs.writeFileSync(this.configFilePath, JSON.stringify(this.config, null, 2));
    } catch (error) {
      console.error('Failed to persist settings:', error.message);
    }
  }
}

module.exports = new ConfigManager();
