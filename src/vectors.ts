// The official RFC 8785 (JCS) test vectors, embedded verbatim.
//
// Source: the reference implementation repository accompanying the RFC,
// https://github.com/cyberphone/json-canonicalization, `testdata/input` and
// `testdata/output`. Generated from those files, not transcribed by hand: a
// canonicalization vector that picked up a stray edit would silently certify
// the wrong bytes.
//
// `input` is the raw JSON text and is parsed at run time rather than stored as
// a JavaScript literal, so that escapes, control characters and lone surrogates
// survive exactly as the vector intends. `expected` is the canonical form, to
// be compared byte for byte: canonicalization is a specification, and "close"
// is a failure.
//
// What each vector is for:
//
//   arrays      array element order is preserved while object keys inside are
//               sorted, and numeric-looking keys sort as strings ("1" < "10")
//   french      sorting must ignore locale; French collation would order these
//               differently and is wrong here
//   structures  nested objects, the empty key, and case-sensitive ordering
//               (uppercase sorts before lowercase, because "A" < "a")
//   unicode     unnormalized Unicode is left alone: canonicalization does not
//               apply NFC, so "A" + U+030A stays two code points
//   values      the ES6 Number::toString algorithm (1E30 -> 1e+30, 4.50 -> 4.5,
//               2e-3 -> 0.002) plus JSON string escaping rules
//   weird       the discriminating case for sort order. U+1F602 must sort
//               BEFORE U+FB33, which holds for UTF-16 code units
//               (0xD83D < 0xFB33) and fails for code points (0x1F602 > 0xFB33).
//               A implementation sorting by code point passes every other
//               vector and fails this one.

export interface Vector {
  name: string;
  about: string;
  /** Raw JSON source text. Parse it; do not hand-build the value. */
  input: string;
  /** The canonical form, byte for byte. */
  expected: string;
}

export const RFC8785_VECTORS: ReadonlyArray<Vector> = [
  {
    name: "arrays",
    about: "array order preserved, inner object keys sorted, numeric-looking keys sort as strings",
    input: "[\n  56,\n  {\n    \"d\": true,\n    \"10\": null,\n    \"1\": [ ]\n  }\n]\n",
    expected: "[56,{\"1\":[],\"10\":null,\"d\":true}]",
  },
  {
    name: "french",
    about: "sorting must ignore locale, French collation is wrong here",
    input: "{\n  \"peach\": \"This sorting order\",\n  \"p\u00e9ch\u00e9\": \"is wrong according to French\",\n  \"p\u00eache\": \"but canonicalization MUST\",\n  \"sin\":   \"ignore locale\"\n}\n",
    expected: "{\"peach\":\"This sorting order\",\"p\u00e9ch\u00e9\":\"is wrong according to French\",\"p\u00eache\":\"but canonicalization MUST\",\"sin\":\"ignore locale\"}",
  },
  {
    name: "structures",
    about: "nesting, the empty key, and case-sensitive ordering",
    input: "{\n  \"1\": {\"f\": {\"f\": \"hi\",\"F\": 5} ,\"\\n\": 56.0},\n  \"10\": { },\n  \"\": \"empty\",\n  \"a\": { },\n  \"111\": [ {\"e\": \"yes\",\"E\": \"no\" } ],\n  \"A\": { }\n}",
    expected: "{\"\":\"empty\",\"1\":{\"\\n\":56,\"f\":{\"F\":5,\"f\":\"hi\"}},\"10\":{},\"111\":[{\"E\":\"no\",\"e\":\"yes\"}],\"A\":{},\"a\":{}}",
  },
  {
    name: "unicode",
    about: "unnormalized Unicode is preserved, no NFC is applied",
    input: "{\n  \"Unnormalized Unicode\":\"A\\u030a\"\n}\n",
    expected: "{\"Unnormalized Unicode\":\"A\u030a\"}",
  },
  {
    name: "values",
    about: "ES6 Number::toString serialization and JSON string escapes",
    input: "{\n  \"numbers\": [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001],\n  \"string\": \"\\u20ac$\\u000F\\u000aA'\\u0042\\u0022\\u005c\\\\\\\"\\/\",\n  \"literals\": [null, true, false]\n}",
    expected: "{\"literals\":[null,true,false],\"numbers\":[333333333.3333333,1e+30,4.5,0.002,1e-27],\"string\":\"\u20ac$\\u000f\\nA'B\\\"\\\\\\\\\\\"/\"}",
  },
  {
    name: "weird",
    about: "the discriminating case: UTF-16 code-unit order, not code-point order",
    input: "{\n  \"\\u20ac\": \"Euro Sign\",\n  \"\\r\": \"Carriage Return\",\n  \"\\u000a\": \"Newline\",\n  \"1\": \"One\",\n  \"\\u0080\": \"Control\\u007f\",\n  \"\\ud83d\\ude02\": \"Smiley\",\n  \"\\u00f6\": \"Latin Small Letter O With Diaeresis\",\n  \"\\ufb33\": \"Hebrew Letter Dalet With Dagesh\",\n  \"</script>\": \"Browser Challenge\"\n}\n",
    expected: "{\"\\n\":\"Newline\",\"\\r\":\"Carriage Return\",\"1\":\"One\",\"</script>\":\"Browser Challenge\",\"\u0080\":\"Control\u007f\",\"\u00f6\":\"Latin Small Letter O With Diaeresis\",\"\u20ac\":\"Euro Sign\",\"\ud83d\ude02\":\"Smiley\",\"\ufb33\":\"Hebrew Letter Dalet With Dagesh\"}",
  },
];
