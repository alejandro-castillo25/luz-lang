// import psp from "prompt-sync";
import fs from "fs";

type Primitives = number | string | bigint | boolean | null;

interface LuzVar {
  value: Primitives | StructType;
  type: (typeof Luz.TYPES)[number];
  const?: boolean;
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

  delete(value: T): boolean {
    const deleted = super.delete(value);
    if (deleted && value === this._last) {
      const elements = Array.from(this);
      this._last = elements.length ? elements[elements.length - 1] : undefined;
    }
    return deleted;
  }

  get last() {
    return this._last;
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

    while (step > 0 ? current < this.end : current > this.end) {
      yield current;
      current += step;
    }
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

    if (this.start === this.end) {
      yield current;
      return;
    }

    while (step > 0 ? current <= this.end : current >= this.end) {
      yield current;
      current += step;
    }
  }
}

export const enum ExitCode {
  Success,
  Error,
  IncorrectUsage, //? Reserved for CLI
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
    super("Break expression");
  }
}

export class ReturnSignal extends Error {
  constructor(public value: any) {
    super("Return expression");
  }
}

export class ContinueSignal extends Error {
  constructor() {
    super("Continue expression");
  }
}

interface OnMethods {
  onEnd: (code: number) => any;
  onStart: () => any;
  onSuccess: () => any;
  onError: (code: number) => any;
}

export interface LuzConfig extends Partial<OnMethods> {
  vars?:
    | Record<string, LuzVar>
    | Array<{ name: string } & Omit<LuzVar, "name">>;
  expr: string;
  clearVarsOnEnd?: boolean;

  logFn?: (arg0: string) => any;
}

export class Luz {
  private obj: Record<string, any> = {};
  private expr: string;
  private vars: LuzVars = new Map<string, LuzVar>();

  private tokens: string[] = [];
  private pos = 0;

  private isSkipping: boolean = false;

  private clearVarsOnEnd: boolean;

  // private isBrowserEnvironment = "window" in globalThis && !("process" in globalThis);

  private logFn: NonNullable<LuzConfig["logFn"]>;

  //TODO consider fremoving this, prompt already handles this
  // private pipeStdin: string[] | null = null;

  // private input = psp({sigint: true})

  private stdinStack: Array<string> = [];

  private onEnd: OnMethods["onEnd"];
  private onStart: OnMethods["onStart"];
  private onSuccess: OnMethods["onSuccess"];
  private onError: OnMethods["onError"];

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
    "getln",
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

  //? Emojis: (\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])
  public static tokensRegExp: RegExp =
    /\.\.\=?|(?:\+\+|--)[\w\$]+(?:\[[^\]]*?\]|\.[\w\$]+)*|[\w\$]+(?:\[[^\]]*?\]|\.[\w\$]+)*(?:\+\+|--)|\?\?|<=>|,|@\{|!\[|\*\*\=?|~\/=?|<<|>>>?|\.\.=?|~|-=|[<>]?-[<>]?|(?:\d|_)+[Xx][Ll]|(?<![\w\$]\.?)(?:\d(?:[\d_]*\.[\d_]+(?:[eE][-+]?\d+)?|\d*[\d_]*(?:[eE][-+]?\d+)?)|(?:\.[\d_]+(?:[eE][-+]?\d+)?))|(?:#|\/\/).*|\/\*[\s\S]*?\*\/|'[\s\S]*?(?<!\\)'|"[\s\S]*?(?<!\\)"|`[\s\S]*?(?<!\\)`|[=!\-+*<>%^?/]=?|[\w\$]+|\.|\|\||[()\[\]{}%?:]|&&|[&|^]|(?<!(?:;|^));/g;

  constructor({
    vars,
    expr,
    clearVarsOnEnd = false,
    onEnd = () => {},
    onStart = () => {},
    onError = () => {},
    onSuccess = () => {},
    logFn = console.log,
  }: LuzConfig) {
    if (vars) {
      if (Array.isArray(vars)) {
        this.vars = new Map(
          vars.map((item) => [
            item.name,
            {
              value: item.value,
              type: item.type,
              const: item.const ?? false,
            } as LuzVar,
          ])
        );
      } else {
        // Record format: { a: { value: ..., type: ..., const: ... }, ... }
        this.vars = new Map(
          Object.entries(vars).map(([name, varData]) => [
            name,
            {
              value: varData.value,
              type: varData.type,
              const: varData.const ?? false,
            } as LuzVar,
          ])
        );
      }
    } else this.vars = new Map();

    // this.expr = expr.replace(/\r/g, "");
    this.clearVarsOnEnd = clearVarsOnEnd;
    this.expr = expr;
 

    this.logFn = logFn;

    this.onStart = onStart;
    this.onEnd = onEnd;
    this.onSuccess = onSuccess;
    this.onError = onError;
  }

  public run(): number {
    this.tokens = this.expr.match(Luz.tokensRegExp) ?? [];
    this.pos = 0;
    let code = 0;
    this.onStart();

    try {
      while (this.pos < this.tokens.length) {
        this.parseStatement();
      }
      return ExitCode.Success;
    } catch (err: any) {
      if (err instanceof BreakSignal) {
        throw err;
      }
      code = err.code;
      console.error(err.message);
      return err.code ?? ExitCode.RuntimeError;
    } finally {
      if (code === 0) this.onSuccess();
      else this.onError(code);

      this.onEnd(code);

      if (this.clearVarsOnEnd) this.clearVars();
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
    if (this.isSkipping) {
      this.skipExpression();
      return null;
    }

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
    const initialState = { vars: new Map(this.vars) };

    try {
      let tempPos = startPos;

      const leftEnd = this.checkLValueStructure(tempPos);
      if (leftEnd === -1) return null;
      tempPos = leftEnd;

      if (this.tokens[tempPos] !== "<=>") return null;
      tempPos++;

      const rightEnd = this.checkLValueStructure(tempPos);
      if (rightEnd === -1) return null;

      // Now parse for real >:[
      this.pos = startPos;
      const left = this.tryParseLValue()!;
      this.next();
      const right = this.tryParseLValue()!;

      const a = left.get();
      const b = right.get();
      left.set(b);
      right.set(a);
      return true;
    } catch (e: any) {
      this.pos = startPos;
      this.vars = new Map(initialState.vars);

      if (e.code === ExitCode.SemanticError) {
        throw e;
      }

      return null;
    }
  }

  private checkLValueStructure(startPos: number): number {
    let pos = startPos;
    try {
      if (!this.isVariableToken(this.tokens[pos]!)) return -1;
      pos++;

      while (this.tokens[pos] === "[") {
        pos++;

        let depth = 1;
        while (pos < this.tokens.length && depth > 0) {
          if (this.tokens[pos] === "[") depth++;
          if (this.tokens[pos] === "]") depth--;
          pos++;
        }
        if (depth !== 0) return -1;
      }
      return pos;
    } catch {
      return -1;
    }
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

    if (left instanceof XRange || left instanceof Range) {
      if (typeof right !== "number") return false;
      return left.__type === "ran"
        ? right >= left.start && right < left.end
        : right >= left.start && right <= left.end;
    }

    //? Handle Luz structured types
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

    //? Handle JavaScript types
    if (Array.isArray(left)) return left.includes(right);
    if (typeof left === "string") return left.includes(String(right));
    if (left instanceof Set) return left.has(right);

    throw {
      message: `'has' not supported for ${typeof left}`,
      code: ExitCode.SemanticError,
    };
  }

  // private evaluateCondition(
  //   conditionStart: number,
  //   conditionEnd: number
  // ): boolean {
  //   const originalPos = this.pos;
  //   this.pos = conditionStart;
  //   let value;
  //   try {
  //     value = this.parseExpression();
  //     if (this.pos - 1 !== conditionEnd) {
  //       throw new Error("Condition parsing did not consume expected tokens");
  //     }
  //   } finally {
  //     this.pos = originalPos;
  //   }
  //   return Boolean(value);
  // }
  //!
  private parseLoopExpression(): any {
    this.next();

    // * loop inf
    if (this.peek() === "{") {
      const result = this.parseInfiniteLoop();
      return result;
    }

    const savedPos = this.pos;
    let hasParen = false;

    if (this.peek() === "(") {
      hasParen = true;
      this.next();
    }

    let loopVariable: string | null = null;
    let iterable: any;
    let conditionStart: number;
    let conditionEnd: number;

    //? is loop in
    if (this.isVariableToken(this.peek()) && this.peek(1) === "in") {
      loopVariable = this.next();
      this.next(); // in
      iterable = this.parseExpression();

      if (hasParen) {
        if (this.peek() !== ")") {
          throw {
            message: "Expected ')' after for-in expression",
            code: ExitCode.SystaxError,
          };
        }
        this.next();
      }
    } else {
      //? in wasnt found!
      if (hasParen) {
        this.pos = savedPos;
      }

      //* While loop
      conditionStart = this.pos;
      let depth = 0;
      while (this.pos < this.tokens.length) {
        const token = this.peek();
        if (token === "{" && depth === 0) {
          break;
        }
        this.next();
        if (["(", "[", "{"].includes(token)) depth++;
        if ([")", "]", "}"].includes(token)) depth--;
      }
      conditionEnd = this.pos - 1;
    }

    //? body
    this.expect("{", "loop header");
    const loopBody = this.parseLoopBody();

    //? Run loop!
    if (loopVariable !== null) {
      const result = this.executeForInLoop(loopVariable, iterable, loopBody);
      this.pos = loopBody.end + 1;
      return result;
    } else {
      const result = this.executeWhileLoop(
        conditionStart!,
        conditionEnd!,
        loopBody
      );
      this.pos = loopBody.end + 1;
      return result;
    }
  }

  private parseInfiniteLoop(): any {
    this.expect("{", "infinite loop body");
    const loopBody = this.parseLoopBody();
    let result: any = null;

    while (true) {
      try {
        this.pos = loopBody.start;
        result = this.executeLoopBody(loopBody);
      } catch (e) {
        if (e instanceof BreakSignal) {
          result = e.value;
          break;
        }
        throw e;
      }
    }

    this.pos = loopBody.end + 1; //? } ->
    return result;
  }

  private parseLoopBody(): { start: number; end: number } {
    const start = this.pos;
    let depth = 1;
    while (this.pos < this.tokens.length && depth > 0) {
      const token = this.next();
      if (token === "{") depth++;
      if (token === "}") depth--;
    }

    return { start, end: this.pos - 1 };
  }

  private executeForInLoop(
    variable: string,
    iterable: any,
    body: { start: number; end: number }
  ): any {
    const elements = this.getIterableElements(iterable);
    let result: any = null;
    for (const el of elements) {
      this.vars.set(variable, { value: el });
      try {
        this.executeLoopBody(body);
      } catch (e) {
        if (e instanceof BreakSignal) {
          result = e.value;
          break;
        } else if (e instanceof ContinueSignal) {
          continue;
        }
        throw e;
      }
    }
    this.vars.delete(variable);
    return result;
  }

  private executeWhileLoop(
    conditionStart: number,
    conditionEnd: number,
    body: { start: number; end: number }
  ): any {
    let result: any = null;
    while (true) {
      const originalPos = this.pos;

      this.pos = conditionStart;
      const condition = this.parseExpression();

      //? check: we consumed condition tokens
      if (this.pos !== conditionEnd + 1) {
        throw {
          message: "Condition parsing length mismatch",
          code: ExitCode.SystaxError,
        };
      }

      this.pos = originalPos;

      if (!condition) break;

      try {
        result = this.executeLoopBody(body);
      } catch (e) {
        if (e instanceof BreakSignal) {
          result = e.value;
          break;
        } else if (e instanceof ContinueSignal) {
          continue;
        }
        throw e;
      }
    }
    return result;
  }

  private executeLoopBody(body: { start: number; end: number }): any {
    const varsBefore = new Set(this.vars.keys());
    let result: any = null;
    this.pos = body.start;
    try {
      while (this.pos < body.end) {
        result = this.parseStatement();
      }
    } finally {
      //? Clean up!
      Array.from(this.vars.keys())
        .filter((k) => !varsBefore.has(k))
        .forEach((k) => this.vars.delete(k));
    }
    return result;
  }

  private expect(token: string, context: string) {
    if (this.peek() !== token) {
      throw {
        message: `Expected '${token}' in ${context}`,
        code: ExitCode.SystaxError,
      };
    }
    this.next();
  }

  private tryParseLValue(): {
    get: () => any;
    set: (v: any) => void;
    delete: () => any;
  } | null {
    const initialState = { pos: this.pos, vars: new Map(this.vars) };
    let varName: string | null = null;
    const indices: any[] = [];

    try {
      if (!this.isVariableToken(this.peek())) return null;
      varName = this.next();

      while (this.peek() === "[" || this.peek() === ".") {
        // Check for both '[' and '.' for indices
        if (this.peek() === "[") {
          this.next();
          const index = this.parseExpression();
          indices.push(index);
          if (this.peek() !== "]") throw new Error("Expected ]");
          this.next();
        } else if (this.peek() === ".") {
          this.next();
          const indexToken = this.next();
          if (!this.isNumberToken(indexToken)) {
            throw new Error("Expected number after dot for index access");
          }
          const index = Number(indexToken.replace(/_/g, ""));
          indices.push(index);
        }
      }

      if (!this.vars.has(varName)) {
        throw new Error(`Undefined variable '${varName}'`);
      }

      const varData = this.vars.get(varName)!;
      if (varData.const) {
        throw {
          message: `Cannot modify constant '${varName}'`,
          code: ExitCode.SemanticError,
        };
      }

      return {
        get: () => {
          let value = varData.value;
          for (const indexExpr of indices) {
            const idx = this.evalIndex(indexExpr, value);
            if (
              value &&
              typeof value === "object" &&
              "__value" in value &&
              Array.isArray(value.__value)
            ) {
              value = value.__value[idx];
            } else if (Array.isArray(value)) {
              value = value[idx];
            } else {
              throw {
                message: `Cannot access index of non-array type for ${varName}`,
                code: ExitCode.SemanticError,
              };
            }
          }
          return value;
        },
        set: (newValue: any) => {
          const currentVarData = this.vars.get(varName!)!;
          if (currentVarData.const) {
            throw {
              message: `Cannot modify constant '${varName}'`,
              code: ExitCode.SemanticError,
            };
          }

          if (indices.length === 0) {
            currentVarData.value = newValue;
          } else {
            let container = currentVarData.value;
            const resolvedIndices = [];
            for (const indexExpr of indices) {
              const idx = this.evalIndex(indexExpr, container);
              resolvedIndices.push(idx);
              if (resolvedIndices.length < indices.length) {
                if (
                  container &&
                  typeof container === "object" &&
                  "__value" in container
                ) {
                  container = container.__value[idx!];
                } else if (Array.isArray(container)) {
                  container = container[idx!];
                } else {
                  throw {
                    message: `Cannot access index of non-array type for ${varName}`,
                    code: ExitCode.SemanticError,
                  };
                }
              }
            }

            let parent = currentVarData.value;
            for (let i = 0; i < resolvedIndices.length - 1; i++) {
              if (parent && typeof parent === "object" && "__value" in parent) {
                parent = parent.__value[resolvedIndices[i]!];
              } else if (Array.isArray(parent)) {
                parent = parent[resolvedIndices[i]!];
              } else {
                throw {
                  message: `Cannot access index of non-array type for ${varName}`,
                  code: ExitCode.SemanticError,
                };
              }
            }
            const lastIdx = resolvedIndices[resolvedIndices.length - 1];
            if (
              parent &&
              typeof parent === "object" &&
              "__value" in parent &&
              Array.isArray(parent.__value)
            ) {
              parent.__value[lastIdx!] = newValue;
            } else if (Array.isArray(parent)) {
              parent[lastIdx!] = newValue;
            } else {
              throw {
                message: `Cannot set index of non-array type for ${varName}`,
                code: ExitCode.SemanticError,
              };
            }
          }
        },
        delete: () => {
          const currentVarData = this.vars.get(varName!)!;

          if (indices.length === 0) {
            // Delete entire variable
            this.vars.delete(varName!);
          } else {
            // Delete element from container
            let container = currentVarData.value;
            const resolvedIndices = [];

            // Traverse to the parent container of the element to delete
            for (let i = 0; i < indices.length - 1; i++) {
              const idx = this.evalIndex(indices[i], container);
              resolvedIndices.push(idx);

              if (
                container &&
                typeof container === "object" &&
                "__value" in container
              ) {
                container = container.__value[idx];
              } else if (Array.isArray(container)) {
                container = container[idx];
              } else {
                throw {
                  message: `Cannot access index of non-array type for ${varName}`,
                  code: ExitCode.SemanticError,
                };
              }
            }

            const lastIdx = this.evalIndex(
              indices[indices.length - 1],
              container
            );

            // Validate container type before deletion
            if (
              container &&
              typeof container === "object" &&
              "__value" in container
            ) {
              if (container.__type === "arr") {
                throw {
                  message: `Cannot delete from fixed-size array`,
                  code: ExitCode.SemanticError,
                };
              } else if (container.__type === "vec") {
                // Perform vector deletion
                container.__value.splice(lastIdx, 1);
              } else {
                throw {
                  message: `Delete operation not supported for ${container.__type}`,
                  code: ExitCode.SemanticError,
                };
              }
            } else if (Array.isArray(container)) {
              // Handle plain JS arrays
              container.splice(lastIdx, 1);
            } else {
              throw {
                message: `Cannot delete from non-array type`,
                code: ExitCode.SemanticError,
              };
            }
          }
        },
      };
    } catch (e: any) {
      this.pos = initialState.pos;
      this.vars = new Map(initialState.vars);

      if (e && e.code === ExitCode.SemanticError) {
        throw e;
      }
      return null;
    }
  }

  private getIterableElements(iterable: any): Iterable<any> {
    if (iterable instanceof XRange || iterable instanceof Range)
      return iterable.__value;

    if (typeof iterable === "string") return Array.from(iterable);

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
    const cond = this.parseExpression();

    let thenValue: any = null;
    let elseValue: any = null;

    if (this.peek() !== "{") {
      throw {
        message: "Expected '{' after 'if' condition",
        code: ExitCode.SystaxError,
      };
    }

    if (cond) {
      thenValue = this.parseBlock();

      if (this.peek() === "else") {
        this.skipElseIfChain();
      }
    } else {
      this.skipBlock();
      // ? else if or else
      if (this.peek() === "else") {
        this.next();
        if (this.peek() === "if") {
          elseValue = this.parseIfExpression();
        } else if (this.peek() === "{") {
          elseValue = this.parseBlock();
        } else {
          throw {
            message: "Expected 'if' or '{' after 'else'",
            code: ExitCode.SystaxError,
          };
        }
      }
    }

    return cond ? thenValue : elseValue;
  }

  private skipElseIfChain(): void {
    while (this.peek() === "else") {
      this.next();

      if (this.peek() === "if") {
        this.next();
        this.isSkipping = true;
        this.parseExpression();
        this.isSkipping = false;
        if (this.peek() === "{") this.skipBlock();
      } else if (this.peek() === "{") {
        this.skipBlock();
        break; //! NO more else!
      } else
        throw {
          message: "Expected 'if' or '{' after 'else'",
          code: ExitCode.SystaxError,
        };
    }
  }

  private skipBlock(): void {
    let depth = 1;
    this.next(); // Consume '{'
    while (this.pos < this.tokens.length && depth > 0) {
      const token = this.next();
      if (token === "{") depth++;
      if (token === "}") depth--;
    }
  }

  private skipExpression(): void {
    let depth = 0;
    while (this.pos < this.tokens.length) {
      const token = this.peek();
      if (
        depth === 0 &&
        (token === "else" ||
          ["}", "]", ")", ";", ",", "=>", "then", "do"].includes(token))
      )
        break;
      this.next();
      if (["(", "[", "{"].includes(token)) depth++;
      if ([")", "]", "}"].includes(token)) depth--;
    }
  }

  private getType(value: any): (typeof Luz.TYPES)[number] {
    if (value instanceof XRange) return "ran";
    if (value instanceof Range) return "xran";

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
        while (this.peek() === "[" || this.peek() === ".") {
          if (this.peek() === "[") {
            bracketDepth++;
            this.next();

            let depth = 1;
            while (depth > 0 && this.pos < this.tokens.length) {
              const tok = this.next();
              if (tok === "[") depth++;
              if (tok === "]") depth--;
            }
          } else if (this.peek() === ".") {
            this.next();
            const indexToken = this.next();
            if (!this.isNumberToken(indexToken)) {
              throw new Error("Expected number after dot for index access");
            }
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

      if (this.isLiteralToken(varName))
        throw {
          message: `Cannot assign to literal`,
          code: ExitCode.SemanticError,
        };

      if (Luz.KEYWORDS.includes(varName as any))
        throw {
          message: `Cannot assign to '${varName}' because it is a keyword`,
          code: ExitCode.SemanticError,
        };

      while (this.peek() === "[" || this.peek() === ".") {
        if (this.peek() === "[") {
          this.next();
          indices.push(this.parseExpression());
          if (this.peek() !== "]") {
            throw { message: "Expected ']'", code: ExitCode.SystaxError };
          }
          this.next();
        } else if (this.peek() === ".") {
          this.next(); // Consume the dot
          const indexToken = this.next();
          if (!this.isNumberToken(indexToken)) {
            throw {
              message: "Expected number after '.' for index access",
              code: ExitCode.SystaxError,
            };
          }
          const index = Number(indexToken.replace(/_/g, ""));
          indices.push(index);
        }
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
          if (
            container &&
            typeof container === "object" &&
            "__value" in container
          ) {
            container = container.__value[idx];
          } else if (Array.isArray(container)) {
            container = container[idx];
          } else
            throw {
              message: `Cannot access index of non-array type for ${varName}`,
              code: ExitCode.SemanticError,
            };
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
                  message: `Cannot add '${this.asStr(
                    rhs
                  )}' to an 'arr', use 'vec' instead`,
                  code: ExitCode.InvalidInstruction,
                };
              } else if (current.__type === "vec") {
                current.__value.push(rhs);
              } else if (current.__type === "set") {
                current.__value.add(rhs);
              }

              result = current;
            } else if (current instanceof Range || current instanceof XRange) {
              if (typeof rhs !== "number")
                throw {
                  message: `Cannot add non-numeric value '${this.asDebugStr(
                    rhs
                  )}' to range`,
                  code: ExitCode.InvalidInstruction,
                };

              current.end += rhs;
              result = current;
            } else {
              result = current + rhs;
            }
            break;
          case "-=":
            const __type = this.getType(current);
            if (__type === "vec") {
              for (let i = current.__value.length - 1; i >= 0; i--) {
                const value = current.__value[i];

                if (value === rhs) {
                  if (i === current.__value.length - 1) current.__value.pop();
                  else current.__value.splice(i, 1);
                  break;
                }
              }

              result = current;
            } else if (__type === "arr") {
              throw {
                message: `Cannot subtract '${this.asDebugStr(
                  rhs
                )}' from 'arr', use 'vec' instead`,
                code: ExitCode.InvalidInstruction,
              };
            } else if (__type === "set") {
              current.__value.delete(rhs);
              result = current;
            } else if (current instanceof Range || current instanceof XRange) {
              if (typeof rhs !== "number")
                throw {
                  message: `Cannot subtract non-numeric value '${this.asDebugStr(
                    rhs
                  )}' to range`,
                  code: ExitCode.InvalidInstruction,
                };

              current.end -= rhs;
              result = current;
            } else {
              result = current - rhs;
            }
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
    } catch (e: any) {
      this.pos = initialState.pos;
      this.vars = new Map(initialState.vars);

      if (e && e.code === ExitCode.SemanticError) {
        throw e;
      }
      return this.parseRange();
    }
  }
  private parseAddSub(): any {
    let left = this.parsePow();

    while (true) {
      const op = this.peek();
      if (op === "+" || op === "-") {
        this.next();
        const right = this.parsePow();
        if (op === "+") {
          if (left instanceof Range || left instanceof XRange) {
            if (typeof right !== "number")
              throw {
                message: `Cannot add non-numeric value '${this.asDebugStr(
                  right
                )}' to range`,
                code: ExitCode.InvalidInstruction,
              };

            left.end += right;
          } else if (
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
              left.__value.push(right);
            } else if (__type === "set") {
              left.__value.add(right);
            }
          } else if (right instanceof Range || right instanceof XRange) {
            if (typeof left !== "number")
              throw {
                message: `Cannot add non-numeric value '${this.asDebugStr(
                  left
                )}' to range`,
                code: ExitCode.InvalidInstruction,
              };

            right.start += left;
            left = right;
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
              right.__value.unshift(left);

              left = right;
            } else if (__type === "set") {
              right.__value.add(left);
              left = right;
            }
          } else left = left + right;
        } else {
          if (left instanceof Range || left instanceof XRange) {
            if (typeof right !== "number")
              throw {
                message: `Cannot subtract non-numeric value '${this.asDebugStr(
                  right
                )}' to range`,
                code: ExitCode.InvalidInstruction,
              };

            left.end -= right;
          } else if (
            typeof left === "object" &&
            left !== null &&
            "__value" in left &&
            "__type" in left
          ) {
            const __type: "arr" | "vec" | "set" = left.__type;

            if (__type === "arr") {
              throw {
                message: `Cannot subtract '${right}' to an 'arr', use 'vec' instead`,
                code: ExitCode.InvalidInstruction,
              };
            } else if (__type === "vec") {
              for (let i = left.__value.length - 1; i >= 0; i--) {
                const value = left.__value[i];

                if (value === right) {
                  if (i === left.__value.length - 1) left.__value.pop();
                  else left.__value.splice(i, 1);
                  break;
                }
              }
              left = right;
            } else if (__type === "set") {
              left.__value.delete(right);
              left = right;
            }
          } else if (right instanceof Range || right instanceof XRange) {
            if (typeof left !== "number")
              throw {
                message: `Cannot add non-numeric value '${this.asDebugStr(
                  left
                )}' to range`,
                code: ExitCode.InvalidInstruction,
              };

            right.start -= left;
            left = right;
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
              for (let i = 0; i < right.__value.length; i++) {
                const value = right.__value[i];

                if (value === left) {
                  right.__value.splice(i, 1);
                  break;
                }
              }
              left = right.__value;
            } else if (__type === "set") {
              right.__value.delete(left);

              left = right.__value;
            }
          } else left = left - right;
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

  private asStr(value: any, visited: Set<any> = new Set()): string {
    if (visited.has(value)) {
      //? Circular reference handling
      if (value.__type === "set") {
        return "@{...}";
      }
      return `${value.__type === "vec" ? "!" : ""}[...]`;
    }

    if (value instanceof XRange)
      return `${this.asStr(value.start)}..${this.asStr(value.end)}`;
    if (value instanceof Range)
      return `${this.asStr(value.start)}..=${this.asStr(value.end)}`;

    if (typeof value === "object" && value !== null && "__type" in value) {
      visited.add(value);

      let elements: string[];
      if (value.__type === "set") {
        elements = Array.from(value.__value).map((el: any) =>
          this.asStr(el, visited)
        );
      } else if (value.__type === "vec") {
        const vecValue = value.__value;
        const denseVec = [];
        for (let i = 0; i < vecValue.length; i++) {
          denseVec.push(i in vecValue ? vecValue[i] : null);
        }
        elements = denseVec.map((el: any) => this.asStr(el, visited));
      } else {
        elements = value.__value.map((el: any) => this.asStr(el, visited));
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
      const elements = value.map((el) => this.asStr(el, visited)).join(" ");
      visited.delete(value);
      return `[${elements}]`;
    }

    if (Number.isNaN(value)) return "null"; //TODO Handle ops in compund assigment!
    if (typeof value === "number" && !Number.isFinite(value))
      return `${value < 0 ? "-" : ""}inf`;

    return String(value);
  }

  private asDebugStr(value: any, visited: Set<any> = new Set()): string {
    if (visited.has(value)) {
      //? Circular reference handling
      if (value.__type === "set") {
        return "@{...}";
      }
      return `${value.__type === "vec" ? "!" : ""}[...]`;
    }

    if (value instanceof XRange)
      return `${this.asDebugStr(value.start)}..${this.asDebugStr(value.end)}`;
    if (value instanceof Range)
      return `${this.asDebugStr(value.start)}..=${this.asDebugStr(value.end)}`;

    if (typeof value === "object" && value !== null && "__type" in value) {
      visited.add(value);

      let elements: string[];
      if (value.__type === "set") {
        elements = Array.from(value.__value).map((el: any) =>
          this.asDebugStr(el, visited)
        );
      } else if (value.__type === "vec") {
        const vecValue = value.__value;
        const denseVec = [];
        for (let i = 0; i < vecValue.length; i++) {
          denseVec.push(i in vecValue ? vecValue[i] : null);
        }
        elements = denseVec.map((el: any) => this.asStr(el, visited));
      } else {
        elements = value.__value.map((el: any) => this.asDebugStr(el, visited));
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
        .map((el) => this.asDebugStr(el, visited))
        .join(" ");
      visited.delete(value);
      return `[${elements}]`;
    }

    if (Number.isNaN(value)) return "null"; //TODO Handle ops in compund assigment!
    if (typeof value === "number" && !Number.isFinite(value))
      return `${value < 0 ? "-" : ""}inf`;
    if (typeof value === "bigint") return `${value}xl`;
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

          const typeReference = this.parseUnary();
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

        if (left instanceof XRange || left instanceof Range) {
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
            case "ran":
              if (left instanceof Range) {
                const adj = left.start <= left.end ? 1 : -1;
                left = new XRange(left.start, left.end + adj);
              }
              continue;
            case "xran":
              if (left instanceof XRange) {
                const adj = left.start < left.end ? -1 : 1;
                left = new Range(left.start, left.end + adj);
              }
              continue;
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
            // castedValue = isStruct ? this.asStr(left) : String(valueToCast);
            castedValue = this.asStr(left);
            break;
          case "bool":
            castedValue = Boolean(valueToCast);
            break;
          case "maybe":
            if (left instanceof XRange || left instanceof Range) {
              const start = left.start;
              const end = left.end;
              if (left instanceof XRange) {
                castedValue = start + Math.floor(Math.random() * (end - start));
              } else {
                castedValue =
                  start + Math.floor(Math.random() * (end - start + 1));
              }
            } else if (typeof left === "string") {
              if (left.length === 0) {
                castedValue = null;
              } else {
                const randomIndex = Math.floor(Math.random() * left.length);
                castedValue = left[randomIndex];
              }
            } else if (left && typeof left === "object" && "__type" in left) {
              const type = left.__type;
              const value = left.__value;
              switch (type) {
                case "arr":
                case "vec":
                  if (value.length === 0) {
                    castedValue = null;
                  } else {
                    const randomIndex = Math.floor(
                      Math.random() * value.length
                    );
                    castedValue = value[randomIndex];
                  }
                  break;
                case "set":
                  const elements = Array.from(value);
                  if (elements.length === 0) {
                    castedValue = null;
                  } else {
                    const randomIndex = Math.floor(
                      Math.random() * elements.length
                    );
                    castedValue = elements[randomIndex];
                  }
                  break;
                default:
                  castedValue = Math.random() > 0.5;
              }
            } else {
              castedValue = Math.random() > 0.5;
            }
            break;
          case "arr":
            castedValue = Array.isArray(valueToCast)
              ? valueToCast
              : Array.from(valueToCast);
            left = { __type: "arr", __value: castedValue };
            continue;
          case "vec":
            castedValue = Array.isArray(valueToCast)
              ? valueToCast
              : Array.from(valueToCast);
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
      } else break;
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

  private readLineFromStdin(prompt?: string): string {
    if (prompt) {
      process.stdout.write(prompt);
    }
    const buffer = Buffer.alloc(1);
    let input = "";
    while (true) {
      const bytesRead = fs.readSync(0, buffer);
      if (bytesRead === 0) break; //? none!
      
      const char = buffer.toString("utf8");
      
      if (char === "\n") break;
      input += char;
    }
    return input;
  }

  private parseUnary(): any {
    const currentToken = this.peek();

    if (currentToken.startsWith("++") || currentToken.startsWith("--")) {
      const operator = currentToken.slice(0, 2);
      const variablePart = currentToken.slice(2);

      const originalTokens = this.tokens;
      const originalPos = this.pos;

      const newTokens = variablePart.match(Luz.tokensRegExp) || [];
      this.tokens = newTokens;
      this.pos = 0;

      const lValue = this.tryParseLValue();

      this.tokens = originalTokens;
      this.pos = originalPos;

      if (!lValue) {
        throw {
          message: `Cannot apply unary '${operator}' to non-l-value '${variablePart}'`,
          code: ExitCode.SemanticError,
        };
      }

      let current = lValue.get();

      //? Check type
      if (typeof current !== "number" && typeof current !== "bigint") {
        throw {
          message: `Cannot apply unary '${operator}' to non-numeric variable`,
          code: ExitCode.SemanticError,
        };
      }

      let newValue: number | bigint;

      if (typeof current === "number") {
        newValue = operator === "++" ? current + 1 : current - 1;
      } else {
        newValue = operator === "++" ? current + 1n : current - 1n;
      }

      lValue.set(newValue);

      this.next();

      return newValue;
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
          message: `Operand of bitwise NOT '~' must be a 'num' or 'xl'`,
          code: ExitCode.SemanticError,
        };
      }
      return ~rhs;
    }

    if (op === "log" || op === "logln") {
      this.next();

      if (";})]".includes(this.peek())) {
        if (op === "log") this.logFn("");
        else this.logFn("\n");

        return "";
      }

      const rhs = this.parseExpression();
      const out = this.asStr(rhs);

      if (op === "log") this.logFn(out);
      else this.logFn(`${out}\n`);
      return out;
    }

    if (op === "get" || op === "getln") {
      this.next();
      const getInput = (promptText?: string): string => {
          return this.readLineFromStdin(promptText ?? "");
      };

      let prompt0 = "";
      let hasPrompt = false;
      if (
        ![";", "}", "]", ")", "", "as", "get", "getln", "==", "!="].includes(
          this.peek()
        )
      ) {
        const promptArg = this.parsePrimary();
        prompt0 = this.asStr(promptArg);
        hasPrompt = true;
      }

      if (op === "getln") {
        if (hasPrompt) this.logFn(prompt0);

        return getInput();
      } else {
        if (hasPrompt) this.logFn(prompt0);

        if (this.stdinStack.length > 0) {
          if (hasPrompt) this.logFn("\n"); //! do a newline
          return this.stdinStack.pop()!;
        } else {
          while (true) {
            const line = getInput();
            const tokens = line.trim().split(/\s+/);

            if (tokens[0] === "") continue;

            this.stdinStack = tokens.slice(1).reverse();
            return tokens[0] ?? "";
          }
        }
      }
    }
    if (op === "lenof") {
      this.next();
      const rhs = this.parsePrimary(); //!

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
      const rhs = this.parseExpression();

      if (typeof rhs === "object" && rhs !== null && "__value" in rhs)
        return structuredClone(rhs);

      return rhs;
    }

    if (op === "firstof") {
      this.next();
      const rhs = this.parsePrimary();

      if (rhs instanceof XRange || rhs instanceof Range) return rhs.start;
      // if (rhs instanceof Range) return rhs.start;

      if (typeof rhs === "object" && rhs !== null && "__value" in rhs) {
        const type: "vec" | "arr" | "set" = rhs.__type;

        if (type === "vec" || type === "arr") {
          return rhs.__value[0] ?? null;
        } else if (type === "set") {
          return rhs.__value.values().next().value ?? null;
        }

        return null; //?This shouldn't be reached!
      }

      if (typeof rhs === "string") return rhs[0] ?? null;

      throw {
        message: `firstof is not supported for ${typeof rhs}`,
        code: ExitCode.SemanticError,
      };
    } else if (op === "lastof") {
      this.next();
      const rhs = this.parsePrimary();

      if (rhs instanceof Range) return rhs.end;
      if (rhs instanceof XRange)
        return rhs.end - Math.sign(rhs.end - rhs.start);

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
      const rhs = this.parseExpression();
      return this.calculateSize(rhs);
    }

    if (op === "typeof") {
      this.next();
      const operand = this.parseExpression();

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

      if (this.peek() === "*") {
        this.next();
        this.clearVars();
        return null;
      }

      const lval = this.tryParseLValue();
      if (!lval) {
        throw {
          message: `Invalid deletion target`,
          code: ExitCode.SemanticError,
        };
      }

      const value = lval.get();
      if (typeof lval.delete === "function") {
        lval.delete();
      } else {
        throw {
          message: `Delete operation not supported for this type`,
          code: ExitCode.SemanticError,
        };
      }
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

  private parseRange(): any {
    let left = this.parseLogicalOr();

    while (true) {
      const op = this.peek();
      if (op === ".." || op === "..=") {
        this.next();
        const right = this.parseLogicalOr();

        if (typeof left !== "number" || typeof right !== "number") {
          throw {
            message: "Range boundaries must be numeric values",
            code: ExitCode.SemanticError,
          };
        }

        left = op === "..=" ? new Range(left, right) : new XRange(left, right);
      } else break;
    }

    return left;
  }

  private parseArrLiteral(): any[] {
    const elements: any[] = [];

    if (this.peek() === "]") {
      this.next();
      return elements;
    }

    const savedPos = this.pos;
    let lastSemicolonPos = -1;
    let depth = 0;

    // Find the last top-level semicolon
    while (this.pos < this.tokens.length) {
      const token = this.tokens[this.pos];
      if (token === ";") {
        if (depth === 0) {
          lastSemicolonPos = this.pos;
        }
      } else if (token === "[" || token === "![") {
        depth++;
      } else if (token === "]") {
        depth--;
        if (depth < 0) break;
      }
      this.pos++;
    }

    this.pos = savedPos;

    if (lastSemicolonPos !== -1) {
      const exprStart = this.pos;
      const exprEnd = lastSemicolonPos;

      const blockTokens = this.tokens.slice(exprStart, exprEnd);
      this.pos = exprEnd + 1; // Move past ';'

      const lengthExpr = this.parseExpression();
      const length = Number(lengthExpr);

      if (
        lengthExpr === null ||
        Number.isNaN(length) ||
        length < 0 ||
        !Number.isInteger(length)
      ) {
        throw {
          message: `Invalid 'arr' length '${lengthExpr}'`,
          code: ExitCode.SemanticError,
        };
      }

      const postLengthPos = this.pos;
      const originalTokens = this.tokens;
      const originalVars = new Map(this.vars);

      for (let i = 0; i < length; i++) {
        this.vars = new Map(originalVars);

        this.tokens = blockTokens;
        this.pos = 0;

        let element = null;
        while (this.pos < this.tokens.length) {
          element = this.parseStatement();
        }

        elements.push(element);

        this.tokens = originalTokens;
        this.pos = postLengthPos;
      }
    } else {
      while (this.peek() !== "]") {
        if (this.peek() === ",") this.next();
        const element = this.parseExpression();
        elements.push(element);
      }
    }

    if (this.peek() !== "]") {
      throw {
        message: "Expected ']' after arr elements",
        code: ExitCode.SystaxError,
      };
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

    const savedPos = this.pos;
    let lastSemicolonPos = -1;
    let depth = 0;

    while (this.pos < this.tokens.length) {
      const token = this.tokens[this.pos];
      if (token === ";") {
        if (depth === 0) {
          lastSemicolonPos = this.pos;
        }
      } else if (token === "[" || token === "![") {
        depth++;
      } else if (token === "]") {
        depth--;
        if (depth < 0) break;
      }
      this.pos++;
    }

    this.pos = savedPos;

    if (lastSemicolonPos !== -1) {
      const exprStart = this.pos;
      const exprEnd = lastSemicolonPos;

      const blockTokens = this.tokens.slice(exprStart, exprEnd);
      this.pos = exprEnd + 1; //? After ;

      const lengthExpr = this.parseExpression();
      const length = Number(lengthExpr);

      if (
        lengthExpr === null ||
        Number.isNaN(length) ||
        length < 0 ||
        !Number.isInteger(length)
      ) {
        throw {
          message: `Invalid vec length '${this.asDebugStr(lengthExpr)}'`,
          code: ExitCode.SemanticError,
        };
      }

      const postLengthPos = this.pos;
      const originalTokens = this.tokens;
      const originalVars = new Map(this.vars);

      for (let i = 0; i < length; i++) {
        this.vars = new Map(originalVars);

        this.tokens = blockTokens;
        this.pos = 0;

        let element = null;
        while (this.pos < this.tokens.length) {
          element = this.parseStatement();
        }

        elements.push(element);

        this.tokens = originalTokens;
        this.pos = postLengthPos;
      }
    } else {
      while (this.peek() !== "]") {
        if (this.peek() === ",") this.next();
        const element = this.parseExpression();
        elements.push(element);
      }
    }

    if (this.peek() !== "]") {
      throw {
        message: "Expected ']' after vector elements",
        code: ExitCode.SystaxError,
      };
    }
    this.next();

    return elements;
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

  private parseContinueStatement(): any {
    this.next();

    if (this.peek() === ";") this.next();

    throw new ContinueSignal();
  }

  private getIndexValue(container: any, index: number): any {
    if (typeof container === "string") {
      return index >= 0 && index < container.length
        ? container.charAt(index)
        : null;
    }
    const values = container?.__value || container;
    return values[index] ?? null;
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

    if (this.isVariableToken(tok) || tok.endsWith("++") || tok.endsWith("--")) {
      let operator = "";
      let variablePart = tok;

      if (variablePart.endsWith("++") || variablePart.endsWith("--")) {
        operator = variablePart.slice(-2);
        variablePart = variablePart.slice(0, -2);
      }

      if (operator) {
        const originalTokens = this.tokens;
        const originalPos = this.pos;

        const newTokens = variablePart.match(Luz.tokensRegExp) || [];
        this.tokens = newTokens;
        this.pos = 0;

        const lValue = this.tryParseLValue();

        this.tokens = originalTokens;
        this.pos = originalPos;

        if (!lValue) {
          throw {
            message: `Cannot apply postfix '${operator}' to non-l-value '${variablePart}'`,
            code: ExitCode.SemanticError,
          };
        }

        const current = lValue.get();

        if (typeof current !== "number" && typeof current !== "bigint") {
          throw {
            message: `Cannot apply postfix '${operator}' to non-numeric variable`,
            code: ExitCode.SemanticError,
          };
        }

        let newValue: number | bigint;

        if (typeof current === "number") {
          newValue = operator === "++" ? current + 1 : current - 1;
        } else {
          newValue = operator === "++" ? current + 1n : current - 1n;
        }

        lValue.set(newValue);

        return current;
      } else {
        //* Variable handling!
        if (!this.vars.has(tok)) {
          throw {
            message: `Variable '${tok}' is not defined`,
            code: ExitCode.SemanticError,
          };
        }

        let value = this.vars.get(tok).value;
        while (true) {
          if (this.peek() === "[") {
            value = this.parseIndexAccess(value);
          } else if (this.peek() === ".") {
            this.next(); // Consume the dot
            const indexToken = this.next();
            if (!this.isNumberToken(indexToken)) {
              throw new Error("Expected number after dot for index access");
            }
            const index = Number(indexToken.replace(/_/g, ""));
            value = this.getIndexValue(value, index);
          } else {
            break;
          }
        }
        return value;
        // let value = this.vars.get(tok).value;
        // while (this.peek() === "[") {
        //   value = this.parseIndexAccess(value);
        // }
        // return value;
      }
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

    if (this.peek() !== "]")
      throw { message: "Expected ']' after index", code: ExitCode.SystaxError };
    this.next();

    if (indexExpr instanceof XRange || indexExpr instanceof Range) {
      const indices = Array.from(indexExpr.__value);
      let elements = [];

      const getElement = (idx: number) => {
        if (typeof container === "string") {
          idx = idx < 0 ? container.length + idx : idx;
          return idx >= 0 && idx < container.length
            ? container.charAt(idx)
            : null;
        }

        const values = container?.__value || container;
        idx = idx < 0 ? values.length + idx : idx;
        return idx >= 0 && idx < values.length ? values[idx] : null;
      };

      for (const idx of indices) {
        elements.push(getElement(Number(idx)));
      }

      //? return appropriate type
      if (typeof container === "string") {
        return elements.join("");
      }
      if (container?.__type) {
        return {
          __type: container.__type,
          __value: container.__type === "set" ? new LuzSet(elements) : elements,
        };
      }
      return elements;
    }

    const idx = this.evalIndex(indexExpr, container);

    if (typeof container === "string") {
      return idx >= 0 && idx < container.length ? container.charAt(idx) : null;
    }

    const values = container?.__value || container;
    return values[idx] ?? null;
  }
  private evalIndex(indexExpr: any, _container: any): number {
    let indexValue = indexExpr;

    if (indexExpr instanceof XRange || indexExpr instanceof Range) {
      throw {
        message: "Range indices must be used directly in brackets",
        code: ExitCode.SemanticError,
      };
    }

    if (typeof indexExpr === "object" && "__value" in indexExpr) {
      indexValue = indexExpr.__value;
    }

    if (typeof indexValue !== "number" && typeof indexValue !== "bigint") {
      throw { message: "Index must be numeric", code: ExitCode.SemanticError };
    }

    let idx = Number(indexValue);
    // const length =
    //   typeof container === "string"
    //     ? container.length
    //     : container?.__value?.length || container.length;

    // // Handle negative indices
    // if (idx < 0) idx += length;
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

      const value = this.asDebugStr(valBefore);

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
      this.isExtraLong(token) ||
      this.isStrToken(token) ||
      this.isBooleanToken(token) ||
      this.isNullToken(token) ||
      this.isMaybeToken(token) ||
      this.isInfToken(token) ||
      token === "[" ||
      token === "![" ||
      token === "@{"
    );
  }

  private isNumberToken(token: string): boolean {
    // if (token === "." || /^.*_+$/g.test(token) || /^[e_]+/gi.test(token))
    //   return false;
    // if (/^(?:\d|_)*\.?\d+$/.test(token)) return true;
    return /^(?<![\w\$]\.?)(?:\d(?:[\d_]*\.[\d_]+(?:[eE][-+]?\d+)?|\d*[\d_]*(?:[eE][-+]?\d+)?)|(?:\.[\d_]+(?:[eE][-+]?\d+)?))$/g.test(
      token
    );
  }

  private isStrToken(token: string): boolean {
    return /^\'(?:.|\n|\r)*?(?<!\\)\'|\"(?:.|\n|\r)*?(?<!\\)\"|\`(?:.|\n|\r)*?(?<!\\)\`$/g.test(
      token
    );
  }

  private isExtraLong(token: string): boolean {
    return /^(?:\d|_)+xl$/gi.test(token);
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
    return /^[\w\$áéíóúüñÁÉÍÓÚÜÑ]+$/.test(token);
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

            result += this.asStr(expressionValue);
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
