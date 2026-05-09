const { contextBridge, ipcRenderer } = require('electron')

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Screenshot capture
  takeScreenshot: () => ipcRenderer.invoke('take-screenshot'),
  processScreenshotData: (data) => ipcRenderer.invoke('process-screenshot-data', data),
  logErrorToMain: (data) => ipcRenderer.invoke('log-error-to-main', data),
  
  // Auto-type
  startAutotype: (text, delay) => ipcRenderer.invoke('start-autotype', text, delay),
  cancelAutotype: () => ipcRenderer.invoke('cancel-autotype'),
  getAutotypeStatus: () => ipcRenderer.invoke('get-autotype-status'),
  setAutotypeDelay: (delay) => ipcRenderer.invoke('set-autotype-delay', delay),
  setAutotypeWpm: (wpm) => ipcRenderer.invoke('set-autotype-wpm', wpm),
  
  // Window management
  showAllWindows: () => ipcRenderer.invoke('show-all-windows'),
  hideAllWindows: () => ipcRenderer.invoke('hide-all-windows'),
  enableWindowInteraction: () => ipcRenderer.invoke('enable-window-interaction'),
  disableWindowInteraction: () => ipcRenderer.invoke('disable-window-interaction'),
  switchToChat: () => ipcRenderer.invoke('switch-to-chat'),
  switchToSkills: () => ipcRenderer.invoke('switch-to-skills'),
  resizeWindow: (width, height) => ipcRenderer.invoke('resize-window', { width, height }),
  moveWindow: (deltaX, deltaY, windowKey) => ipcRenderer.invoke('move-window', { deltaX, deltaY, windowKey }),
  getWindowStats: () => ipcRenderer.invoke('get-window-stats'),
  
  // Session memory
  getSessionHistory: () => ipcRenderer.invoke('get-session-history'),
  getLLMSessionHistory: () => ipcRenderer.invoke('get-llm-session-history'),
  clearSessionMemory: () => ipcRenderer.invoke('clear-session-memory'),
  formatSessionHistory: () => ipcRenderer.invoke('format-session-history'),
  sendChatMessage: (text) => ipcRenderer.invoke('send-chat-message', text),
  getSkillPrompt: (skillName) => ipcRenderer.invoke('get-skill-prompt', skillName),
  
  // NVIDIA NIM API configuration
  setNvidiaApiKey: (apiKey) => ipcRenderer.invoke('set-nvidia-api-key', apiKey),
  getNvidiaStatus: () => ipcRenderer.invoke('get-nvidia-status'),
  testNvidiaConnection: () => ipcRenderer.invoke('test-nvidia-connection'),
  
  // Settings
  showSettings: () => ipcRenderer.invoke('show-settings'),
  hideSettings: () => ipcRenderer.invoke('hide-settings'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  updateAppIcon: (iconKey) => ipcRenderer.invoke('update-app-icon', iconKey),
  updateActiveSkill: (skill) => ipcRenderer.invoke('update-active-skill', skill),
  restartAppForStealth: () => ipcRenderer.invoke('restart-app-for-stealth'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  quit: () => {
    try {
      ipcRenderer.send('quit-app');
      setTimeout(() => {
        require('electron').app.quit();
      }, 100);
    } catch (error) {
      console.error('Error in quit:', error);
    }
  },
  
  // LLM window specific methods
  expandLlmWindow: (contentMetrics) => ipcRenderer.invoke('expand-llm-window', contentMetrics),
  resizeLlmWindowForContent: (contentMetrics) => ipcRenderer.invoke('resize-llm-window-for-content', contentMetrics),
  
  // Event listeners
  onOcrCompleted: (callback) => ipcRenderer.on('ocr-completed', callback),
  onOcrError: (callback) => ipcRenderer.on('ocr-error', callback),
  onLlmResponse: (callback) => ipcRenderer.on('llm-response', callback),
  onLlmError: (callback) => ipcRenderer.on('llm-error', callback),
  onDisplayLlmResponse: (callback) => ipcRenderer.on('display-llm-response', callback),
  onShowLoading: (callback) => ipcRenderer.on('show-loading', callback),
  onSkillChanged: (callback) => ipcRenderer.on('skill-changed', callback),
  onInteractionModeChanged: (callback) => ipcRenderer.on('interaction-mode-changed', callback),
  onSessionCleared: (callback) => ipcRenderer.on('session-cleared', callback),
  onAutotypeStatusChanged: (callback) => ipcRenderer.on('autotype-status-changed', callback),
  onTriggerStreamCapture: (callback) => ipcRenderer.on('trigger-stream-capture', callback),
  
  // Generic receive method
  receive: (channel, callback) => ipcRenderer.on(channel, callback),
  
  // Remove listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
})

contextBridge.exposeInMainWorld('api', {
    send: (channel, data) => {
        let validChannels = [
            'close-settings',
            'quit-app',
            'save-settings',
            'toggle-interaction-mode',
            'update-skill',
            'window-loaded'
        ];
        if (validChannels.includes(channel)) {
            ipcRenderer.send(channel, data);
        } else {
            console.warn('Invalid IPC channel:', channel);
        }
    },
    receive: (channel, func) => {
        let validChannels = [
            'load-settings',
            'interaction-mode-changed',
            'skill-updated',
            'update-skill',
        ];
        if (validChannels.includes(channel)) {
            ipcRenderer.on(channel, (event, ...args) => func(...args));
        }
    }
}); 
