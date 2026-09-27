import unittest

from lambda_function import (
    HumainStructuredOutputError,
    extract_structured_output,
)


class ExtractStructuredOutputTests(unittest.TestCase):
    def assert_output_error(self, content, code):
        with self.assertRaises(
            HumainStructuredOutputError
        ) as raised:
            extract_structured_output(content)

        self.assertEqual(
            raised.exception.code,
            code
        )

    def test_raw_valid_json(self):
        self.assertEqual(
            extract_structured_output(
                '{"likely_cause":"x","confidence":0.3}'
            ),
            {
                "likely_cause": "x",
                "confidence": 0.3,
            }
        )

    def test_json_fenced(self):
        self.assertEqual(
            extract_structured_output(
                '```json\n'
                '{"likely_cause":"x","confidence":0.3}\n'
                '```'
            ),
            {
                "likely_cause": "x",
                "confidence": 0.3,
            }
        )

    def test_plain_fenced(self):
        self.assertEqual(
            extract_structured_output(
                '```\n'
                '{"likely_cause":"x","confidence":0.3}\n'
                '```'
            ),
            {
                "likely_cause": "x",
                "confidence": 0.3,
            }
        )

    def test_empty_object(self):
        self.assert_output_error(
            '{}',
            'HUMAIN_EMPTY_STRUCTURED_OUTPUT'
        )

    def test_array(self):
        self.assert_output_error(
            '[{"a":1}]',
            'HUMAIN_STRUCTURED_OUTPUT_INVALID_TYPE'
        )

    def test_null(self):
        self.assert_output_error(
            'null',
            'HUMAIN_STRUCTURED_OUTPUT_INVALID_TYPE'
        )

    def test_scalar_string(self):
        self.assert_output_error(
            '"hello"',
            'HUMAIN_STRUCTURED_OUTPUT_INVALID_TYPE'
        )

    def test_scalar_number(self):
        self.assert_output_error(
            '123',
            'HUMAIN_STRUCTURED_OUTPUT_INVALID_TYPE'
        )

    def test_scalar_boolean(self):
        self.assert_output_error(
            'true',
            'HUMAIN_STRUCTURED_OUTPUT_INVALID_TYPE'
        )

    def test_malformed_json(self):
        self.assert_output_error(
            '{"a":',
            'HUMAIN_STRUCTURED_OUTPUT_PARSE_FAILED'
        )

    def test_prose_before_json(self):
        self.assert_output_error(
            'Here is the result:\n{"a":1}',
            'HUMAIN_STRUCTURED_OUTPUT_PARSE_FAILED'
        )

    def test_prose_after_json(self):
        self.assert_output_error(
            '{"a":1}\nDone.',
            'HUMAIN_STRUCTURED_OUTPUT_PARSE_FAILED'
        )

    def test_multiple_fences(self):
        self.assert_output_error(
            '```json\n{"a":1}\n```\n\n'
            '```json\n{"b":2}\n```',
            'HUMAIN_STRUCTURED_OUTPUT_PARSE_FAILED'
        )

    def test_prose_outside_fence(self):
        self.assert_output_error(
            'Result:\n```json\n{"a":1}\n```',
            'HUMAIN_STRUCTURED_OUTPUT_PARSE_FAILED'
        )

    def test_whitespace_around_raw_json(self):
        self.assertEqual(
            extract_structured_output(
                '   {"a":1}   '
            ),
            {"a": 1}
        )

    def test_whitespace_around_full_fence(self):
        self.assertEqual(
            extract_structured_output(
                '  \n```json\n{"a":1}\n```\n  '
            ),
            {"a": 1}
        )


if __name__ == '__main__':
    unittest.main()
