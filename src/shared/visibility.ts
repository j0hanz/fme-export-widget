import type {
  DynamicFieldConfig,
  DynamicPropertyClause,
  FormValues,
  VisibilityExpression,
  VisibilityState,
} from "../config/index";
import {
  isEmpty,
  isPlainObject,
  normalizeParameterValue,
  toTrimmedString,
} from "./utils";
import { logWarn } from "./utils/logging";
import { createSafeRegExp } from "./utils/regex";

const MAX_VISIBILITY_REGEX_LENGTH = 512;

/** Result type when evaluating condition expressions. */
type EvaluationResult = boolean | "unknown";

/**
 * Evaluates FME JSON GUI dynamic visibility expressions.
 */
export class VisibilityEvaluator {
  private readonly formValues: FormValues;

  private readonly fieldStates = new Map<string, VisibilityState>();

  private readonly fieldNames = new Set<string>();

  constructor(
    formValues: FormValues,
    fields: readonly DynamicFieldConfig[],
    initialStates?: ReadonlyMap<string, VisibilityState | undefined>
  ) {
    this.formValues = formValues;

    for (const field of fields) {
      this.fieldNames.add(field.name);
      if (field.visibilityState) {
        this.fieldStates.set(field.name, field.visibilityState);
      }
    }

    if (initialStates) {
      for (const [name, state] of initialStates) {
        this.fieldNames.add(name);
        if (state) {
          this.fieldStates.set(name, state);
        }
      }
    }
  }

  evaluate(
    expression: VisibilityExpression | undefined,
    fieldName?: string
  ): VisibilityState {
    const computed = this.evaluateInternal(expression);

    if (fieldName) {
      this.fieldStates.set(fieldName, computed);
      this.fieldNames.add(fieldName);
    }

    return computed;
  }

  private evaluateInternal(
    expression: VisibilityExpression | undefined
  ): VisibilityState {
    if (!expression) {
      return "visibleEnabled";
    }

    for (const clause of expression.if) {
      const result = this.evaluateClause(clause);

      if (result === true) {
        return clause.then;
      }

      if (result === "unknown") {
        return this.resolveDefault(expression);
      }
    }

    return this.resolveDefault(expression);
  }

  private resolveDefault(expression: VisibilityExpression): VisibilityState {
    return expression.default?.value ?? "visibleEnabled";
  }

  private evaluateClause(
    clause: DynamicPropertyClause<VisibilityState>
  ): EvaluationResult {
    const clauseRecord = isPlainObject(clause)
      ? (clause as { [key: string]: unknown })
      : {};
    const conditionKeys = Object.keys(clauseRecord).filter((key) =>
      key.startsWith("$")
    );

    if (conditionKeys.length === 0) {
      return true;
    }

    let hasUnknown = false;

    for (const key of conditionKeys) {
      const outcome = this.evaluateCondition(key, clauseRecord[key]);
      if (outcome === false) {
        return false;
      }
      if (outcome === "unknown") {
        hasUnknown = true;
      }
    }

    return hasUnknown ? "unknown" : true;
  }

  private evaluateCondition(
    operator: string,
    operand: unknown
  ): EvaluationResult {
    switch (operator) {
      case "$equals":
        return this.evaluateEquals(operand);
      case "$lessThan":
        return this.evaluateLessThan(operand);
      case "$greaterThan":
        return this.evaluateGreaterThan(operand);
      case "$matchesRegex":
        return this.evaluateMatchesRegex(operand);
      case "$isEnabled":
        return this.evaluateIsEnabled(operand);
      case "$isRuntimeValue":
        return this.evaluateIsRuntimeValue(operand);
      case "$allOf":
        return this.evaluateAllOf(operand);
      case "$anyOf":
        return this.evaluateAnyOf(operand);
      case "$not":
        return this.evaluateNot(operand);
      default:
        return false;
    }
  }

  private evaluateEquals(operand: unknown): EvaluationResult {
    if (!isPlainObject(operand)) return false;

    const { parameter, value } = operand as {
      parameter?: unknown;
      value?: unknown;
    };

    if (typeof parameter !== "string") return false;

    const paramValue = this.getParameterValue(parameter);
    if (paramValue === undefined) return "unknown";
    if (value === undefined) return false;

    const normalizedParam = normalizeParameterValue(paramValue);
    const normalizedTarget = normalizeParameterValue(value);

    return normalizedParam === normalizedTarget;
  }

  private evaluateLessThan(operand: unknown): EvaluationResult {
    if (!isPlainObject(operand)) return false;

    const { parameter, value } = operand as {
      parameter?: unknown;
      value?: unknown;
    };

    if (typeof parameter !== "string") return false;
    if (value === undefined || value === null) return false;

    const paramValue = this.getParameterValue(parameter);
    if (paramValue === undefined) return "unknown";

    return this.compare(paramValue, value, (a, b) => a < b);
  }

  private evaluateGreaterThan(operand: unknown): EvaluationResult {
    if (!isPlainObject(operand)) return false;

    const { parameter, value } = operand as {
      parameter?: unknown;
      value?: unknown;
    };

    if (typeof parameter !== "string") return false;
    if (value === undefined || value === null) return false;

    const paramValue = this.getParameterValue(parameter);
    if (paramValue === undefined) return "unknown";

    return this.compare(paramValue, value, (a, b) => a > b);
  }

  private compare(
    paramValue: unknown,
    targetValue: unknown,
    comparator: (a: number, b: number) => boolean
  ): boolean {
    const normalizedParam = normalizeParameterValue(paramValue);
    const normalizedTarget = normalizeParameterValue(targetValue);

    const paramNumber = Number(normalizedParam);
    const targetNumber = Number(normalizedTarget);

    if (Number.isFinite(paramNumber) && Number.isFinite(targetNumber)) {
      return comparator(paramNumber, targetNumber);
    }

    const paramString = this.toLexString(normalizedParam);
    const targetString = this.toLexString(normalizedTarget);
    return comparator(paramString.localeCompare(targetString), 0);
  }

  private evaluateMatchesRegex(operand: unknown): EvaluationResult {
    if (!isPlainObject(operand)) return false;

    const { parameter, regex } = operand as {
      parameter?: unknown;
      regex?: unknown;
    };

    if (typeof parameter !== "string" || typeof regex !== "string") {
      return false;
    }

    const paramValue = this.getParameterValue(parameter);
    if (paramValue === undefined) return "unknown";

    const candidate = this.toLexString(normalizeParameterValue(paramValue));
    const trimmedPattern = regex.trim();
    if (!trimmedPattern) return false;

    const compiled = createSafeRegExp(trimmedPattern, "", {
      maxLength: MAX_VISIBILITY_REGEX_LENGTH,
    });
    if (!compiled) {
      logWarn("VisibilityEvaluator: Unsafe regex blocked", {
        parameter,
        length: trimmedPattern.length,
      });
      return false;
    }

    return compiled.test(candidate);
  }

  private evaluateIsEnabled(operand: unknown): EvaluationResult {
    if (!isPlainObject(operand)) return false;

    const { parameter } = operand as { parameter?: unknown };
    if (typeof parameter !== "string") return false;

    if (!this.fieldNames.has(parameter)) {
      return false;
    }

    const state = this.fieldStates.get(parameter);
    if (!state) {
      return "unknown";
    }

    return state === "visibleEnabled" || state === "hiddenEnabled";
  }

  private evaluateIsRuntimeValue(operand: unknown): EvaluationResult {
    if (!isPlainObject(operand)) return false;

    const { parameter } = operand as { parameter?: unknown };
    if (typeof parameter !== "string") return false;

    const paramValue = this.getParameterValue(parameter);
    if (paramValue === undefined) return false;

    const valueString = toTrimmedString(paramValue);
    if (valueString) {
      return valueString.startsWith("$");
    }

    const normalized = normalizeParameterValue(paramValue);
    const normalizedString = this.toLexString(normalized);
    return normalizedString.startsWith("$");
  }

  private evaluateAllOf(operand: unknown): EvaluationResult {
    if (!Array.isArray(operand) || operand.length === 0) return false;

    let hasUnknown = false;

    for (const condition of operand) {
      if (!isPlainObject(condition)) return false;

      const conditionRecord = condition as { [key: string]: unknown };
      const keys = Object.keys(conditionRecord).filter((key) =>
        key.startsWith("$")
      );
      if (!keys.length) continue;

      for (const key of keys) {
        const result = this.evaluateCondition(key, conditionRecord[key]);
        if (result === false) {
          return false;
        }
        if (result === "unknown") {
          hasUnknown = true;
        }
      }
    }

    return hasUnknown ? "unknown" : true;
  }

  private evaluateAnyOf(operand: unknown): EvaluationResult {
    if (!Array.isArray(operand) || operand.length === 0) return false;

    let hasUnknown = false;

    for (const condition of operand) {
      if (!isPlainObject(condition)) {
        logWarn("Invalid condition in $anyOf (expected object)", condition);
        continue;
      }

      const conditionRecord = condition as { [key: string]: unknown };
      const keys = Object.keys(conditionRecord).filter((key) =>
        key.startsWith("$")
      );
      if (!keys.length) {
        logWarn("Invalid condition in $anyOf (no operators)", condition);
        continue;
      }

      for (const key of keys) {
        const result = this.evaluateCondition(key, conditionRecord[key]);
        if (result === true) {
          return true;
        }
        if (result === "unknown") {
          hasUnknown = true;
        }
      }
    }

    return hasUnknown ? "unknown" : false;
  }

  private evaluateNot(operand: unknown): EvaluationResult {
    if (!isPlainObject(operand)) return false;

    const operandRecord = operand as { [key: string]: unknown };
    const keys = Object.keys(operandRecord).filter((key) =>
      key.startsWith("$")
    );
    if (!keys.length) return false;

    const result = this.evaluateCondition(keys[0], operandRecord[keys[0]]);
    if (result === "unknown") {
      return "unknown";
    }

    return !result;
  }

  private getParameterValue(parameterName: string): unknown {
    const value = this.formValues[parameterName];
    if (isEmpty(value)) return undefined;
    return value;
  }

  private toLexString(value: string | number): string {
    return typeof value === "string" ? value : String(value);
  }
}
