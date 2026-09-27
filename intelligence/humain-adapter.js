'use strict';

const DEFAULT_HUMAIN_MODEL =
    'humain-m3-preview';

const DEFAULT_TIMEOUT_MS =
    30000;

const MAX_TIMEOUT_MS =
    120000;

const MAX_RESPONSE_ATTEMPTS =
    1;

class HumainAdapterError extends Error {
    constructor(
        message,
        options = {}
    ) {
        super(message);

        this.name =
            'HumainAdapterError';

        this.code =
            options.code ||
            'HUMAIN_ADAPTER_ERROR';

        this.status =
            options.status ??
            null;

        this.details =
            options.details ??
            null;
    }
}

function getHumainConfig(
    env = process.env
) {
    const apiKey =
        String(
            env.HUMAIN_NODE_API_KEY ||
            env.HUMAIN_API_KEY ||
            ''
        ).trim();

    const baseUrl =
        String(
            env.HUMAIN_BASE_URL || ''
        )
            .trim()
            .replace(/\/+$/, '');

    const model =
        String(
            env.HUMAIN_MODEL ||
            DEFAULT_HUMAIN_MODEL
        ).trim();

    const parsedTimeout =
        Number.parseInt(
            env.HUMAIN_TIMEOUT_MS,
            10
        );

    const timeoutMs =
        Number.isInteger(
            parsedTimeout
        )
            ? Math.max(
                1000,
                Math.min(
                    parsedTimeout,
                    MAX_TIMEOUT_MS
                )
            )
            : DEFAULT_TIMEOUT_MS;

    return {
        apiKey,
        baseUrl,
        model,
        timeoutMs
    };
}

function assertHumainConfig(
    config
) {
    if (!config.apiKey) {
        throw new HumainAdapterError(
            'HUMAIN API key is required',
            {
                code:
                    'HUMAIN_API_KEY_MISSING'
            }
        );
    }

    if (!config.baseUrl) {
        throw new HumainAdapterError(
            'HUMAIN_BASE_URL is required',
            {
                code:
                    'HUMAIN_BASE_URL_MISSING'
            }
        );
    }

    if (!config.model) {
        throw new HumainAdapterError(
            'HUMAIN_MODEL is required',
            {
                code:
                    'HUMAIN_MODEL_MISSING'
            }
        );
    }
}

function extractAssistantText(
    payload
) {
    if (
        payload &&
        Array.isArray(
            payload.choices
        )
    ) {
        const content =
            payload.choices[0]
                ?.message
                ?.content;

        if (
            typeof content ===
            'string' &&
            content.trim()
        ) {
            return content.trim();
        }
    }

    if (
        payload &&
        typeof payload.output_text ===
        'string' &&
        payload.output_text.trim()
    ) {
        return (
            payload.output_text.trim()
        );
    }

    if (
        payload &&
        typeof payload.output ===
        'string' &&
        payload.output.trim()
    ) {
        return payload.output.trim();
    }

    const firstChoice =
        Array.isArray(
            payload?.choices
        )
            ? payload.choices[0]
            : null;

    const message =
        firstChoice?.message;

    throw new HumainAdapterError(
        'HUMAIN response did not contain assistant text',
        {
            code:
                'HUMAIN_INVALID_RESPONSE',

            details: {
                payload_type:
                    typeof payload,

                payload_is_array:
                    Array.isArray(
                        payload
                    ),

                payload_is_null:
                    payload === null,

                top_level_keys:
                    payload &&
                    typeof payload === 'object'
                        ? Object.keys(payload)
                        : [],

                choices_is_array:
                    Array.isArray(
                        payload?.choices
                    ),

                choices_count:
                    Array.isArray(
                        payload?.choices
                    )
                        ? payload.choices.length
                        : 0,

                content_type:
                    typeof message?.content,

                content_is_null:
                    message?.content === null,

                has_reasoning_content:
                    typeof message
                        ?.reasoning_content ===
                    'string',

                reasoning_content_length:
                    typeof message
                        ?.reasoning_content ===
                    'string'
                        ? message.reasoning_content.length
                        : 0,

                finish_reason:
                    firstChoice
                        ?.finish_reason ??
                    null
            }
        }
    );
}

function parseStrictJson(
    text
) {
    if (typeof text !== 'string') {
        throw new HumainAdapterError(
            'Model output must be text',
            {
                code:
                    'HUMAIN_INVALID_JSON'
            }
        );
    }

    const trimmed =
        text.trim();

    if (
        trimmed.startsWith('```') ||
        trimmed.endsWith('```')
    ) {
        throw new HumainAdapterError(
            'Model output must be raw JSON without markdown fences',
            {
                code:
                    'HUMAIN_INVALID_JSON'
            }
        );
    }

    let parsed;

    try {
        parsed =
            JSON.parse(trimmed);
    } catch (_) {
        throw new HumainAdapterError(
            'Model output is not valid JSON',
            {
                code:
                    'HUMAIN_INVALID_JSON'
            }
        );
    }

    if (
        !parsed ||
        Array.isArray(parsed) ||
        typeof parsed !== 'object'
    ) {
        throw new HumainAdapterError(
            'Model output must be a JSON object',
            {
                code:
                    'HUMAIN_INVALID_JSON'
            }
        );
    }

    if (
        Object.keys(parsed).length ===
        0
    ) {
        throw new HumainAdapterError(
            'HUMAIN returned an empty structured output',
            {
                code:
                    'HUMAIN_EMPTY_STRUCTURED_OUTPUT'
            }
        );
    }

    return parsed;
}

function parseSsePayload(
    raw
) {
    const lines =
        String(raw || '')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(
                (line) =>
                    line.startsWith('data:')
            );

    if (lines.length === 0) {
        return null;
    }

    let finalPayload = null;
    let combinedContent = '';
    let combinedReasoning = '';

    for (const line of lines) {
        const value =
            line.slice(5).trim();

        if (
            !value ||
            value === '[DONE]'
        ) {
            continue;
        }

        let chunk;

        try {
            chunk =
                JSON.parse(value);
        } catch (_) {
            continue;
        }

        finalPayload =
            chunk;

        const choice =
            chunk?.choices?.[0];

        const content =
            choice?.delta?.content ??
            choice?.message?.content;

        const reasoning =
            choice?.delta?.reasoning_content ??
            choice?.message?.reasoning_content;

        if (
            typeof content ===
            'string'
        ) {
            combinedContent +=
                content;
        }

        if (
            typeof reasoning ===
            'string'
        ) {
            combinedReasoning +=
                reasoning;
        }
    }

    if (combinedContent) {
        return {
            choices: [
                {
                    index: 0,

                    finish_reason:
                        finalPayload
                            ?.choices?.[0]
                            ?.finish_reason ??
                        'stop',

                    message: {
                        role:
                            'assistant',

                        content:
                            combinedContent,

                        reasoning_content:
                            combinedReasoning ||
                            undefined
                    }
                }
            ],

            model:
                finalPayload?.model,

            usage:
                finalPayload?.usage
        };
    }

    return finalPayload;
}

async function readResponsePayload(
    response
) {
    let raw;

    if (
        typeof response.text ===
        'function'
    ) {
        raw =
            await response.text();
    }
    else if (
        typeof response.json ===
        'function'
    ) {
        return await response.json();
    }
    else {
        throw new HumainAdapterError(
            'HUMAIN response body is unreadable',
            {
                code:
                    'HUMAIN_RESPONSE_UNREADABLE',

                status:
                    response.status
            }
        );
    }

    const cleaned =
        String(raw || '')
            .replace(
                /^\uFEFF/,
                ''
            )
            .trim();

    const contentType =
        typeof response
            .headers?.get ===
        'function'
            ? response.headers.get(
                'content-type'
            )
            : null;

    if (!cleaned) {
        throw new HumainAdapterError(
            'HUMAIN returned an empty response body',
            {
                code:
                    'HUMAIN_EMPTY_RESPONSE',

                status:
                    response.status,

                details: {
                    content_type:
                        contentType
                }
            }
        );
    }

    try {
        return JSON.parse(
            cleaned
        );
    } catch (_) {}

    const ssePayload =
        parseSsePayload(
            cleaned
        );

    if (ssePayload) {
        return ssePayload;
    }

    throw new HumainAdapterError(
        'HUMAIN returned unsupported response body',
        {
            code:
                'HUMAIN_RESPONSE_PARSE_ERROR',

            status:
                response.status,

            details: {
                body_length:
                    cleaned.length,

                content_type:
                    contentType,

                looks_like_sse:
                    cleaned
                        .split(/\r?\n/)
                        .some(
                            (line) =>
                                line
                                    .trim()
                                    .startsWith(
                                        'data:'
                                    )
                        )
            }
        }
    );
}
function isRetryableResponseError(
    error
) {
    return [
        'HUMAIN_EMPTY_RESPONSE',
        'HUMAIN_RESPONSE_PARSE_ERROR',
        'HUMAIN_INVALID_RESPONSE'
    ].includes(
        error?.code
    );
}

async function callGatewayJson(
    options = {}
) {
    const env =
        options.env ||
        process.env;

    const gatewayUrl =
        String(
            env.HUMAIN_GATEWAY_URL ||
            ''
        ).trim();

    const gatewayKey =
        String(
            env.HUMAIN_GATEWAY_KEY ||
            ''
        ).trim();

    const messages =
        options.messages;

    if (!gatewayUrl) {
        throw new HumainAdapterError(
            'HUMAIN_GATEWAY_URL is required',
            {
                code:
                    'HUMAIN_GATEWAY_URL_MISSING'
            }
        );
    }

    if (!gatewayKey) {
        throw new HumainAdapterError(
            'HUMAIN_GATEWAY_KEY is required',
            {
                code:
                    'HUMAIN_GATEWAY_KEY_MISSING'
            }
        );
    }

    if (
        !Array.isArray(messages) ||
        messages.length === 0
    ) {
        throw new HumainAdapterError(
            'messages are required',
            {
                code:
                    'HUMAIN_MESSAGES_REQUIRED'
            }
        );
    }

    const fetchImpl =
        options.fetchImpl ||
        globalThis.fetch;

    if (
        typeof fetchImpl !==
        'function'
    ) {
        throw new HumainAdapterError(
            'fetch is not available',
            {
                code:
                    'HUMAIN_FETCH_UNAVAILABLE'
            }
        );
    }

    const controller =
        new AbortController();

    const timeout =
        setTimeout(
            () =>
                controller.abort(),
            45000
        );

    try {
        const response =
            await fetchImpl(
                gatewayUrl,
                {
                    method:
                        'POST',

                    headers: {
                        'Content-Type':
                            'application/json',

                        Accept:
                            'application/json',

                        'x-repu-ai-key':
                            gatewayKey
                    },

                    body:
                        JSON.stringify({
                            messages
                        }),

                    signal:
                        controller.signal
                }
            );

        const raw =
            await response.text();

        let payload;

        try {
            payload =
                JSON.parse(raw);
        } catch (_) {
            throw new HumainAdapterError(
                'AI gateway returned non-JSON response',
                {
                    code:
                        'HUMAIN_GATEWAY_INVALID_RESPONSE',

                    status:
                        response.status
                }
            );
        }

        if (!response.ok) {
            throw new HumainAdapterError(
                'AI gateway request failed',
                {
                    code:
                        'HUMAIN_GATEWAY_HTTP_ERROR',

                    status:
                        response.status,

                    details: {
                        error:
                            payload?.error ||
                            null,

                        upstream_status:
                            payload
                                ?.upstream_status ??
                            null
                    }
                }
            );
        }

        if (
            payload?.provider !==
                'humain' ||
            typeof payload?.model !==
                'string' ||
            !payload?.data ||
            Array.isArray(
                payload.data
            ) ||
            typeof payload.data !==
                'object'
        ) {
            throw new HumainAdapterError(
                'AI gateway payload is invalid',
                {
                    code:
                        'HUMAIN_GATEWAY_INVALID_RESPONSE'
                }
            );
        }

        if (
            Object.keys(
                payload.data
            ).length ===
            0
        ) {
            throw new HumainAdapterError(
                'AI gateway returned an empty structured output',
                {
                    code:
                        'HUMAIN_EMPTY_STRUCTURED_OUTPUT',

                    status:
                        response.status
                }
            );
        }

        if (
            payload.debug &&
            Object.prototype.hasOwnProperty.call(
                payload.debug,
                'confidence_value'
            )
        ) {
            console.log(
                '[RI HUMAIN confidence]',
                {
                    type:
                        payload.debug
                            .confidence_type,

                    value:
                        payload.debug
                            .confidence_value
                }
            );
        }

        return {
            provider:
                payload.provider,

            model:
                payload.model,

            data:
                payload.data,

            transport:
                'gateway'
        };

    } catch (error) {

        if (
            error instanceof
            HumainAdapterError
        ) {
            throw error;
        }

        if (
            error?.name ===
            'AbortError'
        ) {
            throw new HumainAdapterError(
                'AI gateway request timed out',
                {
                    code:
                        'HUMAIN_GATEWAY_TIMEOUT'
                }
            );
        }

        throw new HumainAdapterError(
            'AI gateway network error',
            {
                code:
                    'HUMAIN_GATEWAY_NETWORK_ERROR',

                details:
                    error?.message ||
                    null
            }
        );

    } finally {
        clearTimeout(
            timeout
        );
    }
}

async function callHumainJson(
    options = {}
) {
    const transportEnv =
        options.env ||
        process.env;

    const transport =
        String(
            transportEnv.HUMAIN_TRANSPORT ||
            'direct'
        )
            .trim()
            .toLowerCase();

    if (
        transport ===
        'gateway'
    ) {
        return await callGatewayJson(
            options
        );
    }

    const fetchImpl =
        options.fetchImpl ||
        globalThis.fetch;

    if (
        typeof fetchImpl !==
        'function'
    ) {
        throw new HumainAdapterError(
            'fetch is not available',
            {
                code:
                    'HUMAIN_FETCH_UNAVAILABLE'
            }
        );
    }

    const config = {
        ...getHumainConfig(
            options.env
        ),
        ...(options.config || {})
    };

    assertHumainConfig(
        config
    );

    const messages =
        options.messages;

    if (
        !Array.isArray(messages) ||
        messages.length === 0
    ) {
        throw new HumainAdapterError(
            'messages are required',
            {
                code:
                    'HUMAIN_MESSAGES_REQUIRED'
            }
        );
    }

    let lastError = null;

    for (
        let attempt = 1;
        attempt <= MAX_RESPONSE_ATTEMPTS;
        attempt += 1
    ) {
        const controller =
            new AbortController();

        const timeout =
            setTimeout(
                () =>
                    controller.abort(),
                config.timeoutMs
            );

        try {
            const response =
                await fetchImpl(
                    `${config.baseUrl}/chat/completions`,
                    {
                        method:
                            'POST',

                        headers: {
                            'Content-Type':
                                'application/json',

                            'x-api-key':

                                config.apiKey,


                        },

                        body:
                            JSON.stringify({
                                model:
                                    config.model,

                                messages,

                                temperature: 0,

                                response_format: {
                                    type:
                                        'json_object'
                                }
                            }),

                        signal:
                            controller.signal
                    }
                );

            let payload;

            try {
                payload =
                    await readResponsePayload(
                        response
                    );
            } catch (error) {
                if (
                    response.ok &&
                    attempt <
                        MAX_RESPONSE_ATTEMPTS &&
                    isRetryableResponseError(
                        error
                    )
                ) {
                    lastError =
                        error;

                    continue;
                }

                throw error;
            }

            if (!response.ok) {
                throw new HumainAdapterError(
                    'HUMAIN request failed',
                    {
                        code:
                            'HUMAIN_HTTP_ERROR',

                        status:
                            response.status,

                        details:
                            payload
                    }
                );
            }

            let text;

            try {
                text =
                    extractAssistantText(
                        payload
                    );
            } catch (error) {
                if (
                    attempt <
                        MAX_RESPONSE_ATTEMPTS &&
                    isRetryableResponseError(
                        error
                    )
                ) {
                    lastError =
                        error;

                    continue;
                }

                throw error;
            }

            return {
                provider:
                    'humain',

                model:
                    config.model,

                data:
                    parseStrictJson(
                        text
                    ),

                attempts:
                    attempt
            };

        } catch (error) {
            if (
                error instanceof
                HumainAdapterError
            ) {
                lastError =
                    error;

                if (
                    attempt <
                        MAX_RESPONSE_ATTEMPTS &&
                    isRetryableResponseError(
                        error
                    )
                ) {
                    continue;
                }

                throw error;
            }

            if (
                error &&
                error.name ===
                'AbortError'
            ) {
                throw new HumainAdapterError(
                    'HUMAIN request timed out',
                    {
                        code:
                            'HUMAIN_TIMEOUT'
                    }
                );
            }

            throw new HumainAdapterError(
                'HUMAIN network error',
                {
                    code:
                        'HUMAIN_NETWORK_ERROR',

                    details:
                        error?.message ||
                        null
                }
            );

        } finally {
            clearTimeout(
                timeout
            );
        }
    }

    throw (
        lastError ||
        new HumainAdapterError(
            'HUMAIN request failed',
            {
                code:
                    'HUMAIN_INVALID_RESPONSE'
            }
        )
    );
}

module.exports = {
    DEFAULT_HUMAIN_MODEL,
    DEFAULT_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
    MAX_RESPONSE_ATTEMPTS,
    HumainAdapterError,
    getHumainConfig,
    assertHumainConfig,
    extractAssistantText,
    parseStrictJson,
    parseSsePayload,
    readResponsePayload,
    callHumainJson
};
