const logger = require('../core/logger').createServiceLogger('SESSION');
const config = require('../core/config');
const { promptLoader } = require('../../prompt-loader');

class SessionManager {
  constructor() {
    this.sessionMemory = [];
    this.maxSize = config.get('session.maxMemorySize');
    this.currentSkill = 'programming';
    this.isInitialized = false;
    this.initializeWithSkillPrompts();
  }

  setActiveSkill(skill) {
    this.currentSkill = skill;
    this.addEvent('skill_change', { newSkill: skill });
  }

  addUserInput(text, source) {
    this.sessionMemory.push({
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
      source
    });
    this.cleanupIfNeeded();
  }

  addModelResponse(text, metadata) {
    this.sessionMemory.push({
      role: 'model',
      content: text,
      timestamp: new Date().toISOString(),
      metadata
    });
    this.cleanupIfNeeded();
  }

  addOCREvent(text, metadata) {
    this.sessionMemory.push({
      role: 'ocr',
      content: text,
      timestamp: new Date().toISOString(),
      metadata
    });
    this.cleanupIfNeeded();
  }

  async initializeWithSkillPrompts() {
    if (this.isInitialized) return;
    promptLoader.loadPrompts();
    const skills = promptLoader.getAvailableSkills();
    for (const skill of skills) {
      const prompt = promptLoader.getSkillPrompt(skill);
      if (prompt) {
        this.sessionMemory.push({
          role: 'system',
          content: prompt,
          timestamp: new Date().toISOString(),
          skill
        });
      }
    }
    this.isInitialized = true;
    logger.info('Session memory initialized', { skillCount: skills.length });
  }

  cleanupIfNeeded() {
    if (this.sessionMemory.length > this.maxSize) {
      const toKeep = Math.floor(this.maxSize * 0.1);
      this.sessionMemory = [
        ...this.sessionMemory.slice(0, toKeep),
        ...this.sessionMemory.slice(-(this.maxSize - toKeep))
      ];
    }
  }

  getOptimizedHistory() {
    return this.sessionMemory.slice(-10);
  }

  getMemoryUsage() {
    return {
      eventCount: this.sessionMemory.length,
      maxSize: this.maxSize
    };
  }

  clear() {
    this.sessionMemory = [];
    this.isInitialized = false;
    this.initializeWithSkillPrompts();
  }

  addEvent(action, details = {}) {
    this.sessionMemory.push({
      role: 'system',
      content: action,
      details,
      timestamp: new Date().toISOString()
    });
    this.cleanupIfNeeded();
  }
}

module.exports = new SessionManager();