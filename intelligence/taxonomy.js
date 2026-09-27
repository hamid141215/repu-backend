'use strict';

const INTELLIGENCE_DIMENSIONS = Object.freeze([
    'SERVICE',
    'PRODUCT_QUALITY',
    'STAFF',
    'SPEED',
    'COMMUNICATION',
    'AVAILABILITY',
    'FACILITY',
    'AMBIENCE',
    'PRICE',
    'DIGITAL_EXPERIENCE',
    'OTHER',
    'UNCLEAR',
    'NOISE'
]);

const USABLE_DIMENSIONS = Object.freeze(
    INTELLIGENCE_DIMENSIONS.filter(
        (dimension) => !['UNCLEAR', 'NOISE'].includes(dimension)
    )
);

const SIGNAL_SENTIMENTS = Object.freeze([
    'POSITIVE',
    'NEGATIVE',
    'NEUTRAL',
    'MIXED'
]);

const ISSUE_SCOPE_TYPES = Object.freeze([
    'CLIENT',
    'BRANCH'
]);

const ISSUE_SEVERITIES = Object.freeze([
    'LOW',
    'MEDIUM',
    'HIGH',
    'CRITICAL'
]);

const ISSUE_STATUSES = Object.freeze([
    'OPEN',
    'WATCHING',
    'RESOLVED',
    'DISMISSED'
]);

const MIN_AGGREGATION_CONFIDENCE = 0.70;

function isKnownDimension(value) {
    return INTELLIGENCE_DIMENSIONS.includes(value);
}

function isUsableDimension(value) {
    return USABLE_DIMENSIONS.includes(value);
}

module.exports = {
    INTELLIGENCE_DIMENSIONS,
    USABLE_DIMENSIONS,
    SIGNAL_SENTIMENTS,
    ISSUE_SCOPE_TYPES,
    ISSUE_SEVERITIES,
    ISSUE_STATUSES,
    MIN_AGGREGATION_CONFIDENCE,
    isKnownDimension,
    isUsableDimension
};