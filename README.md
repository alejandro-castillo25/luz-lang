# jasonflow

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.2.9. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.

## Precedence Chain so far:

<pre>
parseExpression
|> parseAssignment // =, +=, ...
    |> parseRange   // .. ..=
        |> parseConditional   (?:)
            |> parseLogicalOr   // ||
                |> parseNullish   // ||
                |> parseLogicalAnd  // &&
                    |> parseEquality() // ==, !=
                        |> parseComparision() // <. >, <=, >=
                            |> parseAddSub    // +, -
                                |> parseMulDiv // *, /, %. ~/
                                    |> parsePow // **
                                        |> parseBitwise // &, |, ^, <<, >>, >>>
                                            |> parseAs // as
                                                |> parseUnary  // prefix +/-, ++/--, !, ~, {puts}, del
                                                    |> parsePostfix // ++/--
                                                        |> parseIfExpression // if, else
                                                            |> parseLoopExpression // loop
                                                                |> parsePrimary //literals, vars, (), ...

</pre>
