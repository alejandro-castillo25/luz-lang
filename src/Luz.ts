import psp from "prompt-sync";
import fs from "fs";

export interface LuzObj {
  vars?: Record<string, any>;
  expr: string;
}

interface LuzVar {
  value: any;
  type?: (typeof Luz.TYPES)[number];
  const?: true;
}

export type LuzVars = Map<string, any>;

export type StructType = {
  __type: "arr" | "vec" | "set";
  __value: Array<any> | StructType;
};

export class LuzSet<T> extends Set<T> {
  private _last: T | undefined = undefined;

  constructor(val?: any) {
    if (Array.isArray(val)) {
      super(val);

      this._last = val[val.length - 1];
      return;
    }

    super(val);
  }
  add(value: T): this {
    super.add(value);
    this._last = value;
    return this;
  }

  get last() {
    return this._last;
  }
}

export class Range {
  readonly __type = "ran";
  constructor(public start: number, public end: number) {}

  get __value() {
    return this.generate();
  }

  private *generate() {
    let current = this.start;
    const step = Math.sign(this.end - this.start);

    while (step > 0 ? current < this.end : current > this.end) {
      yield current;
      current += step;
    }
  }
}

export class XRange {
  readonly __type = "xran";
  constructor(public start: number, public end: number) {}

  get __value() {
    return this.generate();
  }

  private *generate() {
    let current = this.start;
    const step = Math.sign(this.end - this.start);

    while (step > 0 ? current <= this.end : current >= this.end) {
      yield current;
      current += step;
    }
  }
}

export const enum ExitCode {
  Success,
  Error,
  SystaxError,
  SemanticError,
  RuntimeError,
  FileNotFound,
  PermissionDenied,
  InvalidInstruction,
  OutOfMemory,
  InternalInterpreterError,
  UnimplementedFeature,
}

export class BreakSignal extends Error {
  constructor(public value: any) {
    super("Break statement");
  }
}

export class ContinueSignal extends Error {
  constructor() {
    super("Continue statement");
  }
}

export class Luz {
  private obj: Record<string, any> = {};
  private expr: string;
  private vars: LuzVars = new Map<string, LuzVar>();

  private tokens: string[] = [];
  private pos = 0;
  private rl = psp({
    sigint: true,
  });

  private pipeStdin: string[] | null = null;

  public static KEYWORDS = [
    // "this",
    // "root",
    "if",
    "else",
    "loop",
    "in",
    "break",
    "continue",
    "fn",
    "return",
    "const",
    // "for",
    // "while",
    "del",
    "has", //TODO
    "as",

    "lenof",
    "typeof",
    "copyof",
    "sizeof",

    "firstof",
    "lastof",

    "log",
    "logln",
    "get",
  ] as const;

  public static TYPES = [
    "num",
    "xl",
    "bool",
    "str",
    "null",
    "maybe", // ???
    "arr",
    "vec",
    "set",
    "inf",
    "ran",
    "xran",
  ] as const;

  //! the \r is not detected, but WHY
  public static tokensRegExp: RegExp =
    /\?\?|<=>|\,|\.\.\=?|\@\{|!\[|\*\*\=?|~\/\=?|<<|>>>?|~|-(?:-|=)|[<>]?\-[<>]?|\+\+|(\d|_)+XL|(?:\d|_)*\.?\d+|(?:#|\/\/).*|\/\*(?:.|\n|\r)*?\*\/|\'(?:.|\n|\r)*?(?<!\\)\'|\"(?:.|\n|\r)*?(?<!\\)\"|\`(?:.|\n|\r)*?(?<!\\)\`|(?:[=!\-\+*<>%\^\?]|\/\/?)\=?|[\$\w]+|\.|\|\||[\(\)\[\]\{\}%\?:]|\&\&|[&|^]|(?<!(?:;|^));/gi;

  // public static tokensRegExp: RegExp =
  //   /\.\.\=?|(?:!|@)\[|\*\*\=?|~\/\=?|<<|>>>?|~|-(?:-|=)|[<>]?\-[<>]?|\+\+|(\d|_)+XL|(?:\d|_)*\.?\d+|(?:#|\/\/).*|\/\*(?:[^\r]|\n)*?\*\/|\'(?:[^\r\']|\\.)*?(?<!\\)\'|\"(?:[^\r\"]|\\.)*?(?<!\\)\"|(?:[=!\-\+*<>%\^\?]|\/\/?)\=?|[\$\w]+|\.|\|\||[\(\)\[\]\{\}%\?:]|\&\&|[&|^]|(?<!(?:;|^));/gi;

  constructor({ vars, expr }: LuzObj) {
    this.vars = vars
      ? new Map(
          Object.entries(vars).map((el: [string, LuzVar]) => {
            const value = el[1].value;
            const type = el[1].type;

            const lusVar = {
              value,
              type,
            } as LuzVar;

            if ("const" in el[1]) lusVar.const = true;

            return [el[0], lusVar];
          })
        )
      : new Map();

    // this.expr = expr.replace(/\r/g, "");
    this.expr = expr;
    this.pipeStdin =
      process.stdin.isTTY === true
        ? null
        : fs.readFileSync(0, "utf-8").split(/\n/g);
  }

  public run(): number {
    this.tokens = this.expr.match(Luz.tokensRegExp) ?? [];

    this.pos = 0;

    try {
      while (this.pos < this.tokens.length) {
        this.parseStatement();
      }
      return ExitCode.Success;
    } catch (err: any) {
      if (err instanceof BreakSignal) {
        throw err;
      }
      console.error(err.message);
      return err.code ?? ExitCode.RuntimeError;
    }
  }

  private parseStatement(): any {
    const value = this.parseExpression();

    const term = this.peek();

    if (term === ";") {
      this.next();
    }

    return value;
  }
  private parseExpression(): any {
    if (this.isComment(this.peek())) {
      this.next();
      return;
    }

    const swapResult = this.parseSwap();
    if (swapResult !== null) return swapResult;

    return this.parseAssignment();
  }

  private parseSwap(): any {
    const startPos = this.pos;
    const left = this.tryParseLValue();
    if (left) {
      if (this.peek() === "<=>") {
        this.next();
        const right = this.tryParseLValue();
        if (!right)
          throw {
            message: "Right side of swap must be an l-value",
            code: ExitCode.SystaxError,
          };

        const a = left.get();
        const b = right.get();
        if (a !== b) {
          left.set(b);
          right.set(a);
          return true;
        } else {
          return false;
        }
      }
    }
    //! Reset pos
    this.pos = startPos;
    return null;
  }

  private parseBlock(): any {
    const outerKeys = new Set(this.vars.keys());

    this.next();

    let lastVal: any = null;
    while (this.peek() !== "}") {
      lastVal = this.parseExpression();

      if (this.peek() === ";") this.next();
    }

    this.next();

    for (const name of Array.from(this.vars.keys()))
      if (!outerKeys.has(name)) this.vars.delete(name);

    return lastVal;
  }

  private getUnderlyingValue(obj: any): any {
    return typeof obj === "object" && obj !== null && "__type" in obj
      ? obj.__value
      : obj;
  }
  private checkHas(left: any, right: any): boolean {
    if (left === null || left === undefined) return false;

    if (left instanceof Range || left instanceof XRange) {
      if (typeof right !== "number") return false;
      return left.__type === "ran"
        ? right >= left.start && right < left.end
        : right >= left.start && right <= left.end;
    }

    // Handle Luz structured types
    if (typeof left === "object" && left !== null && "__type" in left) {
      const type = left.__type;
      const value = left.__value;
      switch (type) {
        case "set":
          return value.has(right);
        case "arr":
        case "vec":
          return value.includes(right);
        default:
          throw {
            message: `'has' not supported for ${type}`,
            code: ExitCode.SemanticError,
          };
      }
    }

    // Handle JavaScript types
    if (Array.isArray(left)) return left.includes(right);
    if (typeof left === "string") return left.includes(String(right));
    if (left instanceof Set) return left.has(right);

    throw {
      message: `'has' not supported for ${typeof left}`,
      code: ExitCode.SemanticError,
    };
  }

  private skipStatementOrBlock(): void {
    if (this.peek() === "{") {
      let depth = 0;
      do {
        const tok = this.next();
        if (tok === "{") depth++;
        else if (tok === "}") depth--;
      } while (this.pos < this.tokens.length && depth > 0);
      return;
    }

    while (this.pos < this.tokens.length) {
      const t = this.peek();

      if (t === ";") {
        this.next();
        break;
      }

      if (t === "}" || t === "else" || t === "") break;

      this.next();
    }
  }

  private evaluateCondition(
    conditionStart: number,
    conditionEnd: number
  ): boolean {
    const originalPos = this.pos;
    this.pos = conditionStart;
    let value;
    try {
      value = this.parseExpression();
      if (this.pos - 1 !== conditionEnd) {
        throw new Error("Condition parsing did not consume expected tokens");
      }
    } finally {
      this.pos = originalPos;
    }
    return Boolean(value);
  }
  //!
  private parseLoopExpression(): any {
    this.next(); // Consume 'loop'

    // Handle infinite loops first
    if (this.peek() === "{") {
      this.next(); // Consume '{'
      const loopBodyStart = this.pos;
      let depth = 1;

      // Find matching closing brace
      while (this.pos < this.tokens.length && depth > 0) {
        const token = this.next();
        if (token === "{") depth++;
        if (token === "}") depth--;
      }
      const loopBodyEnd = this.pos - 1;

      const varsBeforeLoop = new Set(this.vars.keys());
      let finalValue = null;

      try {
        while (true) {
          const varsBeforeIteration = new Set(this.vars.keys());
          try {
            this.pos = loopBodyStart;
            while (this.pos < loopBodyEnd) {
              this.parseStatement();
            }
          } catch (error) {
            if (error instanceof BreakSignal) {
              finalValue = error.value;
              break;
            } else if (error instanceof ContinueSignal) {
              continue;
            }
            throw error;
          } finally {
            // Clean up variables created in this iteration
            for (const name of Array.from(this.vars.keys())) {
              if (!varsBeforeIteration.has(name)) {
                this.vars.delete(name);
              }
            }
          }
        }
      } finally {
        // Clean up variables created in entire loop
        for (const name of Array.from(this.vars.keys())) {
          if (!varsBeforeLoop.has(name)) {
            this.vars.delete(name);
          }
        }
        this.pos = loopBodyEnd + 1;
      }
      return finalValue;
    }

    // Handle loops with conditions
    let loopVariable: string | null = null;
    let iterable: any;
    let isWhileLoop = false;
    let conditionStart = -1;
    let conditionEnd = -1;
    let hasParen = false;

    // Check for optional parentheses
    if (this.peek() === "(") {
      hasParen = true;
      this.next();
    }

    // Parse loop header
    if (this.isVariableToken(this.peek()) && this.peek(1) === "in") {
      // For-in loop
      loopVariable = this.next();
      this.next(); // Consume 'in'
      iterable = this.parseExpression();

      if (hasParen) {
        if (this.peek() !== ")") {
          throw {
            message: "Expected ')' after for-in expression",
            code: ExitCode.SystaxError,
          };
        }
        this.next(); // Consume ')'
      }
    } else {
      // While-style loop
      isWhileLoop = true;
      conditionStart = this.pos;

      if (hasParen) {
        // Parenthesized condition
        let depth = 0;
        while (this.pos < this.tokens.length) {
          const token = this.peek();
          if (token === ")") {
            if (depth === 0) {
              conditionEnd = this.pos - 1;
              this.next(); // Consume ')'
              break;
            }
            depth--;
          }
          if (token === "(") depth++;
          this.next();
        }
      } else {
        // Bare condition
        let depth = 0;
        while (this.pos < this.tokens.length) {
          const token = this.peek();
          if (token === "{" && depth === 0) break;
          if (token === "(" || token === "[" || token === "{") depth++;
          if (token === ")" || token === "]" || token === "}") depth--;
          this.next();
        }
        conditionEnd = this.pos - 1;
      }
    }

    // Validate loop body start
    if (this.peek() !== "{") {
      throw {
        message: "Expected '{' after loop header",
        code: ExitCode.SystaxError,
      };
    }
    this.next();

    // Parse loop body
    const loopBodyStart = this.pos;
    let depth = 1;
    while (this.pos < this.tokens.length && depth > 0) {
      const token = this.next();
      if (token === "{") depth++;
      if (token === "}") depth--;
    }
    const loopBodyEnd = this.pos - 1;

    const varsBeforeLoop = new Set(this.vars.keys());
    let finalValue = null;

    try {
      if (loopVariable !== null) {
        // For-in loop execution
        const elements = this.getIterableElements(iterable);
        for (const element of elements) {
          this.vars.set(loopVariable, { value: element });
          const varsBeforeIteration = new Set(this.vars.keys());
          try {
            this.pos = loopBodyStart;
            while (this.pos < loopBodyEnd) {
              this.parseStatement();
            }
          } catch (error) {
            if (error instanceof BreakSignal) {
              finalValue = error.value;
              break;
            } else if (error instanceof ContinueSignal) {
              continue;
            }
            throw error;
          } finally {
            for (const name of Array.from(this.vars.keys())) {
              if (!varsBeforeIteration.has(name) && name !== loopVariable) {
                this.vars.delete(name);
              }
            }
          }
        }
      } else if (isWhileLoop) {
        // While loop execution
        while (true) {
          const conditionValue = this.evaluateCondition(
            conditionStart,
            conditionEnd
          );
          if (!conditionValue) break;

          const varsBeforeIteration = new Set(this.vars.keys());
          try {
            this.pos = loopBodyStart;
            while (this.pos < loopBodyEnd) {
              this.parseStatement();
            }
          } catch (error) {
            if (error instanceof BreakSignal) {
              finalValue = error.value;
              break;
            } else if (error instanceof ContinueSignal) {
              continue;
            }
            throw error;
          } finally {
            for (const name of Array.from(this.vars.keys())) {
              if (!varsBeforeIteration.has(name)) {
                this.vars.delete(name);
              }
            }
          }
        }
      }
    } catch (error) {
      if (!(error instanceof BreakSignal)) throw error;
    } finally {
      for (const name of Array.from(this.vars.keys())) {
        if (!varsBeforeLoop.has(name)) {
          this.vars.delete(name);
        }
      }
      if (loopVariable) {
        this.vars.delete(loopVariable);
      }
      this.pos = loopBodyEnd + 1;
    }

    return finalValue;
  }

  //!

  private tryParseLValue(): { get: () => any; set: (v: any) => void } | null {
    const initialState = { pos: this.pos, vars: new Map(this.vars) };
    let varName: string | null = null;
    const indices: any[] = [];

    try {
      if (!this.isVariableToken(this.peek())) return null;
      varName = this.next();

      // Parse indices
      while (this.peek() === "[") {
        this.next();
        const index = this.parseExpression();
        indices.push(index);
        if (this.peek() !== "]") throw new Error("Expected ]");
        this.next();
      }

      // Validate variable exists and is mutable
      if (!this.vars.has(varName))
        throw new Error(`Undefined variable '${varName}'`);
      const varData = this.vars.get(varName)!;
      if (varData.const) throw new Error(`Cannot modify constant '${varName}'`);

      return {
        get: () => {
          let value = varData.value;
          for (const indexExpr of indices) {
            const idx = this.evalIndex(indexExpr, value);
            value = value.__value[idx];
          }
          return value;
        },
        set: (newValue: any) => {
          let container = varData.value;
          const resolvedIndices = [];
          for (const indexExpr of indices) {
            const idx = this.evalIndex(indexExpr, container);
            resolvedIndices.push(idx);
            container = container.__value[idx];
          }
          if (resolvedIndices.length === 0) {
            varData.value = newValue;
          } else {
            let parent = varData.value;
            for (let i = 0; i < resolvedIndices.length - 1; i++) {
              parent = parent.__value[resolvedIndices[i]!];
            }
            const lastIdx = resolvedIndices[resolvedIndices.length - 1];
            parent.__value[lastIdx!] = newValue;
          }
        },
      };
    } catch (e) {
      this.pos = initialState.pos;
      this.vars = new Map(initialState.vars);
      return null;
    }
  }

  private getIterableElements(iterable: any): Iterable<any> {
    if (iterable instanceof Range || iterable instanceof XRange) 
      return iterable.__value;
    
    if (typeof iterable === "string") 
      return Array.from(iterable);
    

    if (iterable !== null && typeof iterable === "object") {
      if ("__type" in iterable) {
        const type = iterable.__type;
        if (type === "arr" || type === "vec") {
          return iterable.__value;
        }
      } else if (Array.isArray(iterable)) {
        return iterable;
      }
    }

    throw {
      message: `Cannot iterate over non-iterable value`,
      code: ExitCode.SemanticError,
    };
  }

  private parseBreakStatement(): any {
    this.next();
    let value = null;

    if (![";", "}", ""].includes(this.peek())) {
      value = this.parseExpression();
    }

    if (this.peek() === ";") this.next();
    throw new BreakSignal(value);
  }

  private parseIfExpression(): any {
    this.next();

    let cond: any;
    if (this.peek() === "(") {
      this.next();
      cond = this.parseExpression();
      if (this.peek() !== ")")
        throw {
          message: "Expected ')' after if condition",
          code: ExitCode.SystaxError,
        };
      this.next();
    } else {
      cond = this.parseExpression();
    }

    let resultVal: any = null;

    const thenTerminators = ["else", "", ";"];

    if (cond) {
      if (this.peek() === "{") {
        resultVal = this.parseBlock();
      } else {
        const varsBeforeThen = new Set(this.vars.keys());

        resultVal = this.executeStatementsUntil(thenTerminators);

        for (const name of Array.from(this.vars.keys())) {
          if (!varsBeforeThen.has(name)) {
            this.vars.delete(name);
          }
        }
      }

      if (this.peek() === "else") {
        this.next();

        this.skipStatementOrBlock();
      }
    } else {
      this.skipStatementOrBlock();

      if (this.peek() === "else") {
        this.next();

        const elseTerminators = [""];

        if (this.peek() === "{") {
          resultVal = this.parseBlock();
        } else {
          const varsBeforeElse = new Set(this.vars.keys());
          resultVal = this.executeStatementsUntil(elseTerminators);

          for (const name of Array.from(this.vars.keys()))
            if (!varsBeforeElse.has(name)) {
              this.vars.delete(name);
            }
        }
      }
    }

    return resultVal;
  }

  private getType(value: any): (typeof Luz.TYPES)[number] {
    if (value instanceof Range) return "ran";
    if (value instanceof XRange) return "xran";

    if (typeof value === "object" && value !== null && "__type" in value) {
      return value.__type;
    }

    switch (typeof value) {
      case "number":
        return Number.isFinite(value) ? "num" : "inf";
      case "bigint":
        return "xl";
      case "boolean":
        return "bool";
      case "string":
        return "str";
      case "object":
        return value === null ? "null" : "null";
      default:
        return "null";
    }
  }

  private parseAssignment(): any {
    const token = this.peek();
    let isConst = false;
    if (token === "const") {
      isConst = true;
      this.next();
    }

    let varName: string | null = null;
    const indices: any[] = [];

    const initialState = {
      pos: this.pos,
      vars: new Map(this.vars),
    };

    try {
      let isAssignment = false;
      if (this.isVariableToken(this.peek())) {
        this.next();

        let bracketDepth = 0;
        while (this.peek() === "[") {
          bracketDepth++;
          this.next();

          let depth = 1;
          while (depth > 0 && this.pos < this.tokens.length) {
            const tok = this.next();
            if (tok === "[") depth++;
            if (tok === "]") depth--;
          }
        }

        isAssignment = [
          "=",
          "+=",
          "-=",
          "*=",
          "/=",
          "~/=",
          "%=",
          "^=",
          "**=",
        ].includes(this.peek());
      }

      if (!isAssignment) throw new Error();

      this.pos = initialState.pos;
      this.vars = new Map(initialState.vars);

      varName = this.next();
      while (this.peek() === "[") {
        this.next();
        indices.push(this.parseExpression());
        if (this.peek() !== "]") {
          throw { message: "Expected ']'", code: ExitCode.SystaxError };
        }
        this.next();
      }
    } catch {
      this.pos = initialState.pos;
      this.vars = new Map(initialState.vars);
      return this.parseRange();
      // return this.parseConditional();
    }

    const op = this.next();
    const rhs = this.parseAssignment();

    if (indices.length > 0) {
      if (!varName || !this.vars.has(varName)) {
        throw {
          message: `Undefined variable '${varName}'`,
          code: ExitCode.SemanticError,
        };
      }

      const varData = this.vars.get(varName);
      if (varData.const) {
        throw {
          message: `Cannot modify constant '${varName}'`,
          code: ExitCode.SemanticError,
        };
      }

      let container = varData.value;
      for (let i = 0; i < indices.length - 1; i++) {
        const idx = this.evalIndex(indices[i], container);
        container = container.__value[idx];
      }

      const lastIdx = this.evalIndex(indices[indices.length - 1], container);
      this.applyAssignment(container, lastIdx, op, rhs);
      return container.__value[lastIdx];
    }

    let result;
    let type: (typeof Luz.TYPES)[number] = "null";

    if (typeof rhs === "object" && rhs !== null && "__type" in rhs) {
      result = rhs;
      type = rhs.__type;
    } else {
      result = rhs;
      switch (typeof result) {
        case "number":
          type = "num";
          if (!Number.isFinite(result)) type = "inf";
          break;
        case "bigint":
          type = "xl";
          break;
        case "boolean":
          type = "bool";
          break;
        case "string":
          type = "str";
          break;
        case "object":
          if (result === null) type = "null";
          break;
        default:
          type = "null";
      }
    }

    if (op !== "=") {
      const current = this.vars.get(varName).value;
      switch (op) {
        case "+=":
          if (
            typeof current === "object" &&
            current !== null &&
            "__value" in current &&
            "__type" in current
          ) {
            if (current.__type === "arr") {
              throw {
                message: `Cannot add '${rhs}' to an 'arr', use 'vec' instead`,
                code: ExitCode.InvalidInstruction,
              };
            } else if (current.__type === "vec") {
              current.__value.push(rhs);
            } else if (current.__type === "set") {
              current.__value.add(rhs);
            }

            result = current;
          } else {
            result = current + rhs;
          }
          break;
        case "-=":
          result = current - rhs;
          break;
        case "*=":
          result = current * rhs;
          break;
        case "/=":
          result = current / rhs;
          break;
        case "~/=":
          result = Math.floor(current / rhs);
          break;
        case "%=":
          result = current % rhs;
          break;
        case "**=":
          result = current ** rhs;
          break;
        case "^=":
          result = current ^ rhs;
          break;
      }

      if (typeof current !== typeof result) {
        throw {
          message: `Type mismatch in compound assignment for '${varName}'`,
          code: ExitCode.SemanticError,
        };
      }
    }

    if (varName) {
      if (this.vars.has(varName)) {
        const existingVar = this.vars.get(varName)!;
        if (existingVar.const) {
          throw {
            message: `Cannot reassign constant '${varName}'`,
            code: ExitCode.SemanticError,
          };
        }
        this.vars.get(varName)!.value = result;
        existingVar.type = this.getType(result);
      } else {
        this.vars.set(varName, { value: result, const: isConst, type });
      }
    }

    return result;
  }

  private parseAddSub(): any {
    let left = this.parsePow();

    while (true) {
      const op = this.peek();
      if (op === "+" || op === "-") {
        this.next();
        const right = this.parsePow();
        if (op === "+") {
          if (
            typeof left === "object" &&
            left !== null &&
            "__value" in left &&
            "__type" in left
          ) {
            const __type: "arr" | "vec" | "set" = left.__type;

            if (__type === "arr") {
              throw {
                message: `Cannot add '${right}' to an 'arr', use 'vec' instead`,
                code: ExitCode.InvalidInstruction,
              };
            } else if (__type === "vec") {
              //!left.__value.push(right);

              left = {
                __type,
                __value: [...left.__value, right],
              };
            } else if (__type === "set") {
              //! left.__value.add(right);

              left = {
                __type,
                __value: new Set([...left.__value, right]),
              };
            }
          } else if (
            typeof right === "object" &&
            right !== null &&
            "__value" in right &&
            "__type" in right
          ) {
            const __type: "arr" | "vec" | "set" = right.__type;

            if (__type === "arr") {
              throw {
                message: `Cannot add '${left}' to an 'arr', use 'vec' instead`,
                code: ExitCode.InvalidInstruction,
              };
            } else if (__type === "vec") {
              left = {
                __type,
                __value: [left, ...right.__value],
              };
            } else if (__type === "set") {
              left = {
                __type,
                __value: right.__value.add(left),
              };
            }
          } else left = left + right;
        } else {
          left = left - right;
        }
      } else {
        break;
      }
    }
    return left;
  }

  private parseMulDiv(): any {
    let left = this.parseBitwise();

    while (true) {
      const op = this.peek();
      if (op === "*" || op === "/" || op === "%" || op === "~/") {
        this.next();

        const right = this.parseBitwise();
        if (op === "*") left = left * right;
        else if (op === "/" || op === "~/") {
          left = left / right;
          if (op === "~/") left = Math.floor(left);
        } else left = left % right;
      } else {
        break;
      }
    }

    if (typeof left === "number" && Number.isNaN(left)) {
      return null;
    }

    return left;
  }

  private parsePow(): any {
    let left = this.parseMulDiv();

    while (true) {
      const op = this.peek();
      if (op === "**") {
        this.next();

        const right = this.parseMulDiv();
        left = left ** right;
      } else {
        break;
      }
    }

    if (typeof left === "number" && Number.isNaN(left)) {
      return null;
    }

    return left;
  }

  private formatValue(value: any, visited: Set<any> = new Set()): string {
    if (visited.has(value)) {
      //? Circular reference handling
      if (value.__type === "set") {
        return "@{...}";
      }
      return `${value.__type === "vec" ? "!" : ""}[...]`;
    }

    if (value instanceof Range) return `${value.start}..${value.end}`;
    if (value instanceof XRange) return `${value.start}..=${value.end}`;

    if (typeof value === "object" && value !== null && "__type" in value) {
      visited.add(value);

      let elements: string[];
      if (value.__type === "set") {
        elements = Array.from(value.__value).map((el: any) =>
          this.formatValue(el, visited)
        );
      } else {
        elements = value.__value.map((el: any) =>
          this.formatValue(el, visited)
        );
      }

      visited.delete(value);
      switch (value.__type) {
        case "vec":
          return `![${elements.join(" ")}]`;
        case "set":
          return `@{${elements.join(" ")}}`;
        default:
          return `[${elements.join(" ")}]`;
      }
    } else if (Array.isArray(value)) {
      visited.add(value);
      const elements = value
        .map((el) => this.formatValue(el, visited))
        .join(" ");
      visited.delete(value);
      return `[${elements}]`;
    }

    if (typeof value === "number" && !Number.isFinite(value)) return "inf";
    return String(value);
  }

  private formatValueDebug(value: any, visited: Set<any> = new Set()): string {
    if (visited.has(value)) {
      //? Circular reference handling
      if (value.__type === "set") {
        return "@{...}";
      }
      return `${value.__type === "vec" ? "!" : ""}[...]`;
    }

    if (value instanceof Range) return `${value.start}..${value.end}`;
    if (value instanceof XRange) return `${value.start}..=${value.end}`;

    if (typeof value === "object" && value !== null && "__type" in value) {
      visited.add(value);

      let elements: string[];
      if (value.__type === "set") {
        elements = Array.from(value.__value).map((el: any) =>
          this.formatValueDebug(el, visited)
        );
      } else {
        elements = value.__value.map((el: any) =>
          this.formatValueDebug(el, visited)
        );
      }

      visited.delete(value);
      switch (value.__type) {
        case "vec":
          return `![${elements.join(" ")}]`;
        case "set":
          return `@{${elements.join(" ")}}`;
        default:
          return `[${elements.join(" ")}]`;
      }
    } else if (Array.isArray(value)) {
      visited.add(value);
      const elements = value
        .map((el) => this.formatValueDebug(el, visited))
        .join(" ");
      visited.delete(value);
      return `[${elements}]`;
    }

    if (typeof value === "number" && !Number.isFinite(value)) return "inf";
    if (typeof value === "string")
      return `"${value.replace(/\n/g, "\\n").replace(/\t/g, "\\t")}"`;
    return String(value);
  }

  private parseAs(): any {
    let left = this.parseUnary();

    while (true) {
      const op = this.peek();
      if (op === "as") {
        this.next();
        let targetType: (typeof Luz.TYPES)[number];

        if (this.peek() === "typeof") {
          this.next();

          const typeReference = this.parsePrimary();
          targetType = this.getType(typeReference);
        } else {
          targetType = this.next() as (typeof Luz.TYPES)[number];
        }

        if (!Luz.TYPES.includes(targetType)) {
          throw {
            message: `Invalid type '${targetType}' for casting`,
            code: ExitCode.SemanticError,
          };
        }

        if (left instanceof Range || left instanceof XRange) {
          const values = Array.from(left.__value);
          switch (targetType) {
            case "vec":
              left = { __type: "vec", __value: values };
              continue;
            case "arr":
              left = { __type: "arr", __value: values };
              continue;
            case "set":
              left = { __type: "set", __value: new LuzSet(values) };
              continue;
            case "str":
              left = values.join(" ");
              break;
          }
        }

        const isStruct =
          typeof left === "object" && left !== null && "__type" in left;
        const valueToCast = isStruct ? left.__value : left;

        let castedValue: any;

        switch (targetType) {
          case "num":
            castedValue = Number(valueToCast);
            break;
          case "xl":
            castedValue = BigInt(valueToCast);
            break;
          case "str":
            castedValue = isStruct
              ? this.formatValue(left)
              : String(valueToCast);
            break;
          case "bool":
            castedValue = Boolean(valueToCast);
            break;
          case "arr":
            castedValue = Array.isArray(valueToCast)
              ? valueToCast
              : [valueToCast];
            left = { __type: "arr", __value: castedValue };
            continue;
          case "vec":
            castedValue = Array.isArray(valueToCast)
              ? valueToCast
              : [valueToCast];
            left = { __type: "vec", __value: castedValue };
            continue;
          case "set":
            castedValue =
              valueToCast instanceof Set
                ? valueToCast
                : new LuzSet(valueToCast);
            left = { __type: "set", __value: castedValue };
            continue;
          default:
            castedValue = valueToCast;
        }

        left = castedValue;
      } else {
        break;
      }
    }

    return left;
  }

  private parseBitwise(): any {
    let left = this.parseAs();

    while (true) {
      const op = this.peek();
      if (["&", "|", "^", "<<", ">>", ">>>"].includes(op)) {
        this.next();

        const right = this.parseAs();

        if (op === "&") left = left & right;
        else if (op === "|") left = left | right;
        else if (op === "^") left = left ^ right;
        else if (op === "<<") left = left << right;
        else if (op === "<<<") left = left >> right;
        else left = left >>> right;
      } else break;
    }

    return left;
  }

  private calculateSize(value: any, visited: Set<any> = new Set()): number {
    if (value === null) return 4;

    if (typeof value === "object" && value !== null) {
      if (visited.has(value)) return 0;
      visited.add(value);
    }

    if (typeof value === "object" && "__type" in value) {
      const elements = value.__value;
      let size = 0;
      switch (value.__type) {
        case "arr":
        case "vec":
          for (const el of elements) size += this.calculateSize(el, visited);
          break;
        case "set":
          for (const el of elements) size += this.calculateSize(el, visited);
          break;
      }
      return size;
    }

    switch (typeof value) {
      case "number":
        return 8;
      case "string":
        return 2 * value.length;
      case "boolean":
        return 1;
      case "bigint":
        return 2 * value.toString().length;
      default:
        return 0;
    }
  }

  private parseUnary(): any {
    const pfx = this.peek();
    if (pfx === "++" || pfx === "--") {
      this.next();
      const varTok = this.next();
      if (!this.isVariableToken(varTok) || !this.vars.has(varTok)) {
        throw {
          message: `Cannot apply unary '${pfx}' to non-variable '${varTok}'`,
          code: ExitCode.SemanticError,
        };
      }
      const cur = this.vars.get(varTok).value as number;
      if (typeof cur !== "number") {
        throw {
          message: `Cannot apply unary '${pfx}' to non-numeric variable '${varTok}'`,
          code: ExitCode.SemanticError,
        };
      }
      const updated = pfx === "++" ? cur + 1 : cur - 1;
      this.vars.get(varTok).value = updated;
      return updated;
    }

    const op = this.peek();
    if (op === "!") {
      this.next();
      const rhs = this.parseUnary();
      return !rhs;
    }

    if (op === "~") {
      this.next();
      const rhs = this.parseUnary();
      if (typeof rhs !== "number" && typeof rhs !== "bigint") {
        throw {
          message: `Operand of bitwise NOT '~' must be a 'num' or 'big'`,
          code: ExitCode.SemanticError,
        };
      }
      return ~rhs;
    }

    if (op === "log" || op === "logln") {
      this.next();

      if (this.peek() === ";") {
        if (op === "log") process.stdout.write("");
        else console.log("");
        return "";
      }

      const rhs = this.parseExpression();

      const out = this.formatValue(rhs);

      if (op === "log") process.stdout.write(out);
      else console.log(out);
      return out;
    }

    if (op === "get") {
      const getInput = (promptText?: string): string => {
        if (this.pipeStdin === null) {
          return this.rl(promptText ?? "");
        } else {
          const data = this.pipeStdin.shift();
          return data ?? "";
        }
      };
      this.next();

      if (";})],{".includes(this.peek())) return getInput();

      if (
        //! "get"?
        ["==", "!=", "as", "+", "get", "", "loop", "if"].includes(this.peek())
      )
        return getInput();

      const promptArg = this.parsePrimary();
      const prompt = this.formatValue(promptArg); //? maybeeee

      return getInput(prompt);
    }

    if (op === "lenof") {
      this.next();
      const rhs = this.parsePrimary();

      if (typeof rhs === "string") {
        return rhs.length;
      } else if (rhs && typeof rhs === "object" && "__value" in rhs) {
        if (rhs.__type === "vec" || rhs.__type === "arr")
          return rhs.__value.length;
        else if (rhs.__type === "set") return rhs.__value.size;
      } else if (Array.isArray(rhs)) {
        return rhs.length;
      } else {
        throw {
          message: `lenof not supported for ${typeof rhs}`,
          code: ExitCode.SemanticError,
        };
      }
    }

    if (op === "copyof") {
      this.next();
      const rhs = this.parsePrimary();

      if (typeof rhs === "object" && rhs !== null && "__value" in rhs)
        return structuredClone(rhs);

      return rhs;
    }

    if (op === "firstof") {
      this.next();
      const rhs = this.parsePrimary();

      if (rhs instanceof Range || rhs instanceof XRange) return rhs.start;
      // if (rhs instanceof XRange) return rhs.start;

      if (typeof rhs === "object" && rhs !== null && "__value" in rhs) {
        const type: "vec" | "arr" | "set" = rhs.__type;

        if (type === "vec" || type === "arr") {
          return rhs.__value[0] ?? null;
        } else if (type === "set") {
          return rhs.__value.values().next().value ?? null;
        }

        return null; //This shouldn't be reached!
      }

      if (typeof rhs === "string") return rhs[0] ?? null;

      throw {
        message: `firstof is not supported for ${typeof rhs}`,
        code: ExitCode.SemanticError,
      };
    } else if (op === "lastof") {
      this.next();
      const rhs = this.parsePrimary();

      if (rhs instanceof XRange) return rhs.end;
      if (rhs instanceof Range) return rhs.end - Math.sign(rhs.end - rhs.start);

      if (typeof rhs === "object" && rhs !== null && "__value" in rhs) {
        const type: "vec" | "arr" | "set" = rhs.__type;

        if (type === "vec" || type === "arr") {
          return rhs.__value[rhs.__value.length - 1] ?? null;
        } else if (type === "set") {
          return rhs.__value.last ?? null;
        }

        return null; //This shouldn't be reached!
      }

      if (typeof rhs === "string") return rhs[rhs.length - 1] ?? null;

      throw {
        message: `lastof is not supported for ${typeof rhs}`,
        code: ExitCode.SemanticError,
      };
    }

    if (op === "sizeof") {
      this.next();
      const rhs = this.parsePrimary();
      return this.calculateSize(rhs);
    }

    if (op === "typeof") {
      this.next();
      const operand = this.parsePrimary();

      let typeStr: (typeof Luz.TYPES)[number];

      //? Handle Luz structured types
      if (operand && typeof operand === "object" && "__type" in operand) {
        typeStr = operand.__type;
      }
      //? Handle primitive JS types
      else
        switch (typeof operand) {
          case "string":
            typeStr = "str";
            break;
          case "number":
            typeStr = "num";
            if (!Number.isFinite(operand)) typeStr = "inf";
            break;
          case "bigint":
            typeStr = "xl";
            break;
          case "boolean":
            typeStr = operand === true || operand === false ? "bool" : "maybe";
            break;
          // case "object":
          //   typeStr = operand === null ? "null" : "arr";
          //   break;
          default:
            typeStr = "null";
        }

      return typeStr;
    }

    if (op === "del") {
      this.next();
      const varName = this.next();
      if (this.isLiteralToken(varName)) {
        throw {
          message: `Cannot delete a literal '${varName}'`,
          code: ExitCode.SemanticError,
        };
      }
      if (Luz.KEYWORDS.includes(varName as any)) {
        throw {
          message: `Cannot delete '${varName}', because it's a keyword`,
          code: ExitCode.SemanticError,
        };
      }
      if (!this.vars.has(varName)) {
        throw {
          message: `Cannot delete '${varName}', because it doesn't exist`,
          code: ExitCode.SemanticError,
        };
      }
      let value = this.vars.get(varName).value ?? null;
      this.vars.delete(varName);
      return value;
    }

    if (op === "+" || op === "-") {
      this.next();
      const rhs = this.parseUnary();
      if (typeof rhs !== "number" && typeof rhs !== "bigint") {
        throw {
          message: `Operand of unary '${op}' must be a 'num' or 'xl'.`,
          code: ExitCode.SemanticError,
        };
      }
      return op === "+" ? +(rhs as number) : -rhs;
    }

    return this.parsePostfix();
  }

  private parsePostfix(): any {
    const operandStartPos = this.pos;
    const primaryValue = this.parsePrimary();
    const operandToken = this.tokens[operandStartPos]!;

    const op = this.peek();

    if (op === "++" || op === "--") {
      if (!this.isVariableToken(operandToken)) {
        throw {
          message: `Cannot apply postfix '${op}' to non-variable '${operandToken}'`,
          code: ExitCode.SemanticError,
        };
      }

      if (!this.vars.has(operandToken)) {
        throw {
          message: `Variable '${operandToken}' is not defined for postfix operation`,
          code: ExitCode.SemanticError,
        };
      }

      this.next();

      let current = this.vars.get(operandToken).value;

      if (typeof current !== "number") {
        throw {
          message: `Cannot apply postfix '${op}' to non-numeric variable '${operandToken}'`,
          code: ExitCode.SemanticError,
        };
      }

      const updated = op === "++" ? current + 1 : current - 1;
      this.vars.get(operandToken).value = updated;

      return current;
    }

    return primaryValue;
  }

  private parseLogicalAnd(): any {
    let left = this.parseEquality();

    while (this.peek() === "&&") {
      this.next();

      if (!left) {
        this.parseExpression();
      } else {
        const right = this.parseExpression();

        left = left && right;
      }
    }
    return left;
  }

  private parseNullish(): any {
    let left = this.parseLogicalAnd();

    while (this.peek() === "??") {
      this.next();

      if (left) {
        this.parseLogicalAnd();
      } else {
        const right = this.parseLogicalAnd();

        left = left ?? right;
      }
    }
    return left;
  }

  private parseLogicalOr(): any {
    let left = this.parseNullish();

    while (this.peek() === "||") {
      this.next();

      if (left) {
        this.parseNullish();
      } else {
        const right = this.parseNullish();

        left = left || right;
      }
    }
    return left;
  }

  private parseComparison(): any {
    let left = this.parseAddSub();

    while (true) {
      const op = this.peek();
      if (op === "<" || op === ">" || op === "<=" || op === ">=") {
        this.next();
        const right = this.parseAddSub();

        const leftVal =
          typeof left === "object" && left !== null && "__type" in left
            ? left.__value
            : left;
        const rightVal =
          typeof right === "object" && right !== null && "__type" in right
            ? right.__value
            : right;

        if (
          !(
            (typeof leftVal === "number" && typeof rightVal === "number") ||
            (typeof leftVal === "bigint" && typeof rightVal === "bigint")
          )
        ) {
          throw {
            message: `Cannot compare non-numeric values with '${op}'`,
            code: ExitCode.SemanticError,
          };
        }

        switch (op) {
          case "<":
            left = leftVal < rightVal;
            break;
          case ">":
            left = leftVal > rightVal;
            break;
          case "<=":
            left = leftVal <= rightVal;
            break;
          case ">=":
            left = leftVal >= rightVal;
            break;
        }
      } else break;
    }
    return left;
  }

  private executeStatementsUntil(terminators: string[]): any {
    let lastVal: any = null;
    while (this.pos < this.tokens.length) {
      const currentToken = this.peek();

      if (terminators.includes(currentToken)) break;

      if (currentToken === "}") break;

      lastVal = this.parseStatement();
    }
    return lastVal;
  }
  private parseEquality(): any {
    let left = this.parseComparison();

    while (true) {
      const op = this.peek();
      if (op === "==" || op === "!=" || op === "has") {
        this.next();
        const right = this.parseComparison();

        if (op === "==" || op === "!=") {
          const leftVal = this.getUnderlyingValue(left);
          const rightVal = this.getUnderlyingValue(right);
          left = op === "==" ? leftVal === rightVal : leftVal !== rightVal;
        } else if (op === "has") {
          left = this.checkHas(left, right);
        }
      } else {
        break;
      }
    }
    return left;
  }

  private skipUntil(terminators: string[]): void {
    let depth = 0;
    while (this.pos < this.tokens.length) {
      const t = this.peek();

      if (depth === 0 && terminators.includes(t)) break;

      if (t === "(" || t === "[" || t === "{") depth++;
      else if (t === ")" || t === "]" || t === "}") {
        depth--;

        if (depth < 0) break;
      }

      this.next();
    }
  }
  private parseRange(): any {
    let left = this.parseConditional();

    while (true) {
      const op = this.peek();
      if (op === ".." || op === "..=") {
        this.next();
        const right = this.parseConditional();

        if (typeof left !== "number" || typeof right !== "number") {
          throw {
            message: "Range boundaries must be numeric values",
            code: ExitCode.SemanticError,
          };
        }

        // Create range instances instead of arrays
        left = op === "..=" ? new XRange(left, right) : new Range(left, right);
      } else break;
    }

    return left;
  }
  private parseConditional(): any {
    const condition = this.parseLogicalOr();

    if (this.peek() !== "?") return condition;

    this.next();

    if (condition) {
      const trueVal = this.parseAssignment();

      if (this.peek() === ":") {
        this.next();

        this.skipUntil([")", ";", ""]);
      } else
        throw {
          message: `Expected ':' in conditional expression`,
          code: ExitCode.SystaxError,
        };

      return trueVal;
    } else {
      this.skipUntil([":"]);

      if (this.peek() !== ":")
        throw {
          message: `Expected ':' but found '${this.peek()}'`,
          code: ExitCode.SystaxError,
        };

      this.next();

      return this.parseAssignment();
    }
  }

  private parseArrLiteral(): any[] {
    const elements: any[] = [];

    if (this.peek() === "]") {
      this.next();
      return elements;
    }

    const firstElement = this.parseExpression();

    if (this.peek() === ";") {
      this.next();

      const lengthExpr = this.parseExpression();
      const length = Number(lengthExpr);

      if (isNaN(length) || length < 0 || !Number.isInteger(length)) {
        throw {
          message: `Invalid array length '${lengthExpr}'`,
          code: ExitCode.SemanticError,
        };
      }

      elements.push(...Array(length).fill(firstElement));

      if (this.peek() !== "]") {
        throw {
          message: "Expected ']' after array length",
          code: ExitCode.SystaxError,
        };
      }
      this.next();

      return elements;
    } else {
      elements.push(firstElement);
      while (this.peek() !== "]") {
        if (this.peek() === ",") this.next();
        const element = this.parseExpression();
        elements.push(element);
      }
      this.next();
      return elements;
    }
  }

  private parseSetLiteral(): LuzSet<any> {
    const elements: LuzSet<any> = new LuzSet<any>();

    if (this.peek() === "}") {
      this.next();
      return elements;
    }

    while (this.peek() !== "}") {
      if (this.peek() === ",") this.next();
      const element = this.parseExpression();

      elements.add(element);
    }

    this.next();

    return elements;
  }

  private parseVecLiteral(): Array<any> {
    const elements: any[] = [];

    if (this.peek() === "]") {
      this.next();
      return elements;
    }

    const firstElement = this.parseExpression();

    if (this.peek() === ";") {
      this.next();

      const lengthExpr = this.parseExpression();
      const length = Number(lengthExpr);

      if (isNaN(length) || length < 0 || !Number.isInteger(length)) {
        throw {
          message: `Invalid vector length '${lengthExpr}'`,
          code: ExitCode.SemanticError,
        };
      }

      elements.push(...Array(length).fill(firstElement));

      if (this.peek() !== "]") {
        throw {
          message: "Expected ']' after vector length",
          code: ExitCode.SystaxError,
        };
      }
      this.next();

      return elements;
    } else {
      elements.push(firstElement);
      while (this.peek() !== "]") {
        if (this.peek() === ",") this.next();

        const element = this.parseExpression();
        elements.push(element);
      }
      this.next();
      return elements;
    }
  }

  private parseContinueStatement(): any {
    this.next();

    if (this.peek() === ";") this.next();

    throw new ContinueSignal();
  }

  private parsePrimary(): any {
    if (this.peek() === "if") return this.parseIfExpression();

    if (this.peek() === "loop") return this.parseLoopExpression();
    if (this.peek() === "break") return this.parseBreakStatement();
    if (this.peek() === "continue") return this.parseContinueStatement();

    const nextTok = this.peek();

    if (nextTok === "(") {
      this.next();
      const exprValue = this.parseExpression();
      if (this.peek() !== ")") {
        throw {
          message: `Expected ')' but found '${
            this.peek() === "\n" ? "\\n" : this.peek()
          }'`,
          code: ExitCode.SystaxError,
        };
      }
      this.next();
      return exprValue;
    }

    const tok = this.next();

    if (tok === "[") {
      const arr = this.parseArrLiteral();
      return { __type: "arr", __value: arr };
    }

    if (tok === "![") {
      const vec = this.parseVecLiteral();
      return { __type: "vec", __value: vec };
    }

    if (tok === "@{") {
      const set = this.parseSetLiteral();
      return { __type: "set", __value: set };
    }

    if (this.isNumberToken(tok)) {
      const num = tok.replace(/_/g, "");
      return Number(/^\.\d+$/.test(num) ? `0${num}` : num);
    }

    if (this.isInfToken(tok)) return Infinity;

    if (this.isExtraLong(tok)) {
      const big = this.getExtraLong(tok).replace(/_/g, "");

      return BigInt(big);
    }

    if (this.isStrToken(tok)) return this.getStrToken(tok);

    if (this.isBooleanToken(tok)) return this.getBooleanToken(tok);

    if (this.isNullToken(tok)) return null;

    if (this.isMaybeToken(tok)) return Math.random() > 0.5;

    if (this.isVariableToken(tok)) {
      if (!this.vars.has(tok)) {
        throw {
          message: `Variable '${tok}' is not defined`,
          code: ExitCode.SemanticError,
        };
      }

      let value = this.vars.get(tok).value;
      while (this.peek() === "[") {
        value = this.parseIndexAccess(value);
      }
      return value;
    }

    throw { message: `Unexpected token '${tok}'`, code: ExitCode.SystaxError };
  }

  private applyAssignment(
    container: any,
    index: number,
    op: string,
    value: any
  ): void {
    if (typeof container === "string") {
      throw {
        message: "'str' is immutable, cannot modify characters",
        code: ExitCode.SemanticError,
      };
    }

    const arr = container.__value;
    const isArr = container.__type === "arr";
    if (isArr && index >= arr.length)
      throw {
        message: `Cannot increase the length of an 'arr', use 'vec' instead`,
        code: ExitCode.InvalidInstruction,
      };

    if (index < 0)
      throw {
        message: `Cannot assign to negative index '${index}'`,
        code: ExitCode.InvalidInstruction,
      };

    if (op === "=") {
      arr[index] = value;
    } else {
      const current = arr[index];
      switch (op) {
        case "+=":
          arr[index] = current + value;
          break;
        case "-=":
          arr[index] = current - value;
          break;
        case "*=":
          arr[index] = current * value;
          break;
        case "/=":
          arr[index] = current / value;
          break;
        case "~/=":
          arr[index] = Math.floor(current / value);
          break;
        case "%=":
          arr[index] = current % value;
          break;
        case "**=":
          arr[index] = current ** value;
          break;
        case "^=":
          arr[index] = current ^ value;
          break;
      }
    }
  }

  private parseIndexAccess(container: any): any {
    this.next();
    const indexExpr = this.parseExpression();

    //! console.log("huh: ",this.peek());

    if (this.peek() !== "]")
      throw { message: "Expected ']' after index", code: ExitCode.SystaxError };

    this.next();

    if (typeof container === "string") {
      const idx = this.evalIndex(indexExpr, container);
      if (idx < 0 || idx >= container.length) {
        return null;
      }
      return container.charAt(idx);
    }

    if (
      !container ||
      typeof container !== "object" ||
      !("__type" in container) ||
      (container.__type !== "arr" && container.__type !== "vec")
    )
      throw {
        message: "Cannot index non-array/vector",
        code: ExitCode.SemanticError,
      };

    const idx = this.evalIndex(indexExpr, container);
    return container.__value[idx] ?? null;
  }

  private evalIndex(indexExpr: any, _container: any): number {
    const indexValue =
      typeof indexExpr === "object" && "__value" in indexExpr
        ? indexExpr.__value
        : indexExpr;

    if (typeof indexValue !== "number" && typeof indexValue !== "bigint") {
      throw { message: "Index must be numeric", code: ExitCode.SemanticError };
    }

    const idx = Number(indexValue);
    // if (idx < 0 || idx >= container.__value.length) {
    //   throw { message: "Index out of bounds", code: ExitCode.RuntimeError };
    // }

    return idx;
  }

  private peek(offset: number = 0): string {
    return this.tokens[this.pos + offset] ?? "";
  }

  private next(): string {
    return this.tokens[this.pos++] ?? "";
  }

  public get getObj() {
    return this.obj;
  }
  public get getExpr() {
    return this.expr;
  }
  public get getVars() {
    return [...this.vars.entries()].map(
      ([name, { value, type, const: isConst }]) => ({
        name,
        value,
        type,
        const: isConst,
      })
    );
  }

  public get getVarsDebug() {
    return this.getVars.map((el) => {
      const { name, const: isConst, type } = el;
      let valBefore = el.value;

      const value = this.formatValueDebug(valBefore);

      return {
        name,
        value,
        type,
        const: isConst,
      };
    });
  }

  public get getConsts() {
    return [...this.vars.entries()].map(
      (e: [string, LuzVar]) => e[1].const && e[0]
    );
  }

  public clearVars(): void {
    this.vars = new Map();
  }

  private isLiteralToken(token: string): boolean {
    return (
      this.isNumberToken(token) ||
      this.isStrToken(token) ||
      this.isBooleanToken(token) ||
      this.isNullToken(token) ||
      this.isMaybeToken(token) ||
      this.isInfToken(token) ||
      token === "[" ||
      token === "!["
    );
  }

  private isNumberToken(token: string): boolean {
    if (token === ".") return false;
    return /^(?:\d|_)*\.?\d+$/.test(token);
  }

  private isStrToken(token: string): boolean {
    return /^\'(?:.|\n|\r)*?(?<!\\)\'|\"(?:.|\n|\r)*?(?<!\\)\"|\`(?:.|\n|\r)*?(?<!\\)\`$/g.test(
      token
    );
  }

  private isExtraLong(token: string): boolean {
    return /^\d+xl$/gi.test(token);
  }

  private isBooleanToken(token: string): boolean {
    return /^(?:true|false)$/.test(token);
  }

  private isNullToken(token: string): boolean {
    return token === "null";
  }
  private isMaybeToken(token: string): boolean {
    return token === "maybe";
  }

  private isComment(token: string): boolean {
    return /^(?:(?:#|\/\/).*|\/\*(?:.|\n|\r)*\*\/)$/.test(token);
  }

  private isVariableToken(token: string): boolean {
    return /^(?:\$|\w)+$/.test(token);
  }

  private isInfToken(token: string): boolean {
    return /^inf$/g.test(token);
  }

  private getBooleanToken(token: string): boolean {
    return token === "true";
  }

  private getStrToken(token: string): string {
    let processedToken = token
      .substring(1, token.length - 1)
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\`/g, "`")
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t");

    let result = "";
    let currentPosInString = 0;

    while (currentPosInString < processedToken.length) {
      const openBraceIndex = processedToken.indexOf("{", currentPosInString);

      if (openBraceIndex === -1) {
        result += processedToken.substring(currentPosInString);
        break;
      }

      result += processedToken.substring(currentPosInString, openBraceIndex);

      let braceBalance = 1;
      let closeBraceIndex = -1;
      let scanPos = openBraceIndex + 1;

      while (scanPos < processedToken.length && braceBalance > 0) {
        const char = processedToken[scanPos];
        if (char === "{") {
          braceBalance++;
        } else if (char === "}") {
          braceBalance--;
          if (braceBalance === 0) {
            closeBraceIndex = scanPos;
            break;
          }
        }
        scanPos++;
      }

      if (braceBalance !== 0 || closeBraceIndex === -1) {
        throw {
          message: `Unclosed interpolation block starting at index ${openBraceIndex} in string literal`,
          code: ExitCode.SystaxError,
        };
      }

      const expression = processedToken
        .substring(openBraceIndex + 1, closeBraceIndex)
        .trim();

      if (expression.length > 0) {
        const originalPos = this.pos;
        const originalTokens = this.tokens;

        try {
          const expressionTokens = expression.match(Luz.tokensRegExp) ?? [];

          if (expressionTokens.length === 0) {
            result += "{}";
          } else {
            this.tokens = expressionTokens;
            this.pos = 0;

            const expressionValue = this.parseExpression();

            result += this.formatValue(expressionValue);
          }
        } catch (error: any) {
          throw error;
        } finally {
          this.pos = originalPos;
          this.tokens = originalTokens;
        }
      } else {
        result += "{}";
      }

      currentPosInString = closeBraceIndex + 1;
    }

    return result;
  }

  private getExtraLong(token: string): string {
    token = token.substring(0, token.length - 2);
    return token;
  }
}
