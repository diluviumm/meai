import { describe, expect, it } from "vitest";
import { OPENAPI_SPEC } from "@/lib/openapiSpec";

describe("OpenAPI contract", () => {
  it("documents the gateway and analytics paths", () => {
    expect(OPENAPI_SPEC.openapi).toBe("3.1.0");
    for (const path of ["/api/healthz", "/v1/chat/completions", "/api/insights", "/api/governance", "/api/usage/{connectionId}/history"]) {
      expect(OPENAPI_SPEC.paths[path]).toBeTruthy();
    }
  });

  it("has a bearer security scheme and no empty operation", () => {
    expect(OPENAPI_SPEC.components.securitySchemes.bearerAuth).toBeTruthy();
    for (const [path, item] of Object.entries(OPENAPI_SPEC.paths)) {
      expect(Object.keys(item).length, path).toBeGreaterThan(0);
    }
  });
});
