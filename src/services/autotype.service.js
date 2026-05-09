const { keyboard, Key } = require('@nut-tree-fork/nut-js');
const logger = require('../core/logger').createServiceLogger('AUTOTYPE');

// Using the exported keyboard instance directly from the package


// Characters that require Shift to be held
const SHIFT_CHAR_MAP = {
    '!': '1', '@': '2', '#': '3', '$': '4', '%': '5',
    '^': '6', '&': '7', '*': '8', '(': '9', ')': '0',
    '_': '-', '+': '=', '{': '[', '}': ']', '|': '\\',
    ':': ';', '"': "'", '<': ',', '>': '.', '?': '/',
    '~': '`'
};

// Punctuation that triggers longer breaks
const LONG_BREAK_PUNCTUATION = new Set(['.', '!', '?', ';', ':']);
// Comma triggers medium breaks
const MEDIUM_BREAK_PUNCTUATION = new Set([',']);

/**
 * AutoTypeService - Human-like auto-typing using @nut-tree-fork/nut-js
 *
 * Simulates realistic typing with variable speed, micro-pauses,
 * punctuation breaks, and optional typo simulation.
 */
class AutoTypeService {
    constructor() {
        this.isTyping = false;
        this.isCancelled = false;
        this.typingDelay = 3000; // 3 seconds default delay before typing starts
        this.wpm = 65;           // Increased base speed
        this.currentText = null;
        this.typingPromise = null;
        this.lastCharWasNewline = true;
        this.burstRemaining = 0; // Number of characters left in current fast burst
        this.burstSpeedMultiplier = 1.0;

        // Optimize for our custom human-delay logic
        try {
            keyboard.config.autoDelayMs = 0;
        } catch (e) {
            logger.debug('Could not set keyboard autoDelayMs', { error: e.message });
        }
    }

    /**
     * Main method to type text with a configurable delay before starting.
     *
     * @param {string} text - The text to type
     * @param {number|null} delay - Optional delay in ms before typing starts (defaults to this.typingDelay)
     * @returns {Promise<{success: boolean, typedLength: number}>}
     */
    async typeText(text, delay = null) {
        if (this.isTyping) {
            throw new Error('Already typing. Cancel the current operation before starting a new one.');
        }

        if (typeof text !== 'string' || text.length === 0) {
            throw new Error('Text must be a non-empty string.');
        }

        this.isTyping = true;
        this.isCancelled = false;
        this.currentText = text;

        const effectiveDelay = delay !== null ? delay : this.typingDelay;

        logger.info('Auto-type scheduled', {
            textLength: text.length,
            delay: effectiveDelay,
            wpm: this.wpm
        });

        this.typingPromise = (async () => {
            try {
                // Wait for the initial delay, checking for cancellation
                if (effectiveDelay > 0) {
                    logger.info(`Starting in ${Math.round(effectiveDelay / 1000)}s... (Click outside or press Cancel to abort)`);
                    await this._delay(effectiveDelay);
                }

                logger.info('Auto-type beginning execution');

                // Perform the actual typing
                await this._typeWithHumanVariations(text);

                this.isTyping = false;
                logger.info('Auto-type completed', { typedLength: text.length });

                return { success: true, typedLength: text.length };
            } catch (error) {
                this.isTyping = false;

                if (error.message === 'Typing cancelled') {
                    logger.info('Auto-type was cancelled', { textLength: text.length });
                    throw error;
                }

                logger.error('Auto-type failed', {
                    error: error.message,
                    stack: error.stack
                });
                throw error;
            } finally {
                this.typingPromise = null;
            }
        })();

        return this.typingPromise;
    }

    /**
     * Types text character by character with human-like variations.
     *
     * @param {string} text - The text to type
     * @private
     */
    async _typeWithHumanVariations(text) {
        // Base delay per character derived from WPM
        // Standard: 1 word = 5 characters, so chars/sec = (wpm * 5) / 60
        const baseDelayPerChar = (60 / (this.wpm * 5)) * 1000;

        let charIndex = 0;
        let wordCharCount = 0; // Track characters within current word for typo simulation

        while (charIndex < text.length) {
            // Check cancellation before each keystroke
            if (this.isCancelled) {
                throw new Error('Typing cancelled');
            }

            const char = text[charIndex];
            const prevChar = charIndex > 0 ? text[charIndex - 1] : null;

            // Typo simulation: 10% chance at the start of each new word
            const isNewWord = char !== ' ' && (prevChar === ' ' || charIndex === 0);
            if (isNewWord && wordCharCount === 0 && this._shouldSimulateTypo()) {
                await this._simulateTypo(char, baseDelayPerChar);
                // After typo correction, continue to type the actual character below
            }

            // Type the actual character
            await this._typeCharacter(char);

            // --- ADVANCED HUMAN-LIKE DELAY CALCULATION ---
            
            // 1. BURST LOGIC: Humans type in small clusters (3-9 characters)
            if (this.burstRemaining <= 0) {
                this.burstRemaining = Math.floor(Math.random() * 7) + 3; // New burst size
                this.burstSpeedMultiplier = 0.5 + (Math.random() * 0.9); // 0.5x (fast) to 1.4x (slow)
            }
            this.burstRemaining--;

            // 2. BASE DELAY: Target 65-70 WPM with burst scaling
            let delay = (60000 / (70 * 5)) * this.burstSpeedMultiplier;

            // 3. RANDOM MICRO-VARIANCE: 20% random swing
            delay *= (0.9 + Math.random() * 0.2);

            // 4. CONTEXTUAL PAUSES: Natural breaks
            if (char === ' ') {
                // End of word pause: 100-300ms
                delay += 100 + (Math.random() * 200);
                
                // 8% chance of a "thinking" pause between words: 0.5s - 1.2s
                if (Math.random() < 0.08) {
                    delay += 500 + (Math.random() * 700);
                }
                wordCharCount = 0;
            } else if (['.', ',', '(', ')', '{', '}', '[', ']', ':', ';', '=', '+', '-', '*', '/'].includes(char)) {
                // Punctuation/Operator pause: 150-400ms
                delay += 150 + (Math.random() * 250);
            } else if (char === '\n' || char === '\r') {
                // End of line/block pause: 600ms - 1.5s
                delay += 600 + (Math.random() * 900);
            } else {
                wordCharCount++;
            }

            // 1% chance of a long "mental block" pause: 1.5s - 3s
            if (Math.random() < 0.01) {
                delay += 1500 + (Math.random() * 1500);
            }

            await this._delay(delay);
            charIndex++;
        }
    }

    /**
     * Types a single character using nut-js keyboard.
     * Handles special keys (Enter, Tab) and shifted characters.
     *
     * @param {string} char - The character to type
     * @private
     */
    async _typeCharacter(char) {
        // Handle special keys
        if (char === '\n' || char === '\r') {
            await keyboard.pressKey(Key.Enter);
            await keyboard.releaseKey(Key.Enter);
            
            // Wait a tiny bit for the editor to auto-indent
            await new Promise(r => setTimeout(r, 20));
            
            // CRITICAL: Clear the editor's auto-indentation by pressing Home
            // This ensures our typed spaces from the AI are the ONLY spaces used.
            await keyboard.pressKey(Key.Home);
            await keyboard.releaseKey(Key.Home);
            
            this.lastCharWasNewline = true;
            return;
        }

        // If we just started a new line, we might need to handle leading spaces specially
        if (this.lastCharWasNewline) {
            if (char !== ' ' && char !== '\t') {
                this.lastCharWasNewline = false;
            }
        }

        if (char === '\t') {
            await keyboard.pressKey(Key.Tab);
            await keyboard.releaseKey(Key.Tab);
            return;
        }

        // Handle shifted characters (uppercase letters and special symbols)
        const isUppercase = char >= 'A' && char <= 'Z';
        const shiftMapped = SHIFT_CHAR_MAP[char];

        if (isUppercase) {
            // Uppercase letter: hold Shift + type lowercase
            await keyboard.pressKey(Key.LeftShift);
            await keyboard.pressKey(Key[char]);
            await keyboard.releaseKey(Key[char]);
            await keyboard.releaseKey(Key.LeftShift);
        } else if (shiftMapped) {
            // Shifted symbol: hold Shift + type the base key
            const baseKey = this._getKeyForChar(shiftMapped);
            if (baseKey !== null) {
                await keyboard.pressKey(Key.LeftShift);
                await keyboard.pressKey(baseKey);
                await keyboard.releaseKey(baseKey);
                await keyboard.releaseKey(Key.LeftShift);
            } else {
                logger.warn(`Fallback: typing symbol '${char}' directly via type()`);
                await keyboard.type(char);
            }
        } else {
            // Regular character: use keyboard.type() for simplicity
            try {
                await keyboard.type(char);
            } catch (error) {
                logger.error(`Failed to type character '${char}'`, { error: error.message });
                // Attempt direct key press if it's a known key
                const directKey = this._getKeyForChar(char);
                if (directKey) {
                    await keyboard.pressKey(directKey);
                    await keyboard.releaseKey(directKey);
                }
            }
        }
    }

    /**
     * Maps a character to its corresponding Key enum value.
     *
     * @param {string} char - Single character
     * @returns {Key} The nut-js Key enum value
     * @private
     */
    _getKeyForChar(char) {
        const keyMap = {
            'a': Key.A, 'b': Key.B, 'c': Key.C, 'd': Key.D,
            'e': Key.E, 'f': Key.F, 'g': Key.G, 'h': Key.H,
            'i': Key.I, 'j': Key.J, 'k': Key.K, 'l': Key.L,
            'm': Key.M, 'n': Key.N, 'o': Key.O, 'p': Key.P,
            'q': Key.Q, 'r': Key.R, 's': Key.S, 't': Key.T,
            'u': Key.U, 'v': Key.V, 'w': Key.W, 'x': Key.X,
            'y': Key.Y, 'z': Key.Z,
            '0': Key.Num0, '1': Key.Num1, '2': Key.Num2,
            '3': Key.Num3, '4': Key.Num4, '5': Key.Num5,
            '6': Key.Num6, '7': Key.Num7, '8': Key.Num8,
            '9': Key.Num9,
            '-': Key.Minus, '=': Key.Equal,
            '[': Key.BracketLeft, ']': Key.BracketRight,
            '\\': Key.Backslash, ';': Key.Semicolon,
            "'": Key.Quote, ',': Key.Comma,
            '.': Key.Period, '/': Key.Slash,
            '`': Key.Backquote, ' ': Key.Space
        };

        const key = keyMap[char];
        if (!key) {
            // Fallback: use keyboard.type() for unmapped characters
            logger.warn(`No Key mapping for character '${char}', using type() fallback`);
            return null;
        }
        return key;
    }

    /**
     * Simulates a human typo: types wrong character, pauses, backspaces, pauses, then corrects.
     *
     * @param {string} correctChar - The character that should have been typed
     * @param {number} baseDelay - The base delay between keystrokes
     * @private
     */
    async _simulateTypo(correctChar, baseDelay) {
        // Generate a wrong character (adjacent key or random letter)
        const wrongChar = this._getAdjacentKey(correctChar);
        if (!wrongChar || wrongChar === correctChar) {
            return; // Can't simulate typo for this character
        }

        logger.debug('Simulating typo', { correctChar, wrongChar });

        // Type the wrong character
        await this._typeCharacter(wrongChar);

        // Pause before noticing the typo (150-300ms)
        await this._delay(this._randomInRange(150, 300));

        // Press backspace to delete the typo
        await keyboard.pressKey(Key.Backspace);
        await keyboard.releaseKey(Key.Backspace);

        // Pause before retyping (100-200ms)
        await this._delay(this._randomInRange(100, 200));
    }

    /**
     * Returns a character adjacent to the given character on a QWERTY keyboard,
     * used for realistic typo simulation.
     *
     * @param {string} char - The intended character
     * @returns {string|null} An adjacent character, or null if not applicable
     * @private
     */
    _getAdjacentKey(char) {
        const qwertyRows = [
            'qwertyuiop',
            'asdfghjkl',
            'zxcvbnm'
        ];

        const lowerChar = char.toLowerCase();

        for (const row of qwertyRows) {
            const index = row.indexOf(lowerChar);
            if (index !== -1) {
                // Pick a random adjacent key from the same row
                const adjacentIndices = [];
                if (index > 0) adjacentIndices.push(index - 1);
                if (index < row.length - 1) adjacentIndices.push(index + 1);

                if (adjacentIndices.length === 0) return null;

                const adjIndex = adjacentIndices[Math.floor(Math.random() * adjacentIndices.length)];
                const adjChar = row[adjIndex];

                // Preserve case
                return char === lowerChar ? adjChar : adjChar.toUpperCase();
            }
        }

        // For non-alpha characters, return a random common character
        if (char === ' ') return 'a';
        return null;
    }

    /**
     * Determines whether a typo should be simulated (10% chance per word).
     *
     * @returns {boolean}
     * @private
     */
    _shouldSimulateTypo() {
        return Math.random() < 0.10;
    }

    /**
     * Cancel the current typing operation.
     *
     * @returns {{success: boolean}}
     */
    cancel() {
        logger.info('Auto-type cancellation requested', {
            isTyping: this.isTyping,
            currentTextLength: this.currentText?.length
        });

        this.isCancelled = true;
        this.isTyping = false;

        return { success: true };
    }

    /**
     * Update the default delay before typing starts.
     *
     * @param {number} delayMs - Delay in milliseconds
     */
    setDelay(delayMs) {
        if (typeof delayMs !== 'number' || delayMs < 0) {
            throw new Error('Delay must be a non-negative number.');
        }
        this.typingDelay = delayMs;
        logger.debug('Typing delay updated', { delayMs });
    }

    /**
     * Update the target words per minute.
     * Clamped between 20 and 80 WPM.
     *
     * @param {number} wpm - Words per minute (20-80)
     */
    setWPM(wpm) {
        if (typeof wpm !== 'number' || wpm <= 0) {
            throw new Error('WPM must be a positive number.');
        }
        this.wpm = Math.max(20, Math.min(80, Math.round(wpm)));
        logger.debug('WPM updated', { wpm: this.wpm });
    }

    /**
     * Get the current status of the auto-type service.
     *
     * @returns {{isTyping: boolean, wpm: number, delay: number, currentTextLength: number|null}}
     */
    getStatus() {
        return {
            isTyping: this.isTyping,
            wpm: this.wpm,
            delay: this.typingDelay,
            currentTextLength: this.currentText?.length ?? null
        };
    }

    /**
     * Cancellable delay utility.
     * Checks isCancelled flag at regular intervals and rejects if cancelled.
     *
     * @param {number} ms - Duration in milliseconds
     * @returns {Promise<void>}
     * @private
     */
    async _delay(ms) {
        return new Promise((resolve, reject) => {
            const checkInterval = setInterval(() => {
                if (this.isCancelled) {
                    clearInterval(checkInterval);
                    reject(new Error('Typing cancelled'));
                    return;
                }
            }, 100);

            setTimeout(() => {
                clearInterval(checkInterval);
                resolve();
            }, ms);
        });
    }

    /**
     * Returns a random integer between min and max (inclusive).
     *
     * @param {number} min - Minimum value
     * @param {number} max - Maximum value
     * @returns {number}
     * @private
     */
    _randomInRange(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
}

module.exports = new AutoTypeService();
