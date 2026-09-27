'use strict';

const {
    INTELLIGENCE_DIMENSIONS,
    SIGNAL_SENTIMENTS,
    MIN_AGGREGATION_CONFIDENCE
} = require('./taxonomy');

const ARABIC_DIACRITICS =
    /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;

const NON_TEXT =
    /[^\u0600-\u06FFA-Za-z0-9\s]/g;

const LETTER_OR_NUMBER =
    /[\u0600-\u06FFA-Za-z0-9]/;

function normalizeText(value) {
    return String(value || '')
        .normalize('NFKC')
        .replace(ARABIC_DIACRITICS, '')
        .replace(/\u0640/g, '')
        .replace(/[إأآٱ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ؤ/g, 'و')
        .replace(/ئ/g, 'ي')
        .replace(/ء/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function tokenize(value) {
    return normalizeText(value)
        .split(/[^\u0600-\u06FFA-Za-z0-9]+/)
        .filter(Boolean);
}

function hasEnoughText(text) {
    const stripped = text.replace(/\s+/g, '');
    const chars = Array.from(stripped)
        .filter((ch) => LETTER_OR_NUMBER.test(ch));

    return chars.length >= 3;
}

function detectNoise(text) {
    const raw = String(text || '').trim();

    if (!raw) {
        return {
            isNoise: true,
            reason: 'EMPTY'
        };
    }

    const normalized = normalizeText(raw);

    if (!hasEnoughText(normalized)) {
        return {
            isNoise: true,
            reason: 'TOO_SHORT'
        };
    }

    const nonTextCount = (raw.match(NON_TEXT) || []).length;
    const nonTextRatio =
        nonTextCount / Math.max(raw.length, 1);

    if (nonTextRatio >= 0.5) {
        return {
            isNoise: true,
            reason: 'SYMBOL_HEAVY'
        };
    }

    return {
        isNoise: false,
        reason: null
    };
}

const NEGATIVE_TERMS = [
    'سيي',
    'سيية',
    'ردي',
    'ردية',
    'ضعيف',
    'ضعيفة',
    'بطي',
    'بطيه',
    'تاخير',
    'متاخر',
    'متاخرة',
    'زفت',
    'حامض',
    'حامضة',
    'بارد',
    'باردة',
    'وسخ',
    'متسخ',
    'متسخة',
    'مزعج',
    'مزعجة',
    'غالي',
    'غالية'
];

const POSITIVE_TERMS = [
    'ممتاز',
    'ممتازة',
    'رايع',
    'رايعة',
    'جميل',
    'جميلة',
    'سريع',
    'سريعة',
    'نظيف',
    'نظيفة',
    'لذيذ',
    'لذيذة'
];

const NEGATIVE_PHRASES = [
    'مو جيد',
    'مو جيدة',
    'غير جيد',
    'غير جيدة',
    'ليست جيدة',
    'ليس جيد',
    'مافي',
    'ما فيه',
    'غير متوفر',
    'غير متوفرة'
];

const POSITIVE_PHRASES = [
    'جيد جدا',
    'جيدة جدا'
];

const DIMENSION_RULES = [
    {
        dimension: 'SERVICE',
        confidence: 0.90,
        terms: [
            'الخدمة',
            'خدمة',
            'تعامل'
        ]
    },
    {
        dimension: 'PRODUCT_QUALITY',
        confidence: 0.92,
        terms: [
            'الجودة',
            'جودة',
            'القهوة',
            'قهوة',
            'الطعم',
            'طعم',
            'الاكل',
            'الطعام',
            'مشروب',
            'مشروبات'
        ]
    },
    {
        dimension: 'STAFF',
        confidence: 0.90,
        terms: [
            'الموظف',
            'الموظفة',
            'الموظفين',
            'العامل',
            'العاملين',
            'الكاشير',
            'الباريستا'
        ]
    },
    {
        dimension: 'SPEED',
        confidence: 0.88,
        terms: [
            'بطي',
            'بطيه',
            'التاخير',
            'تاخير',
            'انتظار',
            'يتاخر',
            'متاخر'
        ]
    },
    {
        dimension: 'COMMUNICATION',
        confidence: 0.86,
        terms: [
            'التواصل',
            'تواصل',
            'الرد',
            'رد',
            'اتصال',
            'رسالة',
            'واتساب'
        ]
    },
    {
        dimension: 'AVAILABILITY',
        confidence: 0.86,
        terms: [
            'نفد',
            'مخلص',
            'متوفر'
        ],
        phrases: [
            'غير متوفر',
            'غير متوفرة',
            'مافي',
            'ما فيه'
        ]
    },
    {
        dimension: 'FACILITY',
        confidence: 0.84,
        terms: [
            'المكان',
            'المواقف',
            'مواقف',
            'الحمام',
            'الحمامات',
            'النظافة',
            'نظافة',
            'الطاولة',
            'الطاولات'
        ]
    },
    {
        dimension: 'AMBIENCE',
        confidence: 0.84,
        terms: [
            'الجو',
            'اجواء',
            'الاجواء',
            'الاضاءة',
            'الموسيقي',
            'موسيقي',
            'الهدوء',
            'ازعاج'
        ]
    },
    {
        dimension: 'PRICE',
        confidence: 0.90,
        terms: [
            'السعر',
            'الاسعار',
            'غالي',
            'غالية',
            'رخيص',
            'رخيصة'
        ]
    },
    {
        dimension: 'DIGITAL_EXPERIENCE',
        confidence: 0.88,
        terms: [
            'التطبيق',
            'الموقع',
            'الرابط',
            'الدفع',
            'الكتروني',
            'qr',
            'باركود'
        ]
    }
];

function includesPhrase(normalized, phrase) {
    return normalized.includes(normalizeText(phrase));
}

function includesTerm(tokens, term) {
    const normalizedTerm = normalizeText(term);
    return tokens.includes(normalizedTerm);
}

function sentimentFromText(value) {
    const normalized = normalizeText(value);
    const tokens = tokenize(value);

    const negative =
        NEGATIVE_PHRASES.some(
            (phrase) => includesPhrase(normalized, phrase)
        ) ||
        NEGATIVE_TERMS.some(
            (term) => includesTerm(tokens, term)
        );

    const positive =
        POSITIVE_PHRASES.some(
            (phrase) => includesPhrase(normalized, phrase)
        ) ||
        POSITIVE_TERMS.some(
            (term) => includesTerm(tokens, term)
        );

    if (negative && positive) return 'MIXED';
    if (negative) return 'NEGATIVE';
    if (positive) return 'POSITIVE';

    return 'NEUTRAL';
}

function detectSentiment(text) {
    return sentimentFromText(text);
}

function ruleMatches(text, rule) {
    const normalized = normalizeText(text);
    const tokens = tokenize(text);

    const termMatch =
        (rule.terms || []).some(
            (term) => includesTerm(tokens, term)
        );

    const phraseMatch =
        (rule.phrases || []).some(
            (phrase) => includesPhrase(normalized, phrase)
        );

    return termMatch || phraseMatch;
}

function extractDimensions(text) {
    return DIMENSION_RULES
        .filter((rule) => ruleMatches(text, rule))
        .map((rule) => ({
            dimension: rule.dimension,
            confidence: rule.confidence
        }));
}

function splitClauses(text) {
    return String(text || '')
        .split(
            /\s+(?:لكن|ولكن|بس|الا ان|مع ان|بينما)\s+|[،,؛;.!؟?]+/u
        )
        .map((part) => part.trim())
        .filter(Boolean);
}

function getAspectSentiment(text, dimension) {
    const clauses = splitClauses(text);

    for (const clause of clauses) {
        const matches = extractDimensions(clause);

        if (
            matches.some(
                (match) => match.dimension === dimension
            )
        ) {
            return sentimentFromText(clause);
        }
    }

    return sentimentFromText(text);
}

function ratingSentiment(rating) {
    const value = Number(rating);

    if (!Number.isFinite(value)) {
        return null;
    }

    if (value <= 2) return 'NEGATIVE';
    if (value >= 4) return 'POSITIVE';

    return 'NEUTRAL';
}

function classifyFeedback(feedback, context = {}) {
    const raw = String(feedback || '').trim();
    const noise = detectNoise(raw);

    if (noise.isNoise) {
        return {
            usable: false,
            normalized_text: normalizeText(raw),
            classification: 'NOISE',
            reason: noise.reason,
            signals: [
                {
                    dimension: 'NOISE',
                    sentiment: 'NEUTRAL',
                    confidence: 1.0,
                    evidence_text: raw
                }
            ]
        };
    }

    const dimensions = extractDimensions(raw);

    if (dimensions.length === 0) {
        return {
            usable: false,
            normalized_text: normalizeText(raw),
            classification: 'UNCLEAR',
            reason: 'NO_DIMENSION_MATCH',
            signals: [
                {
                    dimension: 'UNCLEAR',
                    sentiment: detectSentiment(raw),
                    confidence: 0.50,
                    evidence_text: raw
                }
            ]
        };
    }

    const signals = dimensions.map((match) => {
        const textSentiment = getAspectSentiment(
            raw,
            match.dimension
        );

        const fallbackSentiment =
            textSentiment === 'NEUTRAL'
                ? ratingSentiment(context.rating)
                : null;

        return {
            dimension: match.dimension,
            sentiment:
                fallbackSentiment || textSentiment,
            confidence: match.confidence,
            evidence_text: raw
        };
    });

    return {
        usable: signals.some(
            (signal) =>
                signal.dimension !== 'UNCLEAR' &&
                signal.dimension !== 'NOISE' &&
                signal.confidence >=
                    MIN_AGGREGATION_CONFIDENCE
        ),
        normalized_text: normalizeText(raw),
        classification: 'SIGNAL',
        reason: null,
        signals
    };
}

function validateSignal(signal) {
    if (!signal || typeof signal !== 'object') {
        return false;
    }

    if (
        !INTELLIGENCE_DIMENSIONS.includes(
            signal.dimension
        )
    ) {
        return false;
    }

    if (
        !SIGNAL_SENTIMENTS.includes(
            signal.sentiment
        )
    ) {
        return false;
    }

    const confidence = Number(signal.confidence);

    return (
        Number.isFinite(confidence) &&
        confidence >= 0 &&
        confidence <= 1
    );
}

module.exports = {
    normalizeText,
    tokenize,
    detectNoise,
    detectSentiment,
    extractDimensions,
    getAspectSentiment,
    ratingSentiment,
    classifyFeedback,
    validateSignal
};