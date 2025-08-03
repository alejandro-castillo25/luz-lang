# Luz

## CLI Usage


```bash
luz [options] [command]
```

> [!TIP]
> You can use the help command to get more info about each command

```bash
luz help
```
or
```bash
luz --help
```

### Run a file

```bash
luz run|r [options] <filepath>
```
or
```bash
luz <filepath> 
```

- You can also enable the development flag, so you get extra information at the end of the runtime

```bash
luz run|r --debug <filepath>
```



## Development

Luz is an interpreted programming language (with no previous optimizations so far)

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
        |> parseLogicalOr   // ||
            |> parseNullish   // ??
                |> parseLogicalAnd  // &&
                    |> parseEquality // ==, !=
                        |> parseComparision // <. >, <=, >=
                            |> parseAddSub    // +, -
                                |> parseMulDiv // *, /, %. ~/
                                    |> parsePow // **
                                        |> parseBitwise // &, |, ^, <<, >>, >>>
                                            |> parseAs // as
                                                |> parseUnary  // prefix +/-, ++/--, !, ~, {puts}, del
                                                    |> parsePostfix // ++/--
                                                        |> parseIfExpression // if, else
                                                            |> parseLoopExpression // loop
                                                                |> parsePrimary // literals, vars, (), ...

</pre>
