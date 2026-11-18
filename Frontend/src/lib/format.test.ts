import { describe, expect, it } from "vitest";

import { formatValue, listItems } from "./format";

describe("listItems", () => {
  it("keeps non-empty primitives as strings", () => {
    expect(listItems(["read", 3, false])).toEqual(["read", "3", "false"]);
  });

  it("drops blanks, nulls and nested objects", () => {
    expect(listItems(["", null, undefined, { verb: "send" }, ["x"], "send"])).toEqual(["send"]);
  });
});

describe("formatValue", () => {
  it("joins lists with a comma", () => {
    expect(formatValue(["deleteResource", "invokeTool"])).toBe("deleteResource, invokeTool");
  });

  it("formats scalars, objects and missing values", () => {
    expect(formatValue("high")).toBe("high");
    expect(formatValue(7)).toBe("7");
    expect(formatValue({ a: 1 })).toBe('{"a":1}');
    expect(formatValue(null)).toBe("");
    expect(formatValue(undefined)).toBe("");
  });

  it("formats an empty or all-blank list as empty text", () => {
    expect(formatValue([])).toBe("");
    expect(formatValue(["", ""])).toBe("");
  });
});
