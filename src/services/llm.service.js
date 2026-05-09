const https = require('https');
const logger = require('../core/logger').createServiceLogger('LLM');
const config = require('../core/config');
const { promptLoader } = require('../../prompt-loader');

const NVIDIA_API_BASE = 'https://integrate.api.nvidia.com/v1/chat/completions';
const DEFAULT_MODEL = 'mistralai/mistral-small-4-119b-2603';

class LLMService {
  constructor() {
    this.apiKey = null;
    this.isInitialized = false;
    this.requestCount = 0;
    this.errorCount = 0;
    this.model = DEFAULT_MODEL;

    this.initializeClient();
  }

  initializeClient() {
    this.apiKey = process.env.NVIDIA_API_KEY || config.getApiKey('NVIDIA');

    // Allow model override from config, but default to Mistral Small 4
    const configModel = config.get('llm.nvidia.model');
    if (configModel && configModel !== DEFAULT_MODEL) {
      logger.warn('Model override detected in config - forcing Mistral Small 4', {
        configModel,
        forcedModel: DEFAULT_MODEL
      });
    }
    // Always use Mistral Small 4 as specified
    this.model = DEFAULT_MODEL;

    if (!this.apiKey) {
      logger.warn('NVIDIA API key not configured', {
        keyExists: false
      });
      return;
    }

    this.isInitialized = true;
    const keyConfigured = !!this.apiKey;

    logger.info('NVIDIA NIM client initialized', {
      model: this.model,
      endpoint: NVIDIA_API_BASE,
      keyConfigured
    });
  }

  // ---------------------------------------------------------------------------
  // Public API methods
  // ---------------------------------------------------------------------------

  async processTextWithSkill(text, activeSkill, sessionMemory = [], programmingLanguage = null) {
    if (!this.isInitialized) {
      throw new Error('LLM service not initialized. Check NVIDIA API key configuration.');
    }

    const startTime = Date.now();
    this.requestCount++;

    try {
      logger.info('Processing text with LLM', {
        activeSkill,
        textLength: text.length,
        hasSessionMemory: sessionMemory.length > 0,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      const requestBody = this.buildTextRequestBody(text, activeSkill, sessionMemory, programmingLanguage);
      const response = await this.executeRequest(requestBody);

      logger.logPerformance('LLM text processing', startTime, {
        activeSkill,
        textLength: text.length,
        responseLength: response.length,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      return {
        response,
        metadata: {
          skill: activeSkill,
          programmingLanguage,
          processingTime: Date.now() - startTime,
          requestId: this.requestCount,
          usedFallback: false
        }
      };
    } catch (error) {
      this.errorCount++;
      logger.error('LLM processing failed', {
        error: error.message,
        activeSkill,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      if (config.get('llm.nvidia.fallbackEnabled') !== false) {
        return this.generateFallbackResponse(text, activeSkill);
      }

      throw error;
    }
  }

  async processScreenshotWithVision(imageOrQueue, prompt, activeSkill, sessionMemory = []) {
    const isQueue = Array.isArray(imageOrQueue);
    const imageCount = isQueue ? imageOrQueue.length : 1;

    if (!this.isInitialized) {
      throw new Error('LLM service not initialized. Check NVIDIA API key configuration.');
    }

    const startTime = Date.now();
    this.requestCount++;

    try {
      logger.info('Processing screenshots with vision', {
        activeSkill,
        promptLength: prompt.length,
        imageCount: imageCount,
        hasSessionMemory: sessionMemory.length > 0,
        requestId: this.requestCount
      });

      const requestBody = this.buildVisionRequestBody(imageOrQueue, prompt, activeSkill, sessionMemory);
      const response = await this.executeRequest(requestBody);

      logger.logPerformance('LLM vision processing', startTime, {
        activeSkill,
        promptLength: prompt.length,
        responseLength: response.length,
        requestId: this.requestCount
      });

      return {
        response,
        metadata: {
          skill: activeSkill,
          processingTime: Date.now() - startTime,
          requestId: this.requestCount,
          usedFallback: false,
          isVisionResponse: true
        }
      };
    } catch (error) {
      this.errorCount++;
      logger.error('LLM vision processing failed', {
        error: error.message,
        activeSkill,
        requestId: this.requestCount
      });

      if (config.get('llm.nvidia.fallbackEnabled') !== false) {
        return this.generateFallbackResponse(prompt, activeSkill);
      }

      throw error;
    }
  }

  async processTranscriptionWithIntelligentResponse(text, activeSkill, sessionMemory = [], programmingLanguage = null) {
    if (!this.isInitialized) {
      throw new Error('LLM service not initialized. Check NVIDIA API key configuration.');
    }

    const cleanText = text && typeof text === 'string' ? text.trim() : '';
    if (!cleanText) {
      throw new Error('Empty or invalid transcription text provided');
    }

    const startTime = Date.now();
    this.requestCount++;

    try {
      logger.info('Processing transcription with intelligent response', {
        activeSkill,
        textLength: cleanText.length,
        hasSessionMemory: sessionMemory.length > 0,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      const requestBody = this.buildTranscriptionRequestBody(cleanText, activeSkill, sessionMemory, programmingLanguage);
      const response = await this.executeRequest(requestBody);

      logger.logPerformance('LLM transcription processing', startTime, {
        activeSkill,
        textLength: cleanText.length,
        responseLength: response.length,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      return {
        response,
        metadata: {
          skill: activeSkill,
          programmingLanguage,
          processingTime: Date.now() - startTime,
          requestId: this.requestCount,
          usedFallback: false,
          isTranscriptionResponse: true
        }
      };
    } catch (error) {
      this.errorCount++;
      logger.error('LLM transcription processing failed', {
        error: error.message,
        activeSkill,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      if (config.get('llm.nvidia.fallbackEnabled') !== false) {
        return this.generateIntelligentFallbackResponse(cleanText, activeSkill);
      }

      throw error;
    }
  }

  updateApiKey(newApiKey) {
    process.env.NVIDIA_API_KEY = newApiKey;
    this.apiKey = newApiKey;
    this.isInitialized = !!newApiKey;

    logger.info('NVIDIA API key updated and client reinitialized', {
      isInitialized: this.isInitialized
    });
  }

  async testConnection() {
    if (!this.isInitialized) {
      return { success: false, error: 'Service not initialized' };
    }

    try {
      const requestBody = {
        model: this.model,
        messages: [
          { role: 'user', content: 'Test connection. Please respond with "OK".' }
        ],
        temperature: 0,
        max_tokens: 10
      };

      const startTime = Date.now();
      const response = await this.executeRequest(requestBody);
      const latency = Date.now() - startTime;

      logger.info('Connection test successful', {
        response,
        latency
      });

      return {
        success: true,
        response: response.trim(),
        latency
      };
    } catch (error) {
      const errorAnalysis = this.analyzeError(error);
      logger.error('Connection test failed', {
        error: error.message,
        errorAnalysis
      });

      return {
        success: false,
        error: error.message,
        errorAnalysis
      };
    }
  }

  getStats() {
    return {
      isInitialized: this.isInitialized,
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      successRate: this.requestCount > 0 ? ((this.requestCount - this.errorCount) / this.requestCount) * 100 : 0,
      model: this.model,
      provider: 'nvidia-nim',
      config: config.get('llm.nvidia')
    };
  }

  // ---------------------------------------------------------------------------
  // Request body builders
  // ---------------------------------------------------------------------------

  buildTextRequestBody(text, activeSkill, sessionMemory, programmingLanguage) {
    const messages = this.buildMessages(text, activeSkill, sessionMemory, programmingLanguage);

    return {
      model: this.model,
      messages,
      temperature: 0.7,
      max_tokens: 2048,
      top_p: 0.95
    };
  }

  buildVisionRequestBody(imageOrQueue, prompt, activeSkill, sessionMemory) {
    const systemPrompt = this.getSystemPrompt(activeSkill, null);
    const messages = [];

    // System message
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    // Session history
    const historyMessages = this.buildHistoryMessages(sessionMemory);
    messages.push(...historyMessages);

    // User message with images + text
    const userContent = [];
    
    // Add all images from queue
    const images = Array.isArray(imageOrQueue) ? imageOrQueue : [imageOrQueue];
    images.forEach((imgBase64, index) => {
      // Clean base64 if needed
      const cleanBase64 = imgBase64.includes('base64,') 
        ? imgBase64.split('base64,')[1] 
        : imgBase64;

      userContent.push({
        type: 'image_url',
        image_url: {
          url: `data:image/png;base64,${cleanBase64}`
        }
      });
    });

    // Add instructions
    userContent.push({
      type: 'text',
      text: `MULTI-SCREEN CAPTURE: I have provided ${images.length} images of the screen in sequence. Please combine the information from all these screenshots (which may represent a scrolled view of a long problem) and provide a comprehensive answer.\n\n${this.formatVisionPrompt(prompt, activeSkill)}`
    });

    messages.push({ role: 'user', content: userContent });

    return {
      model: this.model,
      messages,
      temperature: 0.7,
      max_tokens: 3072, // Increased for longer responses
      top_p: 0.95
    };
  }

  buildTranscriptionRequestBody(text, activeSkill, sessionMemory, programmingLanguage) {
    const messages = [];
    const intelligentPrompt = this.getIntelligentTranscriptionPrompt(activeSkill, programmingLanguage);

    // Try to get skill context from session manager
    let combinedSystemPrompt = intelligentPrompt;
    try {
      const sessionManager = require('../managers/session.manager');
      if (sessionManager && typeof sessionManager.getSkillContext === 'function') {
        const skillContext = sessionManager.getSkillContext(activeSkill, programmingLanguage);
        if (skillContext.skillPrompt) {
          combinedSystemPrompt = `${skillContext.skillPrompt}\n\n${intelligentPrompt}`;
        }
      }
    } catch {
      // Session manager not available, use intelligent prompt only
    }

    messages.push({ role: 'system', content: combinedSystemPrompt });

    // Try to get conversation history from session manager
    let historyAdded = false;
    try {
      const sessionManager = require('../managers/session.manager');
      if (sessionManager && typeof sessionManager.getConversationHistory === 'function') {
        const conversationHistory = sessionManager.getConversationHistory(10);
        const historyMessages = conversationHistory
          .filter(event => event.role !== 'system' && event.content && typeof event.content === 'string' && event.content.trim().length > 0)
          .slice(-8)
          .map(event => ({
            role: event.role === 'model' ? 'assistant' : 'user',
            content: event.content.trim()
          }))
          .filter(msg => msg.content.length > 0);

        messages.push(...historyMessages);
        historyAdded = true;
      }
    } catch {
      // Session manager not available
    }

    // Current transcription
    messages.push({ role: 'user', content: text });

    logger.debug('Built transcription request', {
      skill: activeSkill,
      programmingLanguage: programmingLanguage || 'not specified',
      historyAdded,
      totalMessages: messages.length,
      hasSystemPrompt: true
    });

    return {
      model: this.model,
      messages,
      temperature: 0.7,
      max_tokens: 2048,
      top_p: 0.95
    };
  }

  // ---------------------------------------------------------------------------
  // Message building helpers
  // ---------------------------------------------------------------------------

  buildMessages(text, activeSkill, sessionMemory, programmingLanguage) {
    const systemPrompt = this.getSystemPrompt(activeSkill, programmingLanguage);
    const messages = [];

    // System message
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    // Try to get conversation history from session manager
    let historyAdded = false;
    try {
      const sessionManager = require('../managers/session.manager');
      if (sessionManager && typeof sessionManager.getConversationHistory === 'function') {
        const conversationHistory = sessionManager.getConversationHistory(15);
        const historyMessages = this.buildHistoryMessagesFromConversation(conversationHistory);
        messages.push(...historyMessages);
        historyAdded = historyMessages.length > 0;
      }
    } catch {
      // Session manager not available
    }

    // Fallback: use sessionMemory array directly if no history from session manager
    if (!historyAdded && sessionMemory && sessionMemory.length > 0) {
      const historyFromMemory = this.buildHistoryMessages(sessionMemory);
      messages.push(...historyFromMemory);
    }

    // Current user message
    const formattedMessage = this.formatUserMessage(text, activeSkill);
    messages.push({ role: 'user', content: formattedMessage });

    logger.debug('Built text request messages', {
      skill: activeSkill,
      programmingLanguage: programmingLanguage || 'not specified',
      totalMessages: messages.length,
      hasSystemPrompt: !!systemPrompt,
      historyAdded
    });

    return messages;
  }

  buildHistoryMessages(conversationHistory) {
    if (!conversationHistory || !Array.isArray(conversationHistory)) {
      return [];
    }

    return conversationHistory
      .filter(event => {
        return event.role !== 'system' &&
               event.content &&
               typeof event.content === 'string' &&
               event.content.trim().length > 0;
      })
      .map(event => ({
        role: event.role === 'model' ? 'assistant' : 'user',
        content: event.content.trim()
      }))
      .filter(msg => msg.content.length > 0);
  }

  buildHistoryMessagesFromConversation(conversationHistory) {
    if (!conversationHistory || !Array.isArray(conversationHistory)) {
      return [];
    }

    return conversationHistory
      .filter(event => {
        return event.role !== 'system' &&
               event.content &&
               typeof event.content === 'string' &&
               event.content.trim().length > 0;
      })
      .map(event => ({
        role: event.role === 'model' ? 'assistant' : 'user',
        content: event.content.trim()
      }))
      .filter(msg => msg.content.length > 0);
  }

  getSystemPrompt(activeSkill, programmingLanguage) {
    // Try to get skill context from session manager first
    try {
      const sessionManager = require('../managers/session.manager');
      if (sessionManager && typeof sessionManager.getSkillContext === 'function') {
        const skillContext = sessionManager.getSkillContext(activeSkill, programmingLanguage);
        if (skillContext.skillPrompt) {
          return skillContext.skillPrompt;
        }
      }
    } catch {
      // Session manager not available
    }

    // Fallback: use promptLoader directly
    const requestComponents = promptLoader.getRequestComponents(
      activeSkill,
      '',
      [],
      programmingLanguage
    );

    if (requestComponents.skillPrompt) {
      return requestComponents.skillPrompt;
    }

    // Ultimate fallback
    return `You are a helpful AI assistant specialized in ${activeSkill}. Provide clear, concise, and accurate responses.`;
  }

  formatUserMessage(text, activeSkill) {
    return `Context: ${activeSkill.toUpperCase()} analysis request\n\nText to analyze:\n${text}`;
  }

  formatVisionPrompt(prompt, activeSkill) {
    return `Context: ${activeSkill.toUpperCase()} visual analysis request\n\n${prompt}`;
  }

  getIntelligentTranscriptionPrompt(activeSkill, programmingLanguage) {
    let prompt = `# Intelligent Transcription Response System

Assume you are asked a question in ${activeSkill.toUpperCase()} mode. Your job is to intelligently respond to question/message with appropriate brevity.
Assume you are in an interview and you need to perform best in ${activeSkill.toUpperCase()} mode.
Always respond to the point, do not repeat the question or unnecessary information which is not related to ${activeSkill}.`;

    if (programmingLanguage) {
      prompt += `\n\nCODING CONTEXT: When providing code examples or technical solutions, use ${programmingLanguage.toUpperCase()} as the primary programming language.`;
    }

    prompt += `

## Response Rules:

### If the transcription is casual conversation, greetings, or NOT related to ${activeSkill}:
- Respond with: "Yeah, I'm listening. Ask your question relevant to ${activeSkill}."
- Or similar brief acknowledgments like: "I'm here, what's your ${activeSkill} question?"

### If the transcription IS relevant to ${activeSkill} or is a follow-up question:
- Provide a comprehensive, detailed response
- Use bullet points, examples, and explanations
- Focus on actionable insights and complete answers
- Do not truncate or shorten your response

### Examples of casual/irrelevant messages:
- "Hello", "Hi there", "How are you?"
- "What's the weather like?"
- "I'm just testing this"
- Random conversations not related to ${activeSkill}

### Examples of relevant messages:
- Actual questions about ${activeSkill} concepts
- Follow-up questions to previous responses
- Requests for clarification on ${activeSkill} topics
- Problem-solving requests related to ${activeSkill}

## Response Format:
- Keep responses detailed
- Use bullet points for structured answers
- Be encouraging and helpful
- Stay focused on ${activeSkill}

Remember: Be intelligent about filtering - only provide detailed responses when the user actually needs help with ${activeSkill}.`;

    return prompt;
  }

  // ---------------------------------------------------------------------------
  // HTTP request execution with retry logic
  // ---------------------------------------------------------------------------

  async executeRequest(requestBody) {
    const maxRetries = config.get('llm.nvidia.maxRetries') || 3;
    const timeout = config.get('llm.nvidia.timeout') || 30000;

    logger.debug('Executing NVIDIA NIM request', {
      model: requestBody.model,
      messageCount: requestBody.messages.length,
      timeout,
      maxRetries
    });

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const responseText = await this.sendHttpsRequest(requestBody, timeout);

        if (!responseText || responseText.trim().length === 0) {
          throw new Error('Empty text content in NVIDIA NIM response');
        }

        logger.debug('NVIDIA NIM request successful', {
          attempt,
          responseLength: responseText.length
        });

        return responseText.trim();
      } catch (error) {
        const errorInfo = this.analyzeError(error);

        logger.warn(`NVIDIA NIM attempt ${attempt} failed`, {
          error: error.message,
          errorType: errorInfo.type,
          isNetworkError: errorInfo.isNetworkError,
          suggestedAction: errorInfo.suggestedAction,
          remainingAttempts: maxRetries - attempt
        });

        if (attempt === maxRetries) {
          const finalError = new Error(`NVIDIA NIM API failed after ${maxRetries} attempts: ${error.message}`);
          finalError.errorAnalysis = errorInfo;
          finalError.originalError = error;
          throw finalError;
        }

        // Exponential backoff with jitter
        const baseDelay = errorInfo.isNetworkError ? 2000 : 1000;
        const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000;

        logger.debug(`Waiting ${Math.round(delay)}ms before retry ${attempt + 1}`, {
          baseDelay,
          isNetworkError: errorInfo.isNetworkError
        });

        await this.delay(delay);
      }
    }
  }

  sendHttpsRequest(requestBody, timeout) {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify(requestBody);

      const url = new URL(NVIDIA_API_BASE);

      const options = {
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Length': Buffer.byteLength(postData),
          'User-Agent': this.getUserAgent()
        },
        timeout
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            if (res.statusCode === 401 || res.statusCode === 403) {
              reject(new Error(`Authentication error (HTTP ${res.statusCode}): Invalid or missing NVIDIA API key`));
              return;
            }

            if (res.statusCode === 429) {
              reject(new Error('Rate limit exceeded: Too many requests to NVIDIA NIM API'));
              return;
            }

            if (res.statusCode !== 200) {
              reject(new Error(`HTTP ${res.statusCode}: ${data}`));
              return;
            }

            const response = JSON.parse(data);

            // OpenAI-compatible chat completions response format
            if (!response.choices || !response.choices[0] || !response.choices[0].message) {
              reject(new Error('Invalid response structure from NVIDIA NIM API'));
              return;
            }

            const text = response.choices[0].message.content;

            if (!text || text.trim().length === 0) {
              reject(new Error('Empty text content in NVIDIA NIM response'));
              return;
            }

            logger.debug('HTTPS request successful', {
              responseLength: text.length,
              statusCode: res.statusCode,
              model: response.model || this.model,
              usage: response.usage || null
            });

            resolve(text.trim());
          } catch (parseError) {
            reject(new Error(`Failed to parse NVIDIA NIM response: ${parseError.message}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`NVIDIA NIM request failed: ${error.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('NVIDIA NIM request timeout'));
      });

      req.write(postData);
      req.end();
    });
  }

  // ---------------------------------------------------------------------------
  // Error analysis
  // ---------------------------------------------------------------------------

  analyzeError(error) {
    const errorMessage = error.message.toLowerCase();

    // Network connectivity errors
    if (errorMessage.includes('fetch failed') ||
        errorMessage.includes('network error') ||
        errorMessage.includes('enotfound') ||
        errorMessage.includes('econnrefused') ||
        errorMessage.includes('econnreset') ||
        errorMessage.includes('timeout')) {
      return {
        type: 'NETWORK_ERROR',
        isNetworkError: true,
        suggestedAction: 'Check internet connection and firewall settings'
      };
    }

    // API key errors
    if (errorMessage.includes('authentication error') ||
        errorMessage.includes('unauthorized') ||
        errorMessage.includes('invalid api key') ||
        errorMessage.includes('forbidden')) {
      return {
        type: 'AUTH_ERROR',
        isNetworkError: false,
        suggestedAction: 'Verify NVIDIA API key configuration'
      };
    }

    // Rate limiting
    if (errorMessage.includes('rate limit') ||
        errorMessage.includes('too many requests') ||
        errorMessage.includes('quota')) {
      return {
        type: 'RATE_LIMIT_ERROR',
        isNetworkError: false,
        suggestedAction: 'Wait before retrying or check API quota'
      };
    }

    // Timeout errors
    if (errorMessage.includes('request timeout')) {
      return {
        type: 'TIMEOUT_ERROR',
        isNetworkError: true,
        suggestedAction: 'Check network latency or increase timeout'
      };
    }

    return {
      type: 'UNKNOWN_ERROR',
      isNetworkError: false,
      suggestedAction: 'Check logs for more details'
    };
  }

  // ---------------------------------------------------------------------------
  // Fallback responses
  // ---------------------------------------------------------------------------

  generateFallbackResponse(text, activeSkill) {
    logger.info('Generating fallback response', { activeSkill });

    const fallbackResponses = {
      'dsa': 'This appears to be a data structures and algorithms problem. Consider breaking it down into smaller components and identifying the appropriate algorithm or data structure to use.',
      'system-design': 'For this system design question, consider scalability, reliability, and the trade-offs between different architectural approaches.',
      'programming': 'This looks like a programming challenge. Focus on understanding the requirements, edge cases, and optimal time/space complexity.',
      'default': 'I can help analyze this content. Please ensure your NVIDIA API key is properly configured for detailed analysis.'
    };

    const response = fallbackResponses[activeSkill] || fallbackResponses.default;

    return {
      response,
      metadata: {
        skill: activeSkill,
        processingTime: 0,
        requestId: this.requestCount,
        usedFallback: true
      }
    };
  }

  generateIntelligentFallbackResponse(text, activeSkill) {
    logger.info('Generating intelligent fallback response for transcription', { activeSkill });

    const skillKeywords = {
      'dsa': ['algorithm', 'data structure', 'array', 'tree', 'graph', 'sort', 'search', 'complexity', 'big o'],
      'programming': ['code', 'function', 'variable', 'class', 'method', 'bug', 'debug', 'syntax'],
      'system-design': ['scalability', 'database', 'architecture', 'microservice', 'load balancer', 'cache'],
      'behavioral': ['interview', 'experience', 'situation', 'leadership', 'conflict', 'team'],
      'sales': ['customer', 'deal', 'negotiation', 'price', 'revenue', 'prospect'],
      'presentation': ['slide', 'audience', 'public speaking', 'presentation', 'nervous'],
      'data-science': ['data', 'model', 'machine learning', 'statistics', 'analytics', 'python', 'pandas'],
      'devops': ['deployment', 'ci/cd', 'docker', 'kubernetes', 'infrastructure', 'monitoring'],
      'negotiation': ['negotiate', 'compromise', 'agreement', 'terms', 'conflict resolution']
    };

    const textLower = text.toLowerCase();
    const relevantKeywords = skillKeywords[activeSkill] || [];
    const hasRelevantKeywords = relevantKeywords.some(keyword => textLower.includes(keyword));

    const questionIndicators = ['how', 'what', 'why', 'when', 'where', 'can you', 'could you', 'should i', '?'];
    const seemsLikeQuestion = questionIndicators.some(indicator => textLower.includes(indicator));

    let response;
    if (hasRelevantKeywords || seemsLikeQuestion) {
      response = `I'm having trouble processing that right now, but it sounds like a ${activeSkill} question. Could you rephrase or ask more specifically about what you need help with?`;
    } else {
      response = `Yeah, I'm listening. Ask your question relevant to ${activeSkill}.`;
    }

    return {
      response,
      metadata: {
        skill: activeSkill,
        processingTime: 0,
        requestId: this.requestCount,
        usedFallback: true,
        isTranscriptionResponse: true
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Utility methods
  // ---------------------------------------------------------------------------

  getUserAgent() {
    try {
      if (typeof navigator !== 'undefined' && navigator.userAgent) {
        return navigator.userAgent;
      }
      return `Node.js/${process.version} (${process.platform}; ${process.arch})`;
    } catch {
      return 'Unknown';
    }
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new LLMService();
