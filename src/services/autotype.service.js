const { keyboard, Key } = require('@nut-tree-fork/nut-js');
const logger = require('../core/logger').createServiceLogger('AUTOTYPE');

try { keyboard.config.autoDelayMs = 0; } catch (_) { /* older versions */ }

class AutoTypeService {
    constructor() {
        this.isTyping = false;
        this.isCancelled = false;
        this.typingDelay = 3000;
        this.currentText = null;
        this._activeTimers = [];
        this.responseSections = [];
        this.currentSectionIndex = 0;

        this._baseDelay = 50;
        this._dwellMin = 26;
        this._dwellMax = 52;

        this._modifierLead = 22;
        this._modifierTail = 18;

        this._cadenceMultiplier = 1.0;
        this._charsTyped = 0;

        this._typoRate = 0;
        this._typoCooldown = 8;
        this._lastTypoCharIndex = -1000;

        this._typoMix = {
            slip: 0.70,
            double: 0.30
        };

        this._typoNoticeMin = 140;
        this._typoNoticeMax = 360;
        this._typoSettleMin = 60;
        this._typoSettleMax = 140;

        this._qwertyAdjacent = {
            q: ['w', 'a', 's'],
            w: ['q', 'e', 'a', 's', 'd'],
            e: ['w', 'r', 's', 'd', 'f'],
            r: ['e', 't', 'd', 'f', 'g'],
            t: ['r', 'y', 'f', 'g', 'h'],
            y: ['t', 'u', 'g', 'h', 'j'],
            u: ['y', 'i', 'h', 'j', 'k'],
            i: ['u', 'o', 'j', 'k', 'l'],
            o: ['i', 'p', 'k', 'l'],
            p: ['o', 'l'],
            a: ['q', 'w', 's', 'z'],
            s: ['a', 'w', 'e', 'd', 'z', 'x'],
            d: ['s', 'e', 'r', 'f', 'x', 'c'],
            f: ['d', 'r', 't', 'g', 'c', 'v'],
            g: ['f', 't', 'y', 'h', 'v', 'b'],
            h: ['g', 'y', 'u', 'j', 'b', 'n'],
            j: ['h', 'u', 'i', 'k', 'n', 'm'],
            k: ['j', 'i', 'o', 'l', 'm'],
            l: ['k', 'o', 'p'],
            z: ['a', 's', 'x'],
            x: ['z', 's', 'd', 'c'],
            c: ['x', 'd', 'f', 'v'],
            v: ['c', 'f', 'g', 'b'],
            b: ['v', 'g', 'h', 'n'],
            n: ['b', 'h', 'j', 'm'],
            m: ['n', 'j', 'k']
        };
    }

    extractAnswer(text) {
        if (typeof text !== 'string') return '';

        let cleaned = text.trim();
        if (cleaned.includes('```')) {
            const match = cleaned.match(/```(?:\w*\n)?([\s\S]*?)```/);
            if (match && match[1]) {
                cleaned = match[1].trim();
            }
        }
        return cleaned;
    }

    parseResponseSections(text) {
        if (typeof text !== 'string') return [];
        
        let sections = [];
        
        // Try [Q1], [Q2], [Q3]... markers first
        const qMarkerRegex = /\[Q(\d+)\]([\s\S]*?)(?=\[Q\d+\]|$)/gi;
        let match;
        let hasQMarkers = false;
        
        while ((match = qMarkerRegex.exec(text)) !== null) {
            hasQMarkers = true;
            const content = match[2].trim();
            if (content) sections.push(content);
        }
        
        if (hasQMarkers && sections.length > 0) {
            return sections;
        }
        
        // Try --- separators
        if (text.includes('---')) {
            sections = text.split(/\n*---+\n*/)
                .map(s => s.trim())
                .filter(s => s.length > 0);
            if (sections.length > 1) return sections;
        }
        
        // Try double newlines as fallback for distinct answers
        const paragraphs = text.split(/\n\n+/).filter(s => s.trim().length > 0);
        if (paragraphs.length > 1) {
            return paragraphs.map(p => p.trim());
        }
        
        // Single section
        return [text.trim()];
    }

    setResponseText(text) {
        this.currentText = text;
        this.responseSections = this.parseResponseSections(text);
        this.currentSectionIndex = 0;
        logger.info('Response sections parsed', { 
            sectionCount: this.responseSections.length,
            previewLengths: this.responseSections.map(s => s.length)
        });
        return {
            sectionCount: this.responseSections.length,
            currentSection: this.currentSectionIndex
        };
    }

    getCurrentSectionInfo() {
        return {
            totalSections: this.responseSections.length,
            currentSection: this.currentSectionIndex,
            hasNext: this.currentSectionIndex < this.responseSections.length - 1,
            preview: this.responseSections[this.currentSectionIndex]?.substring(0, 100) || null
        };
    }

    advanceToNextSection() {
        if (this.currentSectionIndex < this.responseSections.length - 1) {
            this.currentSectionIndex++;
            return true;
        }
        return false;
    }

    resetSectionIndex() {
        this.currentSectionIndex = 0;
    }

    async typeText(text, delay = null) {
        if (this.isTyping) {
            throw new Error('Already typing. Cancel current operation first.');
        }

        // If sections are parsed, use current section
        let textToType;
        if (this.responseSections.length > 0 && this.currentSectionIndex < this.responseSections.length) {
            textToType = this.extractAnswer(this.responseSections[this.currentSectionIndex]);
        } else if (typeof text === 'string' && text.length > 0) {
            textToType = this.extractAnswer(text);
        } else {
            throw new Error('No text available to type.');
        }

        if (textToType.length === 0) {
            throw new Error('Extracted text is empty after processing.');
        }

        this.isTyping = true;
        this.isCancelled = false;
        this.currentText = textToType;
        this._cadenceMultiplier = 1.0;
        this._charsTyped = 0;
        this._lastTypoCharIndex = -1000;

        const effectiveDelay = delay !== null ? delay : this.typingDelay;
        const sectionInfo = this.responseSections.length > 0 ? 
            ` (section ${this.currentSectionIndex + 1}/${this.responseSections.length})` : '';

        logger.info('Auto-type scheduled', {
            originalLength: text?.length || 0,
            extractedLength: textToType.length,
            delay: effectiveDelay,
            targetWpm: 120,
            typoRate: this._typoRate,
            sectionInfo
        });

        try {
            if (effectiveDelay > 0) {
                logger.info(`Starting in ${Math.round(effectiveDelay / 1000)}s...`);
                await this._delay(effectiveDelay);
            }

            const t0 = Date.now();
            logger.info('Auto-type beginning');
            await this._typeText(textToType);
            const elapsedSec = (Date.now() - t0) / 1000;
            const wpm = Math.round((textToType.length / 5) / (elapsedSec / 60));
            logger.info('Auto-type completed', { elapsedSec: elapsedSec.toFixed(2), wpm });
            
            // Auto-advance to next section after typing
            const hasNextSection = this.advanceToNextSection();
            
            return { 
                success: true, 
                typedLength: textToType.length, 
                wpm,
                hasNextSection,
                currentSection: this.currentSectionIndex,
                totalSections: this.responseSections.length
            };
        } catch (error) {
            logger.error('Auto-type failed', { error: error.message });
            throw error;
        } finally {
            this.isTyping = false;
            this.isCancelled = false;
            await this._releaseAllKeys();
        }
    }

    async _typeText(text) {
        const lines = text.split('\n');

        for (let i = 0; i < lines.length; i++) {
            if (this.isCancelled) throw new Error('Typing cancelled');

            const line = lines[i];

            const indentMatch = line.match(/^(\s+)/);
            const indent = indentMatch ? indentMatch[1] : '';
            const content = indent ? line.slice(indent.length) : line;

            if (indent.length > 0) {
                await this._typeIndent(indent);
            }
            await this._typeLine(content);

            if (i < lines.length - 1) {
                await this._delay(this._jitter(40, 0.4));
                await this._pressAndRelease(Key.Enter);
                await this._delay(95 + Math.abs(this._gauss()) * 80);
            }
        }
    }

    async _typeIndent(indent) {
        for (let i = 0; i < indent.length; i++) {
            if (this.isCancelled) throw new Error('Typing cancelled');

            const char = indent[i];
            if (char === '\t') {
                await this._pressAndRelease(Key.Tab);
            } else {
                await this._pressAndRelease(Key.Space);
            }
            await this._delay(this._jitter(4, 0.7));
        }
    }

    async _typeLine(line) {
        let prevChar = '';
        for (let i = 0; i < line.length; i++) {
            if (this.isCancelled) throw new Error('Typing cancelled');

            const char = line[i];
            const nextChar = line[i + 1] || '';

            const alreadyTyped = await this._maybeTypo(char);
            if (!alreadyTyped) {
                await this._typeChar(char);
            }
            this._charsTyped += 1;
            this._driftCadence();

            const noise = Math.max(0.55, Math.min(1.55, 1.0 + this._gauss() * 0.22));
            let delay = this._baseDelay * this._cadenceMultiplier * noise;

            if (this._isFastBigram(prevChar, char)) {
                delay *= 0.78;
            }
            if (this._isSlowBigram(prevChar, char)) {
                delay *= 1.22;
            }

            if (char === ' ') {
                delay += 14 + Math.abs(this._gauss()) * 18;
            }

            if ('.!?'.includes(char) && (nextChar === ' ' || nextChar === '')) {
                delay += 200 + Math.abs(this._gauss()) * 140;
            } else if (',;:'.includes(char)) {
                delay += 75 + Math.abs(this._gauss()) * 55;
            }

            if (Math.random() < 0.015) {
                delay += 220 + Math.random() * 220;
            }
            if (Math.random() < 0.004) {
                delay += 600 + Math.random() * 500;
            }

            await this._delay(Math.max(8, delay));
            prevChar = char;
        }
    }

    _driftCadence() {
        const reversion = (1.0 - this._cadenceMultiplier) * 0.04;
        const noise = (Math.random() - 0.5) * 0.05;
        this._cadenceMultiplier = Math.min(
            1.18,
            Math.max(0.85, this._cadenceMultiplier + reversion + noise)
        );
    }

    _gauss() {
        let s = 0;
        for (let i = 0; i < 6; i++) s += Math.random();
        return (s - 3) / Math.sqrt(0.5);
    }

    _jitter(base, factor) {
        return base * (1 - factor + Math.random() * factor * 2);
    }

    _isFastBigram(a, b) {
        if (!a || !b) return false;
        const fast = new Set([
            'th', 'he', 'in', 'er', 'an', 'nd', 'on', 'en', 'at', 'ou',
            'it', 'is', 'or', 'ti', 'as', 'te', 'et', 'ng', 'of', 'al',
            'de', 'se', 'le', 'sa', 'si', 'ar', 'ng', 'me', 'ne', 'to',
            'nt', 'ha', 'ou', 'ea', 'st', 'io', 'ro', 'co', 'la', 'ta'
        ]);
        return fast.has((a + b).toLowerCase());
    }

    _isSlowBigram(a, b) {
        if (!a || !b) return false;
        const slow = new Set([
            'ed', 'ce', 'un', 'my', 'br', 'rb', 'mu', 'vy', 'xy', 'zy',
            'wq', 'qz', 'pl', 'lp', 'ny', 'cr', 'sw', 'ws', 'sx', 'xs'
        ]);
        return slow.has((a + b).toLowerCase());
    }

    async _maybeTypo(intendedChar) {
        if (this._typoRate <= 0) return false;
        if (!/[a-zA-Z]/.test(intendedChar)) return false;
        if (this._charsTyped - this._lastTypoCharIndex < this._typoCooldown) {
            return false;
        }
        if (Math.random() >= this._typoRate / 1000) return false;

        this._lastTypoCharIndex = this._charsTyped;

        const slipShare = this._typoMix.slip ?? 0.7;
        if (Math.random() < slipShare) {
            const handled = await this._doTypoSlip(intendedChar);
            return handled === 'already-typed';
        } else {
            await this._doTypoDouble(intendedChar);
            return true;
        }
    }

    async _doTypoSlip(intendedChar) {
        const lower = intendedChar.toLowerCase();
        const neighbours = this._qwertyAdjacent[lower];
        if (!neighbours || neighbours.length === 0) {
            return 'no-typo';
        }

        const wrongLower = neighbours[Math.floor(Math.random() * neighbours.length)];
        const isUpper = intendedChar !== intendedChar.toLowerCase()
            && intendedChar === intendedChar.toUpperCase();
        const wrongChar = isUpper ? wrongLower.toUpperCase() : wrongLower;

        await this._typeChar(wrongChar);

        await this._delay(this._reactionDelay(this._typoNoticeMin, this._typoNoticeMax));

        const dwell = this._dwellMin + Math.random() * (this._dwellMax - this._dwellMin);
        await this._singleKeypress(Key.Backspace, dwell);

        await this._delay(this._reactionDelay(this._typoSettleMin, this._typoSettleMax));

        logger.debug('Typo correction (slip)', { intended: intendedChar, typed: wrongChar });
        return 'corrected';
    }

    async _doTypoDouble(intendedChar) {
        await this._typeChar(intendedChar);

        await this._delay(35 + Math.random() * 45);

        await this._typeChar(intendedChar);

        await this._delay(this._reactionDelay(this._typoNoticeMin, this._typoNoticeMax));

        const dwell = this._dwellMin + Math.random() * (this._dwellMax - this._dwellMin);
        await this._singleKeypress(Key.Backspace, dwell);

        await this._delay(this._reactionDelay(this._typoSettleMin, this._typoSettleMax));

        logger.debug('Typo correction (double)', { intended: intendedChar });
    }

    _reactionDelay(min, max) {
        const mid = (min + max) / 2;
        const spread = (max - min) / 2;
        const sample = mid + this._gauss() * (spread * 0.45);
        return Math.max(min, Math.min(max, sample));
    }

    async _typeChar(char) {
        const shiftChars = {
            '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6',
            '&': '7', '*': '8', '(': '9', ')': '0', '_': '-', '+': '=',
            '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',',
            '>': '.', '?': '/', '~': '`'
        };

        const dwell = this._dwellMin + Math.random() * (this._dwellMax - this._dwellMin);

        if (char >= 'A' && char <= 'Z') {
            const key = this._getKeyForChar(char.toLowerCase());
            if (key) {
                await this._modifiedKeypress(Key.LeftShift, key, dwell);
            } else {
                await keyboard.type(char);
            }
        } else if (shiftChars[char]) {
            const baseKey = this._getKeyForChar(shiftChars[char]);
            if (baseKey) {
                await this._modifiedKeypress(Key.LeftShift, baseKey, dwell);
            } else {
                await keyboard.type(char);
            }
        } else if (char === '\t') {
            await this._singleKeypress(Key.Tab, dwell);
        } else if (char === '\n') {
            await this._singleKeypress(Key.Enter, dwell);
        } else {
            const key = this._getKeyForChar(char);
            if (key) {
                await this._singleKeypress(key, dwell);
            } else {
                await keyboard.type(char);
            }
        }
    }

    _getKeyForChar(char) {
        const keyMap = {
            'a': Key.A, 'b': Key.B, 'c': Key.C, 'd': Key.D, 'e': Key.E, 'f': Key.F,
            'g': Key.G, 'h': Key.H, 'i': Key.I, 'j': Key.J, 'k': Key.K, 'l': Key.L,
            'm': Key.M, 'n': Key.N, 'o': Key.O, 'p': Key.P, 'q': Key.Q, 'r': Key.R,
            's': Key.S, 't': Key.T, 'u': Key.U, 'v': Key.V, 'w': Key.W, 'x': Key.X,
            'y': Key.Y, 'z': Key.Z,
            '0': Key.Num0, '1': Key.Num1, '2': Key.Num2, '3': Key.Num3, '4': Key.Num4,
            '5': Key.Num5, '6': Key.Num6, '7': Key.Num7, '8': Key.Num8, '9': Key.Num9,
            '-': Key.Minus, '=': Key.Equal, '[': Key.BracketLeft, ']': Key.BracketRight,
            '\\': Key.Backslash, ';': Key.Semicolon, "'": Key.Quote, ',': Key.Comma,
            '.': Key.Period, '/': Key.Slash, '`': Key.Backquote, ' ': Key.Space
        };
        return keyMap[char] || null;
    }

    async _singleKeypress(key, dwell) {
        let down = false;
        try {
            await keyboard.pressKey(key);
            down = true;
            await this._sleep(dwell);
            await keyboard.releaseKey(key);
            down = false;
        } finally {
            if (down) {
                try { await keyboard.releaseKey(key); } catch (_) {}
            }
        }
    }

    async _modifiedKeypress(modifier, key, dwell) {
        let modDown = false;
        let keyDown = false;
        try {
            await keyboard.pressKey(modifier);
            modDown = true;
            await this._sleep(this._modifierLead);

            await keyboard.pressKey(key);
            keyDown = true;
            await this._sleep(dwell);
            await keyboard.releaseKey(key);
            keyDown = false;

            await this._sleep(this._modifierTail);
            await keyboard.releaseKey(modifier);
            modDown = false;
        } finally {
            if (keyDown) {
                try { await keyboard.releaseKey(key); } catch (_) {}
            }
            if (modDown) {
                try { await keyboard.releaseKey(modifier); } catch (_) {}
            }
        }
    }

    async _pressAndRelease(key) {
        const dwell = this._dwellMin + Math.random() * (this._dwellMax - this._dwellMin);
        await this._singleKeypress(key, dwell);
    }

    async _releaseAllKeys() {
        const mods = [
            Key.LeftShift, Key.RightShift,
            Key.LeftControl, Key.RightControl,
            Key.LeftAlt, Key.RightAlt,
            Key.LeftSuper, Key.RightSuper
        ];
        for (const key of mods) {
            try { await keyboard.releaseKey(key); } catch (_) {}
        }
    }

    cancel() {
        if (!this.isTyping) {
            logger.warn('Cancel requested but no typing operation is active');
            return { success: true, wasTyping: false };
        }
        logger.info('Auto-type cancellation requested');
        this.isCancelled = true;
        return { success: true, wasTyping: true };
    }

    setDelay(delayMs) {
        if (typeof delayMs !== 'number' || delayMs < 0) {
            throw new Error('Delay must be a non-negative number.');
        }
        this.typingDelay = delayMs;
    }

    setWpm(wpm) {
        if (typeof wpm !== 'number' || wpm < 20 || wpm > 250) {
            throw new Error('WPM must be a number between 20 and 250.');
        }
        const msPerChar = 60000 / (wpm * 5);
        const avgDwell = (this._dwellMin + this._dwellMax) / 2;
        this._baseDelay = Math.max(8, Math.round(msPerChar - avgDwell));
        logger.info('Typing speed updated', { wpm, baseDelay: this._baseDelay });
    }

    setTypoRate(rate) {
        if (typeof rate !== 'number' || rate < 0 || rate > 100) {
            throw new Error('Typo rate must be a number between 0 and 100 per 1000 chars.');
        }
        this._typoRate = rate;
        logger.info('Typo rate updated', { rate });
    }

    getStatus() {
        return {
            isTyping: this.isTyping,
            delay: this.typingDelay,
            baseDelay: this._baseDelay,
            typoRate: this._typoRate,
            currentTextLength: this.currentText?.length ?? null,
            totalSections: this.responseSections.length,
            currentSection: this.currentSectionIndex,
            hasNextSection: this.currentSectionIndex < this.responseSections.length - 1
        };
    }

    _sleep(ms) {
        return new Promise(resolve => {
            const timer = setTimeout(resolve, ms);
            this._activeTimers.push(timer);
        });
    }

    async _delay(ms) {
        if (ms < 20) {
            return new Promise((resolve) => {
                const timer = setTimeout(resolve, ms);
                this._activeTimers.push(timer);
            });
        }

        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            let timer = null;

            const cleanup = () => {
                if (timer) {
                    clearTimeout(timer);
                    this._activeTimers = this._activeTimers.filter(t => t !== timer);
                    timer = null;
                }
            };

            const tick = () => {
                if (this.isCancelled) {
                    cleanup();
                    reject(new Error('Typing cancelled'));
                    return;
                }
                if (Date.now() - startTime >= ms) {
                    cleanup();
                    resolve();
                } else {
                    const nextCheck = Math.min(50, ms - (Date.now() - startTime));
                    timer = setTimeout(tick, nextCheck);
                    this._activeTimers.push(timer);
                }
            };

            timer = setTimeout(tick, Math.min(50, ms));
            this._activeTimers.push(timer);
        });
    }

    dispose() {
        for (const timer of this._activeTimers) {
            clearTimeout(timer);
        }
        this._activeTimers = [];
        this.isCancelled = true;
        this.isTyping = false;
    }
}

module.exports = new AutoTypeService();