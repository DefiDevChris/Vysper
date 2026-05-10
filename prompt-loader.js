const fs = require('fs');
const path = require('path');

class PromptLoader {
  constructor() {
    this.prompts = new Map();
    this.promptsLoaded = false;
    this.skillsRequiringProgrammingLanguage = ['programming', 'dsa', 'devops', 'system-design', 'data-science'];
  }

  loadPrompts() {
    if (this.promptsLoaded) return;
    const promptsDir = path.join(__dirname, 'prompts');
    try {
      const files = fs.readdirSync(promptsDir);
      for (const file of files) {
        if (file.endsWith('.md')) {
          const skillName = path.basename(file, '.md');
          this.prompts.set(skillName, fs.readFileSync(path.join(promptsDir, file), 'utf8'));
        }
      }
      this.promptsLoaded = true;
    } catch (error) {
      console.error('Error loading skill prompts:', error);
    }
  }

  getSkillPrompt(skillName, programmingLanguage = null) {
    if (!this.promptsLoaded) this.loadPrompts();
    const normalized = this.normalizeSkillName(skillName);
    let prompt = this.prompts.get(normalized);
    if (prompt && programmingLanguage && this.skillsRequiringProgrammingLanguage.includes(normalized)) {
      prompt += `\n\nUse ${programmingLanguage.toUpperCase()} as the primary programming language.`;
    }
    return prompt || null;
  }

  getRequestComponents(skillName) {
    if (!this.promptsLoaded) this.loadPrompts();
    return {
      skillPrompt: this.getSkillPrompt(skillName),
      requiresProgrammingLanguage: this.skillsRequiringProgrammingLanguage.includes(this.normalizeSkillName(skillName))
    };
  }

  normalizeSkillName(skillName) {
    if (!skillName) return 'general';
    const normalized = skillName.toLowerCase().trim();
    const map = {
      'data-structures': 'dsa', 'algorithms': 'dsa', 'data-structures-algorithms': 'dsa',
      'behavioral-interview': 'behavioral', 'behavior': 'behavioral',
      'selling': 'sales', 'business-development': 'sales',
      'presentations': 'presentation', 'public-speaking': 'presentation',
      'datascience': 'data-science', 'machine-learning': 'data-science', 'ml': 'data-science',
      'coding': 'programming', 'software-development': 'programming', 'development': 'programming',
      'dev-ops': 'devops', 'infrastructure': 'devops',
      'systems-design': 'system-design', 'architecture': 'system-design', 'distributed-systems': 'system-design',
      'negotiating': 'negotiation', 'conflict-resolution': 'negotiation'
    };
    return map[normalized] || normalized;
  }

  requiresProgrammingLanguage(skillName) {
    return this.skillsRequiringProgrammingLanguage.includes(this.normalizeSkillName(skillName));
  }

  getAvailableSkills() {
    if (!this.promptsLoaded) this.loadPrompts();
    return Array.from(this.prompts.keys());
  }

  resetSession() {
    // No-op: removed tracking state
  }
}

const promptLoader = new PromptLoader();
module.exports = {
  PromptLoader,
  promptLoader
};