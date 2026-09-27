'use strict';

const assert = require('assert');

const {
    DEFAULT_HUMAIN_MODEL,
    HumainAdapterError,
    getHumainConfig,
    extractAssistantText,
    parseStrictJson,
    parseSsePayload,
    callHumainJson
} = require('../intelligence/humain-adapter');

async function expectError(
    fn,
    code
) {
    let thrown = null;

    try {
        await fn();
    } catch (error) {
        thrown = error;
    }

    assert.ok(
        thrown instanceof
        HumainAdapterError
    );

    assert.strictEqual(
        thrown.code,
        code
    );
}

async function run() {

    // --------------------------------------------------------
    // config
    // --------------------------------------------------------

    {
        const config =
            getHumainConfig({
                HUMAIN_API_KEY:
                    'test-key',

                HUMAIN_BASE_URL:
                    'https://example.test/v1/',

                HUMAIN_MODEL:
                    'test-model',

                HUMAIN_TIMEOUT_MS:
                    '5000'
            });

        assert.strictEqual(
            config.apiKey,
            'test-key'
        );

        assert.strictEqual(
            config.baseUrl,
            'https://example.test/v1'
        );

        assert.strictEqual(
            config.model,
            'test-model'
        );

        assert.strictEqual(
            config.timeoutMs,
            5000
        );
    }

    {
        const config =
            getHumainConfig({});

        assert.strictEqual(
            config.model,
            DEFAULT_HUMAIN_MODEL
        );
    }

    // --------------------------------------------------------
    // response extraction
    // --------------------------------------------------------

    assert.strictEqual(
        extractAssistantText({
            choices: [
                {
                    message: {
                        content:
                            '{"ok":true}'
                    }
                }
            ]
        }),
        '{"ok":true}'
    );

    // --------------------------------------------------------
    // strict JSON
    // --------------------------------------------------------

    assert.deepStrictEqual(
        parseStrictJson(
            '{"likely_cause":"x"}'
        ),
        {
            likely_cause:
                'x'
        }
    );

    await expectError(
        async () =>
            parseStrictJson(
                '```json\n{"ok":true}\n```'
            ),
        'HUMAIN_INVALID_JSON'
    );

    await expectError(
        async () =>
            parseStrictJson(
                'not json'
            ),
        'HUMAIN_INVALID_JSON'
    );

    // --------------------------------------------------------
    // SSE / streamed OpenAI-compatible response
    // --------------------------------------------------------

    {
        const raw = [
            'data: {"choices":[{"index":0,"delta":{"content":"{\\"ok\\":"}}]}',
            '',
            'data: {"choices":[{"index":0,"delta":{"content":"true}"}}]}',
            '',
            'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
            '',
            'data: [DONE]'
        ].join('\n');

        const payload =
            parseSsePayload(
                raw
            );

        assert.strictEqual(
            payload
                .choices[0]
                .message
                .content,
            '{"ok":true}'
        );

        assert.strictEqual(
            payload
                .choices[0]
                .finish_reason,
            'stop'
        );
    }
    // --------------------------------------------------------
    // successful mock call
    // --------------------------------------------------------

    {
        let capturedUrl = null;
        let capturedOptions = null;

        const fakeFetch =
            async (
                url,
                options
            ) => {
                capturedUrl = url;
                capturedOptions =
                    options;

                return {
                    ok: true,
                    status: 200,

                    async json() {
                        return {
                            choices: [
                                {
                                    message: {
                                        content:
                                            JSON.stringify({
                                                likely_cause:
                                                    'سبب محتمل',

                                                recommended_action:
                                                    'إجراء مقترح'
                                            })
                                    }
                                }
                            ]
                        };
                    }
                };
            };

        const result =
            await callHumainJson({
                env: {
                    HUMAIN_API_KEY:
                        'fake-key',

                    HUMAIN_BASE_URL:
                        'https://example.test/v1',

                    HUMAIN_MODEL:
                        'fake-model'
                },

                fetchImpl:
                    fakeFetch,

                messages: [
                    {
                        role:
                            'user',

                        content:
                            'test'
                    }
                ]
            });

        assert.strictEqual(
            capturedUrl,
            'https://example.test/v1/chat/completions'
        );

        assert.strictEqual(
            capturedOptions.method,
            'POST'
        );

        assert.strictEqual(
            capturedOptions.headers['x-api-key'],
            'fake-key'
        );

        const body =
            JSON.parse(
                capturedOptions.body
            );

        assert.strictEqual(
            body.model,
            'fake-model'
        );

        assert.strictEqual(
            body.temperature,
            0
        );

        assert.deepStrictEqual(
            body.response_format,
            {
                type:
                    'json_object'
            }
        );

        assert.strictEqual(
            result.provider,
            'humain'
        );

        assert.strictEqual(
            result.model,
            'fake-model'
        );

        assert.strictEqual(
            result.data.likely_cause,
            'سبب محتمل'
        );
    }

    // --------------------------------------------------------
    // Research response with no final content:
    // reasoning_content must NOT be treated as final answer.
    // --------------------------------------------------------

    {
        let thrown = null;

        try {
            extractAssistantText({
                choices: [
                    {
                        finish_reason:
                            'stop',

                        message: {
                            role:
                                'assistant',

                            content:
                                null,

                            reasoning_content:
                                'internal reasoning'
                        }
                    }
                ]
            });
        } catch (error) {
            thrown = error;
        }

        assert.ok(
            thrown instanceof
            HumainAdapterError
        );

        assert.strictEqual(
            thrown.code,
            'HUMAIN_INVALID_RESPONSE'
        );

        assert.strictEqual(
            thrown.details.content_is_null,
            true
        );

        assert.strictEqual(
            thrown.details.has_reasoning_content,
            true
        );

        assert.strictEqual(
            thrown.details.finish_reason,
            'stop'
        );
    }

    // --------------------------------------------------------
    // Gateway must reject an empty structured output.
    // --------------------------------------------------------

    await expectError(
        () =>
            callHumainJson({
                env: {
                    HUMAIN_TRANSPORT:
                        'gateway',

                    HUMAIN_GATEWAY_URL:
                        'https://gateway.example.test',

                    HUMAIN_GATEWAY_KEY:
                        'fake-gateway-key'
                },

                fetchImpl:
                    async () => ({
                        ok: true,
                        status: 200,

                        async text() {
                            return JSON.stringify({
                                provider:
                                    'humain',

                                model:
                                    'humain-m3-preview',

                                data: {}
                            });
                        }
                    }),

                messages: [
                    {
                        role:
                            'user',

                        content:
                            'test'
                    }
                ]
            }),
        'HUMAIN_EMPTY_STRUCTURED_OUTPUT'
    );

    // --------------------------------------------------------
    // missing key
    // --------------------------------------------------------

    await expectError(
        () =>
            callHumainJson({
                env: {
                    HUMAIN_BASE_URL:
                        'https://example.test/v1'
                },

                fetchImpl:
                    async () => {
                        throw new Error(
                            'must not run'
                        );
                    },

                messages: [
                    {
                        role:
                            'user',

                        content:
                            'test'
                    }
                ]
            }),
        'HUMAIN_API_KEY_MISSING'
    );

    // --------------------------------------------------------
    // HTTP failure
    // --------------------------------------------------------

    await expectError(
        () =>
            callHumainJson({
                env: {
                    HUMAIN_API_KEY:
                        'fake',

                    HUMAIN_BASE_URL:
                        'https://example.test/v1'
                },

                fetchImpl:
                    async () => ({
                        ok: false,
                        status: 429,

                        async json() {
                            return {
                                error:
                                    'rate limit'
                            };
                        }
                    }),

                messages: [
                    {
                        role:
                            'user',

                        content:
                            'test'
                    }
                ]
            }),
        'HUMAIN_HTTP_ERROR'
    );

    console.log(
        'RI-1D.2 HUMAIN adapter mock tests passed'
    );
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
